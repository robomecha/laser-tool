// 가공 작업(Job) 표현: 컨트롤러와 무관한 중간 표현. 출력기(G-code, Ruida)가 이를 변환한다.
import { addPoint, BBox, emptyBBox } from '../core/geometry';

/**
 * p < 0  : 레이저 끈 채로 급속 이동 (G0)
 * p == 0 : 블록 속도로 레이저 끈 채 이동 (오버스캔 등)
 * p > 0  : 블록 속도로 출력 p% 로 가공
 */
export interface JobMove {
  x: number;
  y: number;
  p: number;
}

export type BlockKind = 'vector' | 'fill' | 'raster';

export interface JobBlock {
  layer: number;
  kind: BlockKind;
  /** mm/s */
  speed: number;
  power: number;
  minPower: number;
  airAssist: boolean;
  moves: JobMove[];
}

export interface Job {
  blocks: JobBlock[];
}

export function jobBBox(job: Job, cutOnly = true): BBox {
  const b = emptyBBox();
  for (const bl of job.blocks) {
    let prev: JobMove | null = null;
    for (const m of bl.moves) {
      if (!cutOnly || m.p > 0) {
        if (prev && cutOnly) addPoint(b, prev);
        addPoint(b, m);
      }
      prev = m;
    }
  }
  return b;
}

export interface JobStats {
  cutLength: number;
  travelLength: number;
  /** 초 (가감속 미반영 근사치) */
  seconds: number;
  moveCount: number;
}

export function estimateJob(job: Job, travelSpeed: number, start = { x: 0, y: 0 }): JobStats {
  let cut = 0;
  let travel = 0;
  let t = 0;
  let n = 0;
  let pos = start;
  for (const bl of job.blocks) {
    for (const m of bl.moves) {
      const d = Math.hypot(m.x - pos.x, m.y - pos.y);
      if (m.p < 0) {
        travel += d;
        t += d / travelSpeed;
      } else {
        if (m.p > 0) cut += d;
        else travel += d;
        t += d / bl.speed;
      }
      pos = m;
      n++;
    }
  }
  // 가감속 손실 보정 계수 (경험치)
  return { cutLength: cut, travelLength: travel, seconds: t * 1.1, moveCount: n };
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
