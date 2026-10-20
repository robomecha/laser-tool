// 오프셋과 불리언 연산 (Clipper, clipper-lib). 정수 좌표로 계산하므로 mm 를 SCALE 배 해 µm 단위로 변환한다.
import ClipperLib from 'clipper-lib';
import { Polyline } from './geometry';

type Paths = ClipperLib.Paths;

const SCALE = 1000;

export type BoolOp = 'union' | 'difference' | 'intersection' | 'xor';
export type OffsetJoin = 'round' | 'miter' | 'square';

export interface OffsetOptions {
  join?: OffsetJoin;
  /** 뾰족한 모서리(Miter) 제한: 오프셋 거리 배수 */
  miterLimit?: number;
  /** 둥근 모서리 평탄화 허용 오차 mm */
  tol?: number;
}

function toPaths(lines: Polyline[]): Paths {
  return lines
    .filter((l) => l.pts.length >= 2)
    .map((l) => l.pts.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
}

function fromPaths(ps: Paths): Polyline[] {
  return ps.filter((p) => p.length >= 3).map((p) => ({ pts: p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })), closed: true }));
}

function execute(type: ClipperLib.ClipType, subject: Paths, clip: Paths, fill: ClipperLib.PolyFillType): Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, fill, fill);
  return out;
}

/**
 * 닫힌 경로들을 짝홀 규칙으로 정규화한다 (겹침 해소, 바깥과 구멍의 방향이 서로 반대).
 * 서로 다른 도형을 NonZero 로 합칠 때 각 도형 내부의 구멍이 보존되도록 도형별로 먼저 호출한다.
 */
function normalize(lines: Polyline[]): Paths {
  const closed = toPaths(lines.filter((l) => l.closed && l.pts.length > 2));
  if (!closed.length) return [];
  return execute(ClipperLib.ClipType.ctUnion, closed, [], ClipperLib.PolyFillType.pftEvenOdd);
}

/**
 * 불리언 연산. groups 는 도형 단위 경로 묶음이다.
 * - union / intersection / xor: 모든 도형에 차례로 적용
 * - difference: 첫 도형에서 나머지 도형을 모두 뺀다
 * 열린 경로는 무시한다. 결과는 닫힌 폴리라인 목록.
 */
export function booleanOp(op: BoolOp, groups: Polyline[][]): Polyline[] {
  const norm = groups.map(normalize).filter((p) => p.length);
  if (!norm.length) return [];
  const { ClipType: CT, PolyFillType: F } = ClipperLib;
  let acc = norm[0];
  const rest = norm.slice(1);
  switch (op) {
    case 'union':
      acc = execute(CT.ctUnion, norm.flat(), [], F.pftNonZero);
      break;
    case 'difference':
      acc = execute(CT.ctDifference, acc, rest.flat(), F.pftNonZero);
      break;
    case 'intersection':
      for (const g of rest) acc = execute(CT.ctIntersection, acc, g, F.pftNonZero);
      break;
    case 'xor':
      for (const g of rest) acc = execute(CT.ctXor, acc, g, F.pftNonZero);
      break;
  }
  return fromPaths(acc);
}

/**
 * 오프셋: delta>0 바깥쪽, delta<0 안쪽 (mm).
 * 닫힌 경로는 짝홀 규칙으로 영역을 만든 뒤 확장/축소하고,
 * 열린 경로는 (delta>0 일 때) 양쪽으로 delta 만큼 두께를 준 외곽선이 된다.
 */
export function offsetPolylines(lines: Polyline[], delta: number, o: OffsetOptions = {}): Polyline[] {
  const { JoinType: J, EndType: E } = ClipperLib;
  const join = { round: J.jtRound, miter: J.jtMiter, square: J.jtSquare }[o.join ?? 'round'];
  const co = new ClipperLib.ClipperOffset(o.miterLimit ?? 4, (o.tol ?? 0.02) * SCALE);
  const closed = normalize(lines);
  if (closed.length) co.AddPaths(closed, join, E.etClosedPolygon);
  const open = toPaths(lines.filter((l) => !l.closed));
  if (open.length && delta > 0) co.AddPaths(open, join, join === J.jtRound ? E.etOpenRound : E.etOpenSquare);
  const out: Paths = [];
  co.Execute(out, delta * SCALE);
  return fromPaths(out);
}
