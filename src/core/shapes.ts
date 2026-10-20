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

/** 텍스트 도형의 원본 (다시 편집할 수 있게 경로와 함께 저장) */
export interface TextMeta {
  content: string;
  family: string;
  style: string;
  size: number;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  weight: number;
  /** 곡선 따라 쓰기: 기준 곡선(만들 때의 문서 좌표)과 배치 옵션 */
  path?: { line: Polyline; position: number; side: 'above' | 'below'; reverse: boolean; offset: number };
}

/** 벡터 도형: 곡선은 가져올 때 폴리라인으로 평탄화해 저장한다. */
export interface VectorShape extends BaseShape {
  type: 'vector';
  paths: Polyline[];
  /** 텍스트로 만든 도형이면 원본 글자와 설정 */
  text?: TextMeta;
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

/** 클릭 위치가 도형의 선(테두리) 위인지, 닫힌 영역 안인지 */
export function hitKind(s: Shape, p: Vec, tol: number): 'edge' | 'inside' | null {
  const paths = worldPaths(s);
  for (const l of paths) if (distPointPolyline(p, l) <= tol) return 'edge';
  if (s.type === 'image') return pointInPolygon(p, paths[0].pts) ? 'inside' : null;
  let inside = false;
  for (const l of paths) if (l.closed && l.pts.length > 2 && pointInPolygon(p, l.pts)) inside = !inside;
  return inside ? 'inside' : null;
}

/**
 * 클릭으로 고를 도형. 선 위를 클릭했으면 가장 위의 도형, 안쪽을 클릭했으면 그 점을 감싸는 도형 중 가장 작은 것.
 * (큰 도형을 나중에 그려도 그 안의 작은 도형을 고를 수 있고, 큰 도형은 테두리를 눌러 고른다)
 */
export function pickShape(shapes: Shape[], p: Vec, tol: number): Shape | null {
  let best: Shape | null = null;
  let bestArea = Infinity;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const k = hitKind(s, p, tol);
    if (k === 'edge') return s;
    if (k === 'inside') {
      const b = shapeBBox(s);
      const area = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (area < bestArea) {
        bestArea = area;
        best = s;
      }
    }
  }
  return best;
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
