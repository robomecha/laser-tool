// GRBL 1.1 레이저 모드용 G-code 생성기
import { DeviceSettings, toMachine } from '../core/device';
import { Job } from '../cam/job';

const fmt = (v: number) => {
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

export interface GcodeOptions {
  /** 작업 후 원점 복귀 */
  returnHome?: boolean;
  comment?: string;
}

export function jobToGcode(job: Job, dev: DeviceSettings, opt: GcodeOptions = {}): string {
  const out: string[] = [];
  out.push(`; ${opt.comment ?? 'laser-tool'} – GRBL`);
  out.push(`; Bed ${dev.bedWidth}x${dev.bedHeight} mm, origin ${dev.origin}`);
  out.push('G00 G17 G40 G21 G54');
  out.push('G90');
  out.push(dev.dynamicPower ? 'M4' : 'M3');

  let lastF = -1;
  let lastS = -1;
  let air = false;
  let lastMode = '';
  let x = NaN;
  let y = NaN;

  for (const bl of job.blocks) {
    out.push(`; Layer C${String(bl.layer).padStart(2, '0')} (${bl.kind}) ${bl.speed}mm/s ${bl.power}%`);
    if (bl.airAssist !== air) {
      out.push(bl.airAssist ? 'M8' : 'M9');
      air = bl.airAssist;
    }
    const F = Math.round(bl.speed * 60);
    for (const m of bl.moves) {
      const q = toMachine(dev, m.x, m.y);
      const sameXY = Math.abs(q.x - x) < 5e-4 && Math.abs(q.y - y) < 5e-4;
      if (m.p < 0) {
        if (sameXY) continue;
        // G0 는 레이저 모드에서 자동으로 출력이 꺼진다
        out.push(`G0 X${fmt(q.x)} Y${fmt(q.y)}`);
        lastMode = 'G0';
      } else {
        if (sameXY) continue;
        let line = lastMode === 'G1' ? '' : 'G1 ';
        line += `X${fmt(q.x)} Y${fmt(q.y)}`;
        const S = Math.round((m.p / 100) * dev.sMax);
        if (S !== lastS) {
          line += ` S${S}`;
          lastS = S;
        }
        if (F !== lastF) {
          line += ` F${F}`;
          lastF = F;
        }
        out.push(line);
        lastMode = 'G1';
      }
      x = q.x;
      y = q.y;
    }
  }
  out.push('M5');
  if (air) out.push('M9');
  if (opt.returnHome ?? true) out.push('G0 X0 Y0');
  out.push('M2');
  return out.join('\n') + '\n';
}
