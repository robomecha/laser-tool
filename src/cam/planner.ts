// 문서 → Job 변환. 레이어별 모드에 따라 경로를 만든다.
import { LaserDocument } from '../core/document';
import { Vec } from '../core/geometry';
import { LayerMode } from '../core/layers';
import { ImageShape, Shape, worldPaths } from '../core/shapes';
import { fillMoves } from './fill';
import { Job, JobBlock } from './job';
import { GrayImage, rasterMoves } from './raster';
import { vectorMoves } from './vector';

export interface PlanOptions {
  selectedOnly?: boolean;
  /** 출력 시작 위치 (문서 좌표) – 경로 순서 최적화 기준 */
  start?: Vec;
  innerFirst?: boolean;
  /** 이미지 도형 id → 픽셀 데이터 */
  images?: Map<string, GrayImage>;
}

// 각인을 먼저, 절단을 마지막에 (절단된 조각이 움직여 각인이 어긋나는 것을 방지)
const MODE_ORDER: Record<LayerMode, number> = { image: 0, fill: 1, line: 2 };

export function planJob(doc: LaserDocument, opt: PlanOptions = {}): { job: Job; warnings: string[] } {
  const warnings: string[] = [];
  const shapes: Shape[] = opt.selectedOnly && doc.selection.size ? doc.selected() : doc.shapes;
  const layers = doc
    .usedLayers()
    .filter((l) => l.output)
    .sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode] || a.index - b.index);

  const blocks: JobBlock[] = [];
  let pos = opt.start ?? { x: 0, y: 0 };

  for (const l of layers) {
    const ls = shapes.filter((s) => s.layer === l.index);
    if (!ls.length) continue;
    const base = { layer: l.index, speed: l.speed, power: l.power, minPower: l.minPower, airAssist: l.airAssist };

    for (let pass = 0; pass < Math.max(1, l.passes); pass++) {
      if (l.mode === 'line' || l.mode === 'fill') {
        const vectors = ls.filter((s) => s.type === 'vector').flatMap(worldPaths);
        if (ls.some((s) => s.type === 'image')) warnings.push(`${l.name}: 이미지는 '이미지' 모드 레이어에서만 출력됩니다`);
        const moves =
          l.mode === 'line'
            ? vectorMoves(vectors, l.power, { innerFirst: opt.innerFirst ?? true, start: pos })
            : fillMoves(vectors, { interval: l.interval, angleDeg: l.angle, bidirectional: l.bidirectional, overscan: l.overscan, power: l.power });
        if (l.mode === 'fill' && vectors.length && !vectors.some((v) => v.closed)) warnings.push(`${l.name}: 채우기는 닫힌 도형만 가능합니다`);
        if (moves.length) blocks.push({ ...base, kind: l.mode === 'line' ? 'vector' : 'fill', moves });
      } else {
        const imgs = ls.filter((s): s is ImageShape => s.type === 'image');
        if (imgs.length < ls.length) warnings.push(`${l.name}: 이미지 모드에서는 벡터 도형이 무시됩니다`);
        for (const s of imgs) {
          const g = opt.images?.get(s.id);
          if (!g) {
            warnings.push(`${s.name}: 이미지 데이터를 불러오지 못했습니다`);
            continue;
          }
          const moves = rasterMoves(g, {
            w: s.w, h: s.h, transform: s.transform, interval: l.interval, power: l.power, minPower: l.minPower,
            dither: l.dither, negative: l.negative, bidirectional: l.bidirectional, overscan: l.overscan,
          });
          if (moves.length) blocks.push({ ...base, kind: 'raster', moves });
        }
      }
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock?.moves.length) pos = lastBlock.moves[lastBlock.moves.length - 1];
    }
  }
  return { job: { blocks }, warnings: [...new Set(warnings)] };
}
