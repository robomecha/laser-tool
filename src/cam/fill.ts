// 채우기(스캔) 모드: 닫힌 도형들을 짝홀 규칙으로 해칭한다. RDWorks 의 Scan 모드에 해당.
import { apply, bboxOfPolylines, Mat, Polyline, rotate } from '../core/geometry';
import { JobMove } from './job';

export interface FillOptions {
  interval: number;
  angleDeg: number;
  bidirectional: boolean;
  overscan: number;
  power: number;
}

/** 한 스캔라인과 다각형 집합의 교차 x 좌표 (정렬됨) */
export function scanIntersections(polys: Polyline[], y: number): number[] {
  const xs: number[] = [];
  for (const l of polys) {
    const n = l.pts.length;
    for (let i = 0; i < n; i++) {
      const a = l.pts[i];
      const b = l.pts[(i + 1) % n];
      // 반열린 구간 규칙으로 꼭짓점 중복 계산 방지
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
  }
  return xs.sort((p, q) => p - q);
}

export function fillMoves(lines: Polyline[], o: FillOptions): JobMove[] {
  const closed = lines.filter((l) => l.closed && l.pts.length > 2);
  if (!closed.length || o.interval <= 0) return [];
  const rad = (o.angleDeg * Math.PI) / 180;
  const toScan: Mat = rotate(-rad);
  const back: Mat = rotate(rad);
  const polys = closed.map((l) => ({ closed: true, pts: l.pts.map((p) => apply(toScan, p)) }));
  const b = bboxOfPolylines(polys);
  const moves: JobMove[] = [];
  let forward = true;
  const push = (x: number, y: number, p: number) => {
    const q = apply(back, { x, y });
    moves.push({ x: q.x, y: q.y, p });
  };

  for (let y = b.minY + o.interval / 2; y < b.maxY; y += o.interval) {
    const xs = scanIntersections(polys, y);
    if (xs.length < 2) continue;
    const segs: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) segs.push([xs[i], xs[i + 1]]);
    if (!segs.length) continue;
    if (!forward) {
      segs.reverse();
      for (const s of segs) s.reverse();
    }
    const dir = forward ? 1 : -1;
    push(segs[0][0] - dir * o.overscan, y, -1);
    for (const [x0, x1] of segs) {
      push(x0, y, 0);
      push(x1, y, o.power);
    }
    push(segs[segs.length - 1][1] + dir * o.overscan, y, 0);
    if (o.bidirectional) forward = !forward;
  }
  return moves;
}
