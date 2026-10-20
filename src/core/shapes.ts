import {
  apply,
  BBox,
  bboxOfPolylines,
  distPointPolyline,
  IDENTITY,
  Mat,
  pointInPolygon,
  Polyline,
  transformPolyline,
  Vec,
} from './geometry';

interface BaseShape {
  id: string;
  name: string;
  /** 소속 색상 레이어 인덱스 */
  layer: number;
  /** 로컬 좌표 → 문서 좌표 변환 */
  transform: Mat;
}

/** 벡터 도형: 곡선은 가져올 때 폴리라인으로 평탄화해 저장한다. */
export interface VectorShape extends BaseShape {
  type: 'vector';
  paths: Polyline[];
}

/** 비트맵 이미지: 로컬 좌표 (0,0)~(w,h) mm 영역에 그려진다. */
export interface ImageShape extends BaseShape {
  type: 'image';
  /** data URL (프로젝트 파일에 그대로 저장) */
  src: string;
  pxW: number;
  pxH: number;
  w: number;
  h: number;
}

export type Shape = VectorShape | ImageShape;

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function makeVector(paths: Polyline[], layer: number, name = 'Path', transform: Mat = IDENTITY): VectorShape {
  return { id: newId(), name, layer, transform: [...transform] as Mat, type: 'vector', paths };
}

export function cloneShape(s: Shape, keepId = true): Shape {
  const base = { ...s, id: keepId ? s.id : newId(), transform: [...s.transform] as Mat };
  if (s.type === 'vector') {
    return { ...(base as VectorShape), paths: s.paths.map((p) => ({ closed: p.closed, pts: p.pts.map((q) => ({ ...q })) })) };
  }
  return base as ImageShape;
}

/** 로컬 좌표의 외곽 (이미지는 사각형) */
export function localOutline(s: Shape): Polyline[] {
  if (s.type === 'vector') return s.paths;
  return [
    {
      pts: [
        { x: 0, y: 0 },
        { x: s.w, y: 0 },
        { x: s.w, y: s.h },
        { x: 0, y: s.h },
      ],
      closed: true,
    },
  ];
}

export function worldPaths(s: Shape): Polyline[] {
  return localOutline(s).map((p) => transformPolyline(s.transform, p));
}

export function shapeBBox(s: Shape): BBox {
  return bboxOfPolylines(worldPaths(s));
}

/** 문서 좌표 p 에서 도형을 맞히는지 (tol mm) */
export function hitTest(s: Shape, p: Vec, tol: number): boolean {
  const paths = worldPaths(s);
  if (s.type === 'image') return pointInPolygon(p, paths[0].pts);
  for (const l of paths) {
    if (distPointPolyline(p, l) <= tol) return true;
  }
  // 닫힌 도형 내부 클릭도 선택 (LightBurn 동작과 유사)
  let inside = false;
  for (const l of paths) if (l.closed && l.pts.length > 2 && pointInPolygon(p, l.pts)) inside = !inside;
  return inside;
}

export function shapeCenter(s: Shape): Vec {
  const b = shapeBBox(s);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function applyToShape(s: Shape, m: Mat): void {
  const t = s.transform;
  // s.transform = m * t
  s.transform = [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ];
}

/** 벡터 도형의 변환을 경로 좌표에 굽는다 (편집·출력 시 단순화) */
export function bakeTransform(s: VectorShape): void {
  s.paths = s.paths.map((p) => ({ closed: p.closed, pts: p.pts.map((q) => apply(s.transform, q)) }));
  s.transform = [...IDENTITY];
}
