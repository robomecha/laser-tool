// 라인(컷) 모드 경로 생성 + 순서 최적화 (안쪽 도형 먼저, 최근접 이웃)
import { dist, pointInPolygon, Polyline, signedArea, Vec } from '../core/geometry';
import { JobMove } from './job';

/** 각 닫힌 폴리라인이 다른 닫힌 폴리라인 몇 개 안에 들어있는지 */
function nestingDepth(lines: Polyline[]): number[] {
  const areas = lines.map((l) => (l.closed ? Math.abs(signedArea(l.pts)) : 0));
  return lines.map((l, i) => {
    const probe = l.pts[0];
    let d = 0;
    lines.forEach((o, j) => {
      if (j !== i && o.closed && o.pts.length > 2 && areas[j] > areas[i] && pointInPolygon(probe, o.pts)) d++;
    });
    return d;
  });
}

/** 닫힌 경로를 pos 에 가장 가까운 꼭짓점에서 시작하도록 회전 */
function rotateToNearest(l: Polyline, pos: Vec): Vec[] {
  let bi = 0;
  let bd = Infinity;
  l.pts.forEach((p, i) => {
    const d = dist(p, pos);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return [...l.pts.slice(bi), ...l.pts.slice(0, bi)];
}

export interface OrderOptions {
  innerFirst: boolean;
  start: Vec;
}

/** 경로 순서를 정하고 시작점/방향을 결정한 점열 목록을 반환 (닫힌 경로는 시작점이 끝에 반복됨) */
export function orderPaths(lines: Polyline[], opt: OrderOptions): Vec[][] {
  const valid = lines.filter((l) => l.pts.length > 1);
  const depth = opt.innerFirst ? nestingDepth(valid) : valid.map(() => 0);
  const levels = [...new Set(depth)].sort((a, b) => b - a);
  const out: Vec[][] = [];
  let pos = opt.start;
  for (const lv of levels) {
    const pool = valid.filter((_, i) => depth[i] === lv);
    while (pool.length) {
      let bi = 0;
      let bd = Infinity;
      let rev = false;
      pool.forEach((l, i) => {
        if (l.closed) {
          for (const p of l.pts) {
            const d = dist(p, pos);
            if (d < bd) [bd, bi, rev] = [d, i, false];
          }
        } else {
          const d0 = dist(l.pts[0], pos);
          const d1 = dist(l.pts[l.pts.length - 1], pos);
          if (d0 < bd) [bd, bi, rev] = [d0, i, false];
          if (d1 < bd) [bd, bi, rev] = [d1, i, true];
        }
      });
      const l = pool.splice(bi, 1)[0];
      let pts: Vec[];
      if (l.closed) {
        pts = rotateToNearest(l, pos);
        pts.push(pts[0]);
      } else {
        pts = rev ? [...l.pts].reverse() : [...l.pts];
      }
      out.push(pts);
      pos = pts[pts.length - 1];
    }
  }
  return out;
}

export function vectorMoves(lines: Polyline[], power: number, opt: OrderOptions): JobMove[] {
  const moves: JobMove[] = [];
  for (const pts of orderPaths(lines, opt)) {
    moves.push({ x: pts[0].x, y: pts[0].y, p: -1 });
    for (let i = 1; i < pts.length; i++) moves.push({ x: pts[i].x, y: pts[i].y, p: power });
  }
  return moves;
}
