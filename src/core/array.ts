// 배열 복사 (LightBurn 의 Grid Array / Circular Array 에 해당)
import { about, BBox, bboxOfPolylines, rotate, translate, Vec } from './geometry';
import { applyToShape, cloneShape, Shape, worldPaths } from './shapes';

export interface GridArrayOptions {
  columns: number;
  rows: number;
  /** spacing='gap': 도형 사이 간격 mm, 'pitch': 복사본 사이 중심 거리 mm */
  spacingX: number;
  spacingY: number;
  spacing: 'gap' | 'pitch';
}

export interface CircularArrayOptions {
  /** 원본을 포함한 전체 개수 */
  count: number;
  center: Vec;
  /** 펼칠 전체 각도 (deg, 360 이면 한 바퀴를 count 등분) */
  totalAngle: number;
  /** 복사본도 배열 방향에 맞춰 회전 */
  rotateCopies: boolean;
}

function groupBBox(shapes: Shape[]): BBox {
  return bboxOfPolylines(shapes.flatMap(worldPaths));
}

/** 원본은 그대로 두고 새 복사본만 돌려준다 (원본이 (0,0) 칸) */
export function gridArray(shapes: Shape[], o: GridArrayOptions): Shape[] {
  const cols = Math.max(1, Math.floor(o.columns));
  const rows = Math.max(1, Math.floor(o.rows));
  const b = groupBBox(shapes);
  const stepX = o.spacing === 'gap' ? b.maxX - b.minX + o.spacingX : o.spacingX;
  const stepY = o.spacing === 'gap' ? b.maxY - b.minY + o.spacingY : o.spacingY;
  const out: Shape[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      const m = translate(c * stepX, r * stepY);
      for (const s of shapes) {
        const copy = cloneShape(s, false);
        applyToShape(copy, m);
        out.push(copy);
      }
    }
  }
  return out;
}

export function circularArray(shapes: Shape[], o: CircularArrayOptions): Shape[] {
  const n = Math.max(1, Math.floor(o.count));
  if (n < 2) return [];
  const full = Math.abs(Math.abs(o.totalAngle) - 360) < 1e-6;
  // 한 바퀴면 n 등분, 아니면 처음과 끝을 포함해 n-1 등분
  const step = ((o.totalAngle / (full ? n : n - 1)) * Math.PI) / 180;
  const b = groupBBox(shapes);
  const gc = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const out: Shape[] = [];
  for (let i = 1; i < n; i++) {
    const a = step * i;
    // 회전 배열: 중심 기준 회전 / 비회전: 그룹 중심만 원 위로 옮긴다
    let m = about(rotate(a), o.center.x, o.center.y);
    if (!o.rotateCopies) {
      const dx = gc.x - o.center.x;
      const dy = gc.y - o.center.y;
      const nx = o.center.x + dx * Math.cos(a) - dy * Math.sin(a);
      const ny = o.center.y + dx * Math.sin(a) + dy * Math.cos(a);
      m = translate(nx - gc.x, ny - gc.y);
    }
    for (const s of shapes) {
      const copy = cloneShape(s, false);
      applyToShape(copy, m);
      out.push(copy);
    }
  }
  return out;
}
