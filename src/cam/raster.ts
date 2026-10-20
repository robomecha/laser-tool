// 이미지 각인: 출력 해상도로 리샘플 → 디더링 → 행 단위 가변 출력 이동
import { apply, Mat } from '../core/geometry';
import { DitherMode } from '../core/layers';
import { JobMove } from './job';

/** 밝기 0(검정)~1(흰색) */
export interface GrayImage {
  w: number;
  h: number;
  data: Float32Array;
}

/** 박스 평균 리샘플 → 어둡기(0=흰색, 1=검정) 격자 */
export function resampleDarkness(img: GrayImage, cols: number, rows: number, negative = false): Float32Array {
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * img.h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * img.h) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * img.w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * img.w) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < img.h; y++) {
        for (let x = x0; x < x1 && x < img.w; x++) {
          sum += img.data[y * img.w + x];
          n++;
        }
      }
      const lum = n ? sum / n : 1;
      out[r * cols + c] = negative ? lum : 1 - lum;
    }
  }
  return out;
}

/** 제자리 디더링. 결과: 이진 모드는 0/1, grayscale 은 연속값 */
export function dither(d: Float32Array, cols: number, rows: number, mode: DitherMode): Float32Array {
  if (mode === 'grayscale') return d;
  if (mode === 'threshold') {
    for (let i = 0; i < d.length; i++) d[i] = d[i] >= 0.5 ? 1 : 0;
    return d;
  }
  const kernel: [number, number, number][] =
    mode === 'floyd'
      ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
      : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const old = d[i];
      const nv = old >= 0.5 ? 1 : 0;
      d[i] = nv;
      const err = old - nv;
      for (const [dx, dy, w] of kernel) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < cols && yy < rows) d[yy * cols + xx] += err * w;
      }
    }
  }
  return d;
}

export interface RasterOptions {
  /** 이미지 로컬 크기 mm */
  w: number;
  h: number;
  transform: Mat;
  interval: number;
  power: number;
  minPower: number;
  dither: DitherMode;
  negative: boolean;
  bidirectional: boolean;
  overscan: number;
  /** 가로 해상도 상한 (메모리 보호) */
  maxCols?: number;
}

export function rasterMoves(img: GrayImage, o: RasterOptions): JobMove[] {
  const t = o.transform;
  const sx = Math.hypot(t[0], t[1]) || 1;
  const sy = Math.hypot(t[2], t[3]) || 1;
  const worldW = o.w * sx;
  const worldH = o.h * sy;
  const rows = Math.max(1, Math.round(worldH / o.interval));
  const cols = Math.max(1, Math.min(o.maxCols ?? 6000, Math.round(worldW / o.interval)));
  const grid = dither(resampleDarkness(img, cols, rows, o.negative), cols, rows, o.dither);
  const cw = o.w / cols;
  const rh = o.h / rows;
  const os = o.overscan / sx;

  const powerOf = (v: number): number => {
    if (o.dither === 'grayscale') {
      if (v < 0.01) return 0;
      // 1% 단위로 양자화해 이동 명령 수를 줄인다
      return Math.round(o.minPower + v * (o.power - o.minPower));
    }
    return v >= 0.5 ? o.power : 0;
  };

  const moves: JobMove[] = [];
  const push = (x: number, y: number, p: number) => {
    const q = apply(t, { x, y });
    moves.push({ x: q.x, y: q.y, p });
  };
  let forward = true;
  const rowPow = new Array<number>(cols);

  for (let r = 0; r < rows; r++) {
    let first = -1;
    let last = -1;
    for (let c = 0; c < cols; c++) {
      rowPow[c] = powerOf(grid[r * cols + c]);
      if (rowPow[c] > 0) {
        if (first < 0) first = c;
        last = c;
      }
    }
    if (first < 0) continue;
    const y = (r + 0.5) * rh;
    if (forward) {
      push(first * cw - os, y, -1);
      push(first * cw, y, 0);
      let c = first;
      while (c <= last) {
        const p = rowPow[c];
        let e = c;
        while (e + 1 <= last && rowPow[e + 1] === p) e++;
        push((e + 1) * cw, y, p);
        c = e + 1;
      }
      push((last + 1) * cw + os, y, 0);
    } else {
      push((last + 1) * cw + os, y, -1);
      push((last + 1) * cw, y, 0);
      let c = last;
      while (c >= first) {
        const p = rowPow[c];
        let s = c;
        while (s - 1 >= first && rowPow[s - 1] === p) s--;
        push(s * cw, y, p);
        c = s - 1;
      }
      push(first * cw - os, y, 0);
    }
    if (o.bidirectional) forward = !forward;
  }
  return moves;
}
