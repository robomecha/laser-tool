// 최소 DXF(ASCII) 가져오기: LINE, LWPOLYLINE(bulge 포함), POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE, SPLINE(제어점 근사), POINT 무시.
// DXF 는 Y 가 위로 증가하므로 문서 좌표(Y 아래)로 뒤집는다. 단위는 $INSUNITS 를 따른다 (기본 mm).
import { arcPoints, bboxOfPolylines, Polyline, Vec } from '../core/geometry';
import { makeVector, Shape } from '../core/shapes';
import { nearestPaletteIndexFromAci } from './aci';

interface Pair {
  code: number;
  value: string;
}

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    out.push({ code: parseInt(lines[i].trim(), 10), value: lines[i + 1].trim() });
  }
  return out;
}

const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

/** bulge 가 있는 두 점 사이 원호 점열 (시작점 제외) */
function bulgeArc(a: Vec, b: Vec, bulge: number, tol: number): Vec[] {
  if (Math.abs(bulge) < 1e-9) return [b];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const dx = (b.x - a.x) / chord;
  const dy = (b.y - a.y) / chord;
  // 반시계(bulge>0)일 때 중심은 진행 방향 왼쪽
  const sgn = (bulge > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const cx = mx - dy * h * sgn;
  const cy = my + dx * h * sgn;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const pts = arcPoints(cx, cy, r, r, a0, a0 + theta, tol);
  pts[pts.length - 1] = { ...b };
  return pts;
}

interface Entity {
  type: string;
  props: Pair[];
}

export function importDXF(text: string, defaultLayer = 0): { shapes: Shape[]; warnings: string[] } {
  const ps = pairs(text);
  const warnings: string[] = [];
  let unitScale = 1;

  // 헤더: $INSUNITS
  for (let i = 0; i < ps.length - 1; i++) {
    if (ps[i].code === 9 && ps[i].value === '$INSUNITS') {
      unitScale = UNIT_MM[parseInt(ps[i + 1].value, 10)] ?? 1;
      break;
    }
  }

  // ENTITIES 섹션만 추출 (BLOCKS/INSERT 는 아직 미지원)
  let start = -1;
  for (let i = 0; i < ps.length - 1; i++) {
    if (ps[i].code === 0 && ps[i].value === 'SECTION' && ps[i + 1].code === 2 && ps[i + 1].value === 'ENTITIES') {
      start = i + 2;
      break;
    }
  }
  if (start < 0) throw new Error('DXF ENTITIES 섹션을 찾을 수 없습니다');

  const entities: Entity[] = [];
  let cur: Entity | null = null;
  for (let i = start; i < ps.length; i++) {
    const p = ps[i];
    if (p.code === 0) {
      if (p.value === 'ENDSEC') break;
      cur = { type: p.value, props: [] };
      entities.push(cur);
    } else if (cur) cur.props.push(p);
  }

  const tol = 0.02 / unitScale;
  const out: { paths: Polyline[]; color: number; name: string }[] = [];
  const unsupported = new Set<string>();
  const g = (e: Entity, code: number, def = 0) => {
    const f = e.props.find((p) => p.code === code);
    return f ? parseFloat(f.value) : def;
  };
  const colorOf = (e: Entity) => g(e, 62, 7);

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    switch (e.type) {
      case 'LINE':
        out.push({ paths: [{ pts: [{ x: g(e, 10), y: g(e, 20) }, { x: g(e, 11), y: g(e, 21) }], closed: false }], color: colorOf(e), name: 'Line' });
        break;
      case 'CIRCLE': {
        const cx = g(e, 10), cy = g(e, 20), r = g(e, 40);
        const pts = [{ x: cx + r, y: cy }, ...arcPoints(cx, cy, r, r, 0, 2 * Math.PI, tol)];
        pts.pop();
        out.push({ paths: [{ pts, closed: true }], color: colorOf(e), name: 'Circle' });
        break;
      }
      case 'ARC': {
        const cx = g(e, 10), cy = g(e, 20), r = g(e, 40);
        const a0 = (g(e, 50) * Math.PI) / 180;
        let a1 = (g(e, 51) * Math.PI) / 180;
        if (a1 <= a0) a1 += 2 * Math.PI;
        const pts = [{ x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) }, ...arcPoints(cx, cy, r, r, a0, a1, tol)];
        out.push({ paths: [{ pts, closed: false }], color: colorOf(e), name: 'Arc' });
        break;
      }
      case 'ELLIPSE': {
        const cx = g(e, 10), cy = g(e, 20);
        const mx = g(e, 11), my = g(e, 21);
        const ratio = g(e, 40, 1);
        const t0 = g(e, 41, 0);
        let t1 = g(e, 42, 2 * Math.PI);
        if (t1 <= t0) t1 += 2 * Math.PI;
        const rx = Math.hypot(mx, my);
        const rot = Math.atan2(my, mx);
        const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
        const first = { x: cx + rx * Math.cos(t0) * Math.cos(rot) - rx * ratio * Math.sin(t0) * Math.sin(rot), y: cy + rx * Math.cos(t0) * Math.sin(rot) + rx * ratio * Math.sin(t0) * Math.cos(rot) };
        const pts = [first, ...arcPoints(cx, cy, rx, rx * ratio, t0, t1, tol, rot)];
        if (full) pts.pop();
        out.push({ paths: [{ pts, closed: full }], color: colorOf(e), name: 'Ellipse' });
        break;
      }
      case 'LWPOLYLINE': {
        const verts: { p: Vec; bulge: number }[] = [];
        for (const p of e.props) {
          if (p.code === 10) verts.push({ p: { x: parseFloat(p.value), y: 0 }, bulge: 0 });
          else if (p.code === 20 && verts.length) verts[verts.length - 1].p.y = parseFloat(p.value);
          else if (p.code === 42 && verts.length) verts[verts.length - 1].bulge = parseFloat(p.value);
        }
        const closed = (g(e, 70) & 1) === 1;
        out.push({ paths: [bulgePolyline(verts, closed, tol)], color: colorOf(e), name: 'Polyline' });
        break;
      }
      case 'POLYLINE': {
        const closed = (g(e, 70) & 1) === 1;
        const verts: { p: Vec; bulge: number }[] = [];
        while (i + 1 < entities.length && entities[i + 1].type === 'VERTEX') {
          i++;
          const v = entities[i];
          verts.push({ p: { x: g(v, 10), y: g(v, 20) }, bulge: g(v, 42) });
        }
        if (i + 1 < entities.length && entities[i + 1].type === 'SEQEND') i++;
        out.push({ paths: [bulgePolyline(verts, closed, tol)], color: colorOf(e), name: 'Polyline' });
        break;
      }
      case 'SPLINE': {
        // 정확한 NURBS 대신 맞춤점(11) 또는 제어점(10)을 연결한 근사
        const fit: Vec[] = [];
        const ctrl: Vec[] = [];
        for (const p of e.props) {
          if (p.code === 11) fit.push({ x: parseFloat(p.value), y: 0 });
          else if (p.code === 21 && fit.length) fit[fit.length - 1].y = parseFloat(p.value);
          else if (p.code === 10) ctrl.push({ x: parseFloat(p.value), y: 0 });
          else if (p.code === 20 && ctrl.length) ctrl[ctrl.length - 1].y = parseFloat(p.value);
        }
        const pts = fit.length > 1 ? fit : ctrl;
        if (pts.length > 1) {
          out.push({ paths: [{ pts, closed: (g(e, 70) & 1) === 1 }], color: colorOf(e), name: 'Spline' });
          warnings.push('SPLINE 은 점 연결로 근사되었습니다');
        }
        break;
      }
      case 'VERTEX':
      case 'SEQEND':
      case 'POINT':
        break;
      default:
        unsupported.add(e.type);
    }
  }

  if (unsupported.size) warnings.push(`지원하지 않는 DXF 엔티티 무시: ${[...unsupported].join(', ')}`);

  // Y 뒤집기 + 단위 변환. 전체 높이를 기준으로 뒤집어 원래 배치를 유지한다.
  const all = bboxOfPolylines(out.flatMap((o) => o.paths));
  const flip = (p: Vec): Vec => ({ x: (p.x - all.minX) * unitScale, y: (all.maxY - p.y) * unitScale });
  const shapes = out.map((o) =>
    makeVector(
      o.paths.map((l) => ({ closed: l.closed, pts: l.pts.map(flip) })),
      o.color === 7 || o.color === 0 || o.color === 256 ? defaultLayer : nearestPaletteIndexFromAci(o.color),
      o.name,
    ),
  );
  return { shapes, warnings: [...new Set(warnings)] };
}

function bulgePolyline(verts: { p: Vec; bulge: number }[], closed: boolean, tol: number): Polyline {
  if (!verts.length) return { pts: [], closed };
  const pts: Vec[] = [{ ...verts[0].p }];
  const n = verts.length;
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % n];
    pts.push(...bulgeArc(a.p, b.p, a.bulge, tol));
  }
  if (closed && pts.length > 1) pts.pop();
  return { pts, closed };
}
