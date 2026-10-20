// 비트맵 가져오기 및 이미지 픽셀 캐시 (브라우저 전용)
import { ImageShape, newId } from '../core/shapes';
import type { GrayImage } from '../cam/raster';

const elCache = new Map<string, HTMLImageElement>();
const grayCache = new Map<string, GrayImage>();

export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function loadImageEl(src: string): Promise<HTMLImageElement> {
  const hit = elCache.get(src);
  if (hit?.complete) return Promise.resolve(hit);
  return new Promise((res, rej) => {
    const img = hit ?? new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('이미지를 불러올 수 없습니다'));
    if (!hit) {
      elCache.set(src, img);
      img.src = src;
    }
  });
}

/** 동기 버전: 아직 로드되지 않았으면 null 을 반환하고 로딩을 시작한다. onReady 는 로드 완료 시 호출 */
export function cachedImageEl(src: string, onReady?: () => void): HTMLImageElement | null {
  const img = elCache.get(src);
  if (img?.complete && img.naturalWidth) return img;
  void loadImageEl(src).then(() => onReady?.());
  return null;
}

/** 0 = 검정(최대 출력), 1 = 흰색. 알파는 흰색으로 합성 */
export function grayOf(img: HTMLImageElement): GrayImage {
  const hit = grayCache.get(img.src);
  if (hit) return hit;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255;
    const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    data[i] = l * a + (1 - a);
  }
  const g = { w, h, data };
  grayCache.set(img.src, g);
  return g;
}

/** 출력용 픽셀 데이터를 미리 모두 로드 */
export async function grayForShapes(shapes: ImageShape[]): Promise<Map<string, GrayImage>> {
  const m = new Map<string, GrayImage>();
  for (const s of shapes) m.set(s.id, grayOf(await loadImageEl(s.src)));
  return m;
}

export async function importImage(file: Blob, layer: number, name = 'Image'): Promise<ImageShape> {
  const src = await readAsDataURL(file);
  const img = await loadImageEl(src);
  const pxW = img.naturalWidth;
  const pxH = img.naturalHeight;
  // 기본 96 DPI 로 크기 결정, 너무 크면 폭 100mm 로 축소
  let w = (pxW * 25.4) / 96;
  let h = (pxH * 25.4) / 96;
  if (w > 100) {
    h *= 100 / w;
    w = 100;
  }
  return { id: newId(), name, type: 'image', layer, transform: [1, 0, 0, 1, 10, 10], src, pxW, pxH, w, h };
}
