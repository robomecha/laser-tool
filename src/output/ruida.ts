// Ruida(RDC644x 등, RDWorks 사용 컨트롤러) .rd 바이너리 생성기 – 실험적 기능
//
// 참고: Ruida 프로토콜은 비공개이며, 아래 명령 집합은 공개된 역공학 자료
// (EduTech Wiki "Ruida", MeerK40t 의 Ruida 구현 등)를 바탕으로 한 최소 부분집합이다.
// 실제 장비에 쓰기 전 반드시 저출력으로 시험할 것.
//
// - 모든 바이트는 "swizzle"(비트0↔비트7 교환, XOR magic, +1) 되어 저장/전송된다. RDC644x 의 magic = 0x88
// - 좌표/속도는 7비트씩 나눈 5바이트(35비트) 정수, 단위 µm 및 µm/s
// - 출력(%)은 14비트 값(0~0x3FFF)을 2바이트로
import { DeviceSettings, toMachine } from '../core/device';
import { layerColor } from '../core/layers';
import { Job } from '../cam/job';

export const RUIDA_MAGIC = 0x88;

export function swizzleByte(b: number, magic = RUIDA_MAGIC): number {
  b &= 0xff;
  b ^= (b >> 7) & 0xff;
  b ^= (b << 7) & 0xff;
  b ^= (b >> 7) & 0xff;
  b ^= magic;
  return (b + 1) & 0xff;
}

export function unswizzleByte(b: number, magic = RUIDA_MAGIC): number {
  b = (b - 1) & 0xff;
  b ^= magic;
  b ^= (b >> 7) & 0xff;
  b ^= (b << 7) & 0xff;
  b ^= (b >> 7) & 0xff;
  return b;
}

export function swizzle(data: Uint8Array, magic = RUIDA_MAGIC): Uint8Array {
  return data.map((b) => swizzleByte(b, magic));
}

export function unswizzle(data: Uint8Array, magic = RUIDA_MAGIC): Uint8Array {
  return data.map((b) => unswizzleByte(b, magic));
}

/** 35비트 2의 보수 → 7비트 × 5바이트 (상위 바이트 먼저) */
export function encodeNumber(v: number): number[] {
  let n = BigInt(Math.round(v));
  if (n < 0n) n += 1n << 35n;
  const out: number[] = [];
  for (let i = 4; i >= 0; i--) out.push(Number((n >> BigInt(7 * i)) & 0x7fn));
  return out;
}

export function decodeNumber(b: ArrayLike<number>, off = 0): number {
  let n = 0n;
  for (let i = 0; i < 5; i++) n = (n << 7n) | BigInt(b[off + i] & 0x7f);
  if (n & (1n << 34n)) n -= 1n << 35n;
  return Number(n);
}

export function encodePower(pct: number): number[] {
  const v = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 0x3fff);
  return [(v >> 7) & 0x7f, v & 0x7f];
}

export function decodePower(b: ArrayLike<number>, off = 0): number {
  return ((((b[off] & 0x7f) << 7) | (b[off + 1] & 0x7f)) * 100) / 0x3fff;
}

const um = (mm: number) => mm * 1000;

class Writer {
  bytes: number[] = [];
  cmd(...parts: (number | number[])[]): void {
    for (const p of parts) {
      if (Array.isArray(p)) this.bytes.push(...p);
      else this.bytes.push(p & 0xff);
    }
  }
  xy(x: number, y: number): number[] {
    return [...encodeNumber(um(x)), ...encodeNumber(um(y))];
  }
}

function colorValue(hex: string): number {
  // Ruida 레이어 색: 0x00BBGGRR 형식
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (b << 16) | (g << 8) | r;
}

/** 반환값은 swizzle 되기 전의 평문 명령 바이트 */
export interface RuidaOptions {
  /** 헤더에 D8 00 (작업 시작)을 넣는다. 파일 저장용은 false, 직접 전송은 true */
  startProcess?: boolean;
}

export function jobToRuidaPlain(job: Job, dev: DeviceSettings, opt: RuidaOptions = {}): Uint8Array {
  const w = new Writer();
  // 기계 좌표 변환 + 전체/레이어 범위 계산
  const blocks = job.blocks.map((bl) => ({ bl, pts: bl.moves.map((m) => ({ ...toMachine(dev, m.x, m.y), p: m.p })) }));
  const bounds = (pts: { x: number; y: number }[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    return pts.length ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  };
  const all = bounds(blocks.flatMap((b) => b.pts));

  // Ruida 는 레이어 번호 0..N-1 을 쓴다. 같은 색 레이어 블록은 같은 번호.
  const layerIds = [...new Set(job.blocks.map((b) => b.layer))];
  const rdLayer = (l: number) => layerIds.indexOf(l);

  // ---- 헤더 (MeerK40t rdjob.write_header 와 같은 순서) ----
  w.cmd(0xd8, 0x10); // 기준점: 기계 원점
  w.cmd(0xe6, 0x01); // 절대 좌표
  w.cmd(0xf0);
  w.cmd(0xf1, 0x02, 0x00);
  if (opt.startProcess) w.cmd(0xd8, 0x00); // 수신 즉시 작업 시작 (USB/UDP 직접 전송 시)
  w.cmd(0xe7, 0x06, w.xy(0, 0));
  w.cmd(0xe7, 0x38, 0x00);
  w.cmd(0xe7, 0x03, w.xy(all.x0, all.y0));
  w.cmd(0xe7, 0x07, w.xy(all.x1, all.y1));
  w.cmd(0xe7, 0x50, w.xy(all.x0, all.y0));
  w.cmd(0xe7, 0x51, w.xy(all.x1, all.y1));
  w.cmd(0xe7, 0x04, 0x00, 0x01, 0x00, 0x01, w.xy(0, 0));
  w.cmd(0xe7, 0x05, 0x00);

  // ---- 레이어(part) 설정 ----
  for (const lid of layerIds) {
    const i = rdLayer(lid);
    const first = job.blocks.find((b) => b.layer === lid)!;
    const lb = bounds(blocks.filter((b) => b.bl.layer === lid).flatMap((b) => b.pts));
    w.cmd(0xc9, 0x04, i, encodeNumber(um(first.speed)));
    w.cmd(0xc6, 0x31, i, encodePower(first.minPower));
    w.cmd(0xc6, 0x32, i, encodePower(first.power));
    w.cmd(0xca, 0x06, i, encodeNumber(colorValue(layerColor(lid))));
    w.cmd(0xca, 0x41, i, 0x00);
    w.cmd(0xe7, 0x52, i, w.xy(lb.x0, lb.y0));
    w.cmd(0xe7, 0x53, i, w.xy(lb.x1, lb.y1));
  }
  w.cmd(0xca, 0x22, Math.max(0, layerIds.length - 1));

  // ---- 본문 ----
  blocks.forEach(({ bl, pts }, bi) => {
    if (bi > 0) layerEnd(w);
    w.cmd(0xca, 0x02, rdLayer(bl.layer));
    w.cmd(0xca, 0x01, 0x10);
    w.cmd(0xca, 0x01, bl.airAssist ? 0x13 : 0x12);
    w.cmd(0xc9, 0x02, encodeNumber(um(bl.speed)));
    w.cmd(0xc6, 0x01, encodePower(bl.minPower));
    w.cmd(0xc6, 0x02, encodePower(bl.power));
    w.cmd(0xca, 0x03, 0x01);
    let curPow = bl.power;
    for (const p of pts) {
      if (p.p <= 0) {
        // 레이저 끈 이동 (오버스캔 포함)
        w.cmd(0x88, w.xy(p.x, p.y));
      } else {
        if (Math.abs(p.p - curPow) > 0.01) {
          w.cmd(0xc6, 0x01, encodePower(Math.min(p.p, bl.minPower)));
          w.cmd(0xc6, 0x02, encodePower(p.p));
          curPow = p.p;
        }
        w.cmd(0xa8, w.xy(p.x, p.y));
      }
    }
  });

  // ---- 끝 ----
  layerEnd(w);
  const sum = w.bytes.reduce((a, b) => a + b, 0) + 0xd7;
  w.cmd(0xe5, 0x05, encodeNumber(sum));
  w.cmd(0xd7);
  return Uint8Array.from(w.bytes);
}

function layerEnd(w: Writer): void {
  w.cmd(0xe7, 0x00);
  w.cmd(0xca, 0x01, 0x00);
  w.cmd(0xca, 0x01, 0x30);
}

export function jobToRuidaFile(job: Job, dev: DeviceSettings, opt: RuidaOptions = {}): Uint8Array {
  return swizzle(jobToRuidaPlain(job, dev, opt), dev.ruidaMagic ?? RUIDA_MAGIC);
}

/** 디버깅용 역어셈블러 (평문 바이트 입력). 알려진 명령만 해석하고 나머지는 16진수로 표시 */
export function disassembleRuida(plain: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  const mm = (off: number) => (decodeNumber(plain, off) / 1000).toFixed(3);
  while (i < plain.length) {
    const c = plain[i];
    const sub = plain[i + 1];
    if (c === 0x88) {
      out.push(`MOVE_ABS ${mm(i + 1)}, ${mm(i + 6)}`);
      i += 11;
    } else if (c === 0xa8) {
      out.push(`CUT_ABS  ${mm(i + 1)}, ${mm(i + 6)}`);
      i += 11;
    } else if (c === 0xc9 && sub === 0x02) {
      out.push(`SPEED ${mm(i + 2)} mm/s`);
      i += 7;
    } else if (c === 0xc9 && sub === 0x04) {
      out.push(`LAYER_SPEED L${plain[i + 2]} ${mm(i + 3)} mm/s`);
      i += 8;
    } else if (c === 0xc6 && (sub === 0x01 || sub === 0x02)) {
      out.push(`${sub === 1 ? 'MIN' : 'MAX'}_POWER ${decodePower(plain, i + 2).toFixed(1)}%`);
      i += 4;
    } else if (c === 0xc6 && (sub === 0x31 || sub === 0x32)) {
      out.push(`LAYER_${sub === 0x31 ? 'MIN' : 'MAX'}_POWER L${plain[i + 2]} ${decodePower(plain, i + 3).toFixed(1)}%`);
      i += 5;
    } else if (c === 0xe7 && [0x03, 0x06, 0x07, 0x50, 0x51].includes(sub)) {
      out.push(`BOUNDS_${sub.toString(16)} ${mm(i + 2)}, ${mm(i + 7)}`);
      i += 12;
    } else if (c === 0xe7 && (sub === 0x52 || sub === 0x53)) {
      out.push(`LAYER_BOUNDS_${sub.toString(16)} L${plain[i + 2]} ${mm(i + 3)}, ${mm(i + 8)}`);
      i += 13;
    } else if (c === 0xe7 && sub === 0x04) {
      out.push('E7 04 …');
      i += 16;
    } else if (c === 0xca && sub === 0x06) {
      out.push(`LAYER_COLOR L${plain[i + 2]} #${decodeNumber(plain, i + 3).toString(16).padStart(6, '0')}`);
      i += 8;
    } else if (c === 0xca && [0x01, 0x02, 0x03, 0x10, 0x22].includes(sub)) {
      out.push(`CA ${sub.toString(16).padStart(2, '0')} ${plain[i + 2].toString(16).padStart(2, '0')}`);
      i += 3;
    } else if (c === 0xca && sub === 0x41) {
      out.push(`LAYER_MODE L${plain[i + 2]} ${plain[i + 3]}`);
      i += 4;
    } else if (c === 0xe7 && (sub === 0x00 || sub === 0x05)) {
      out.push(`E7 ${sub.toString(16).padStart(2, '0')}`);
      i += sub === 0x05 ? 3 : 2;
    } else if (c === 0xd8) {
      const names: Record<number, string> = { 0x00: 'START', 0x01: 'STOP', 0x02: 'PAUSE', 0x03: 'RESUME', 0x10: 'REF_MACHINE_ZERO', 0x12: 'REF_CURRENT', 0x2a: 'HOME_XY' };
      out.push(`D8 ${names[sub] ?? sub.toString(16)}`);
      i += 2;
    } else if (c === 0xe6 && sub === 0x01) {
      out.push('ABSOLUTE');
      i += 2;
    } else if (c === 0xe7 && sub === 0x38) {
      out.push('FEED_AUTO_PAUSE 0');
      i += 3;
    } else if (c === 0xe5 && sub === 0x05) {
      out.push(`FILE_SUM ${decodeNumber(plain, i + 2)}`);
      i += 7;
    } else if (c === 0xd9 && sub === 0x10) {
      out.push(`RAPID_XY ${mm(i + 3)}, ${mm(i + 8)}`);
      i += 13;
    } else if (c === 0xda && sub === 0x00) {
      out.push(`GET_SETTING ${plain[i + 2].toString(16).padStart(2, '0')}${plain[i + 3].toString(16).padStart(2, '0')}`);
      i += 4;
    } else if (c === 0xf1) {
      out.push('F1 02 00');
      i += 3;
    } else if (c === 0xd7) {
      out.push('EOF');
      i += 1;
    } else if (c === 0xeb || c === 0xf0) {
      out.push(c === 0xeb ? 'FINISH' : 'F0');
      i += 1;
    } else {
      out.push(`?? ${c.toString(16).padStart(2, '0')}`);
      i += 1;
    }
  }
  return out;
}
