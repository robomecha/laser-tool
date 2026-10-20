// 기본 2D 기하 유틸리티. 모든 좌표 단위는 mm, 문서 좌표계는 Y가 아래로 증가한다.

export interface Vec {
  x: number;
  y: number;
}

/** 아핀 변환 행렬 [a, b, c, d, e, f] : x' = a*x + c*y + e, y' = b*x + d*y + f (SVG/Canvas 와 동일) */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m * n : n 을 먼저 적용한 뒤 m 을 적용한다. */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, p: Vec): Vec {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export const translate = (tx: number, ty: number): Mat => [1, 0, 0, 1, tx, ty];
export const scale = (sx: number, sy: number = sx): Mat => [sx, 0, 0, sy, 0, 0];
export function rotate(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}
/** 점 (cx, cy) 를 기준으로 변환 m 을 적용하는 행렬 */
export function about(m: Mat, cx: number, cy: number): Mat {
  return mul(translate(cx, cy), mul(m, translate(-cx, -cy)));
}

export interface Polyline {
  pts: Vec[];
  closed: boolean;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function isEmptyBBox(b: BBox): boolean {
  return !(b.minX <= b.maxX && b.minY <= b.maxY);
}

export function addPoint(b: BBox, p: Vec): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxOfPolylines(lines: Polyline[]): BBox {
  const b = emptyBBox();
  for (const l of lines) for (const p of l.pts) addPoint(b, p);
  return b;
}

export function transformPolyline(m: Mat, l: Polyline): Polyline {
  return { pts: l.pts.map((p) => apply(m, p)), closed: l.closed };
}

export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function distPointSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distPointPolyline(p: Vec, l: Polyline): number {
  let best = Infinity;
  const n = l.pts.length;
  if (n === 1) return dist(p, l.pts[0]);
  const segs = l.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    best = Math.min(best, distPointSegment(p, l.pts[i], l.pts[(i + 1) % n]));
  }
  return best;
}

/** 짝홀(even-odd) 규칙 점-다각형 포함 판정 */
export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polylineLength(l: Polyline): number {
  let len = 0;
  for (let i = 1; i < l.pts.length; i++) len += dist(l.pts[i - 1], l.pts[i]);
  if (l.closed && l.pts.length > 1) len += dist(l.pts[l.pts.length - 1], l.pts[0]);
  return len;
}

export function signedArea(pts: Vec[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return a / 2;
}

// ---- 곡선 평탄화 (tol: 허용 오차 mm) ----

export function flattenCubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, tol = 0.02): Vec[] {
  const dd = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.min(512, Math.ceil(Math.sqrt(dd / tol) * 0.6)));
  const out: Vec[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

export function flattenQuad(p0: Vec, p1: Vec, p2: Vec, tol = 0.02): Vec[] {
  const dd = dist(p0, p1) + dist(p1, p2);
  const n = Math.max(2, Math.min(512, Math.ceil(Math.sqrt(dd / tol) * 0.6)));
  const out: Vec[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

/** 중심 (cx,cy), 반지름 rx, ry, 시작/끝 각도(라디안) 원호를 점열로 변환 (시작점 제외) */
export function arcPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  tol = 0.02,
  rot = 0,
): Vec[] {
  const r = Math.max(rx, ry, 1e-9);
  const sweep = a1 - a0;
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
  const n = Math.max(2, Math.min(2048, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3))));
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const out: Vec[] = [];
  for (let i = 1; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    out.push({ x: cx + x * cr - y * sr, y: cy + x * sr + y * cr });
  }
  return out;
}

export function ellipsePolyline(cx: number, cy: number, rx: number, ry: number, tol = 0.02): Polyline {
  const pts = [{ x: cx + rx, y: cy }, ...arcPoints(cx, cy, rx, ry, 0, Math.PI * 2, tol)];
  pts.pop(); // 마지막 점 = 첫 점
  return { pts, closed: true };
}

/**
 * 정다각형 / 별. r = 중심에서 꼭짓점까지 거리, rot = 첫 꼭짓점 각도(라디안, Y 아래 기준).
 * innerRatio 를 주면 꼭짓점 사이에 안쪽 점(반지름 r*innerRatio)을 넣어 별 모양이 된다.
 */
export function regularPolygon(cx: number, cy: number, r: number, sides: number, rot = 0, innerRatio?: number): Polyline {
  const n = Math.max(3, Math.min(256, Math.round(sides)));
  const pts: Vec[] = [];
  const star = innerRatio !== undefined && innerRatio > 0 && innerRatio < 1;
  const steps = star ? n * 2 : n;
  for (let i = 0; i < steps; i++) {
    const a = rot + (i * 2 * Math.PI) / steps;
    const rr = star && i % 2 ? r * innerRatio! : r;
    pts.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
  }
  return { pts, closed: true };
}

/** 밑변이 수평이 되는 첫 꼭짓점 각도 (홀수 각형은 꼭짓점이 위로) */
export function uprightRotation(sides: number): number {
  const n = Math.max(3, Math.round(sides));
  // 밑변 가운데가 정확히 아래(+Y, 90°)에 오도록
  return Math.PI / 2 + Math.PI / n;
}

export function rectPolyline(x: number, y: number, w: number, h: number): Polyline {
  return {
    pts: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    closed: true,
  };
}

/** SVG 의 endpoint 형식 원호(A 명령) → 점열 (시작점 제외). SVG 1.1 부록 F.6 구현 */
export function svgArcToPoints(
  p0: Vec,
  rx: number,
  ry: number,
  xAxisRotDeg: number,
  largeArc: boolean,
  sweepFlag: boolean,
  p1: Vec,
  tol = 0.02,
): Vec[] {
  if (rx === 0 || ry === 0) return [p1];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (xAxisRotDeg * Math.PI) / 180;
  const cphi = Math.cos(phi);
  const sphi = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cphi * dx + sphi * dy;
  const y1 = -sphi * dx + cphi * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweepFlag) coef = -coef;
  const cxp = (coef * rx * y1) / ry;
  const cyp = (-coef * ry * x1) / rx;
  const cx = cphi * cxp - sphi * cyp + (p0.x + p1.x) / 2;
  const cy = sphi * cxp + cphi * cyp + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const a0 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let da = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweepFlag && da > 0) da -= 2 * Math.PI;
  if (sweepFlag && da < 0) da += 2 * Math.PI;
  const pts = arcPoints(cx, cy, rx, ry, a0, a0 + da, tol, phi);
  pts[pts.length - 1] = { ...p1 };
  return pts;
}
