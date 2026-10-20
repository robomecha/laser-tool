// SVG 가져오기 (브라우저 DOMParser 사용). 선 색상 → 가장 가까운 팔레트 레이어로 배정.
import { ellipsePolyline, IDENTITY, Mat, mul, Polyline, rectPolyline, rotate, scale, translate, transformPolyline } from '../core/geometry';
import { ImageShape, makeVector, newId, Shape } from '../core/shapes';
import { nearestPaletteIndex, parseColor } from './color';
import { parsePathData } from './svg-path';

const PX_TO_MM = 25.4 / 96;

function unitToMm(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case 'mm':
      return n;
    case 'cm':
      return n * 10;
    case 'in':
      return n * 25.4;
    case 'pt':
      return (n * 25.4) / 72;
    case 'pc':
      return (n * 25.4) / 6;
    case '%':
      return null;
    default:
      return n * PX_TO_MM;
  }
}

export function parseTransform(t: string | null): Mat {
  let m: Mat = [...IDENTITY];
  if (!t) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(t))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: Mat;
    switch (r[1]) {
      case 'matrix':
        n = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        n = translate(a[0] || 0, a[1] || 0);
        break;
      case 'scale':
        n = scale(a[0], a.length > 1 ? a[1] : a[0]);
        break;
      case 'rotate': {
        const rad = ((a[0] || 0) * Math.PI) / 180;
        n = a.length >= 3 ? mul(translate(a[1], a[2]), mul(rotate(rad), translate(-a[1], -a[2]))) : rotate(rad);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        n = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = mul(m, n);
  }
  return m;
}

function styleProp(el: Element, name: string): string | null {
  const style = el.getAttribute('style');
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
    if (m) return m[1].trim();
  }
  return el.getAttribute(name);
}

const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'style', 'metadata', 'title', 'desc', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter']);

export interface ImportResult {
  shapes: Shape[];
  warnings: string[];
}

export function importSVG(text: string, defaultLayer = 0): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('올바른 SVG 파일이 아닙니다');
  const warnings: string[] = [];

  // 루트 단위 → mm
  const vb = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const wmm = unitToMm(root.getAttribute('width'));
  const hmm = unitToMm(root.getAttribute('height'));
  let rootM: Mat = scale(PX_TO_MM);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const sx = wmm != null ? wmm / vb[2] : PX_TO_MM;
    const sy = hmm != null ? hmm / vb[3] : sx;
    rootM = mul(scale(sx, sy), translate(-vb[0], -vb[1]));
  } else if (wmm == null && hmm == null) {
    rootM = scale(PX_TO_MM);
  }

  const shapes: Shape[] = [];
  const unsupported = new Set<string>();

  const walk = (el: Element, m: Mat, inheritedStroke: string | null, inheritedFill: string | null) => {
    const tag = el.localName;
    if (SKIP.has(tag)) return;
    if (styleProp(el, 'display') === 'none') return;
    const local = mul(m, parseTransform(el.getAttribute('transform')));
    const stroke = styleProp(el, 'stroke') ?? inheritedStroke;
    const fill = styleProp(el, 'fill') ?? inheritedFill;

    const num = (a: string) => parseFloat(el.getAttribute(a) || '0') || 0;
    // 평탄화 오차를 문서 mm 기준 0.02 로 맞추기 위한 스케일 보정
    const sc = Math.sqrt(Math.abs(local[0] * local[3] - local[1] * local[2])) || 1;
    const tol = 0.02 / sc;
    let paths: Polyline[] | null = null;

    switch (tag) {
      case 'svg':
      case 'g':
      case 'a':
      case 'switch':
        for (const c of Array.from(el.children)) walk(c, local, stroke, fill);
        return;
      case 'path':
        try {
          paths = parsePathData(el.getAttribute('d') || '', tol);
        } catch (e) {
          warnings.push(`path 해석 실패: ${(e as Error).message}`);
        }
        break;
      case 'rect': {
        const w = num('width');
        const h = num('height');
        if (w > 0 && h > 0) paths = [rectPolyline(num('x'), num('y'), w, h)];
        break;
      }
      case 'circle': {
        const r = num('r');
        if (r > 0) paths = [ellipsePolyline(num('cx'), num('cy'), r, r, tol)];
        break;
      }
      case 'ellipse': {
        const rx = num('rx');
        const ry = num('ry');
        if (rx > 0 && ry > 0) paths = [ellipsePolyline(num('cx'), num('cy'), rx, ry, tol)];
        break;
      }
      case 'line':
        paths = [{ pts: [{ x: num('x1'), y: num('y1') }, { x: num('x2'), y: num('y2') }], closed: false }];
        break;
      case 'polyline':
      case 'polygon': {
        const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        const pts = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] });
        if (pts.length > 1) paths = [{ pts, closed: tag === 'polygon' }];
        break;
      }
      case 'image': {
        const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        if (href.startsWith('data:image')) {
          const w = num('width');
          const h = num('height');
          const img: ImageShape = {
            id: newId(), name: 'Image', type: 'image', layer: defaultLayer,
            transform: mul(local, translate(num('x'), num('y'))), src: href, pxW: 0, pxH: 0, w, h,
          };
          shapes.push(img);
        } else {
          warnings.push('외부 링크 이미지는 지원하지 않습니다 (내장 data URI 만 가능)');
        }
        return;
      }
      default:
        unsupported.add(tag);
        return;
    }
    if (!paths || !paths.length) return;
    const color = parseColor(stroke) ?? parseColor(fill);
    const layer = nearestPaletteIndex(color, defaultLayer);
    shapes.push(makeVector(paths.map((p) => transformPolyline(local, p)), layer, tag[0].toUpperCase() + tag.slice(1)));
  };

  walk(root, rootM, null, null);
  if (unsupported.size) warnings.push(`지원하지 않는 요소 무시: ${[...unsupported].join(', ')} (텍스트는 SVG 에서 '패스로 변환' 후 가져오세요)`);
  return { shapes, warnings };
}
