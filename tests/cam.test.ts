import { describe, expect, it } from 'vitest';
import { defaultDevice } from '../src/core/device';
import { LaserDocument } from '../src/core/document';
import { rectPolyline } from '../src/core/geometry';
import { makeVector } from '../src/core/shapes';
import { fillMoves } from '../src/cam/fill';
import { estimateJob } from '../src/cam/job';
import { planJob } from '../src/cam/planner';
import { rasterMoves } from '../src/cam/raster';
import { orderPaths } from '../src/cam/vector';
import { jobToGcode } from '../src/output/gcode';
import {
  decodeNumber,
  decodePower,
  disassembleRuida,
  encodeNumber,
  encodePower,
  jobToRuidaFile,
  jobToRuidaPlain,
  swizzleByte,
  unswizzle,
  unswizzleByte,
} from '../src/output/ruida';

describe('vector ordering', () => {
  it('cuts inner shapes before outer', () => {
    const outer = rectPolyline(0, 0, 100, 100);
    const inner = rectPolyline(40, 40, 10, 10);
    const order = orderPaths([outer, inner], { innerFirst: true, start: { x: 0, y: 0 } });
    expect(order[0][0].x).toBeGreaterThanOrEqual(40);
    // 닫힌 경로는 시작점으로 돌아온다
    expect(order[0][0]).toEqual(order[0][order[0].length - 1]);
  });
});

describe('fill', () => {
  it('hatches a square with the right number of lines and skips holes', () => {
    const sq = rectPolyline(0, 0, 10, 10);
    const hole = rectPolyline(4, 0, 2, 10);
    const moves = fillMoves([sq, hole], { interval: 1, angleDeg: 0, bidirectional: true, overscan: 0, power: 50 });
    const cuts = moves.filter((m) => m.p > 0);
    // 10줄 × 구멍으로 나뉜 2구간
    expect(cuts).toHaveLength(20);
    // 구멍 영역(4<x<6) 안에서 끝나는 가공 이동이 없음
    for (const c of cuts) expect(c.x <= 4 + 1e-9 || c.x >= 6 - 1e-9).toBe(true);
  });
  it('rotated fill stays within bounds', () => {
    const moves = fillMoves([rectPolyline(0, 0, 10, 10)], { interval: 0.5, angleDeg: 45, bidirectional: true, overscan: 0, power: 50 });
    for (const m of moves.filter((x) => x.p > 0)) {
      expect(m.x).toBeGreaterThan(-1e-6);
      expect(m.x).toBeLessThan(10 + 1e-6);
    }
  });
});

describe('raster', () => {
  it('produces cuts only for dark pixels', () => {
    // 2x1 이미지: 왼쪽 검정, 오른쪽 흰색
    const img = { w: 2, h: 1, data: new Float32Array([0, 1]) };
    const moves = rasterMoves(img, {
      w: 2, h: 1, transform: [1, 0, 0, 1, 0, 0], interval: 0.5, power: 80, minPower: 0,
      dither: 'threshold', negative: false, bidirectional: false, overscan: 1,
    });
    const cuts = moves.filter((m) => m.p > 0);
    expect(cuts.length).toBe(2); // 2행
    for (const c of cuts) {
      expect(c.p).toBe(80);
      expect(c.x).toBeCloseTo(1);
    }
  });
});

describe('planner + outputs', () => {
  const makeDoc = () => {
    const doc = new LaserDocument();
    doc.add(makeVector([rectPolyline(10, 10, 20, 20)], 0));
    doc.add(makeVector([rectPolyline(50, 10, 20, 20)], 1));
    doc.updateLayer(1, { mode: 'fill', interval: 1 });
    return doc;
  };

  it('puts fill layers before line layers and estimates time', () => {
    const { job } = planJob(makeDoc());
    expect(job.blocks.map((b) => b.kind)).toEqual(['fill', 'vector']);
    const st = estimateJob(job, 100);
    expect(st.cutLength).toBeGreaterThan(80);
    expect(st.seconds).toBeGreaterThan(0);
  });

  it('skips layers with output disabled', () => {
    const doc = makeDoc();
    doc.updateLayer(1, { output: false });
    expect(planJob(doc).job.blocks).toHaveLength(1);
  });

  it('generates GRBL G-code with flipped Y for bottom-left origin', () => {
    const dev = { ...defaultDevice(), bedHeight: 300, origin: 'bottom-left' as const };
    const doc = new LaserDocument();
    doc.add(makeVector([rectPolyline(10, 10, 20, 20)], 0));
    const g = jobToGcode(planJob(doc).job, dev);
    expect(g).toContain('M4');
    expect(g).toMatch(/G0 X10 Y290/);
    expect(g).toMatch(/S500/); // 기본 50% × 1000
    expect(g).toMatch(/F1200/); // 20mm/s
    expect(g.trim().endsWith('M2')).toBe(true);
  });
});

describe('ruida encoding', () => {
  it('swizzle round-trips every byte', () => {
    for (let b = 0; b < 256; b++) expect(unswizzleByte(swizzleByte(b))).toBe(b);
  });
  it('encodes numbers and power', () => {
    for (const v of [0, 1, 123456, 400000, -5000]) expect(decodeNumber(encodeNumber(v))).toBe(v);
    expect(encodeNumber(1)).toEqual([0, 0, 0, 0, 1]);
    expect(encodeNumber(128)).toEqual([0, 0, 0, 1, 0]);
    expect(decodePower(encodePower(50))).toBeCloseTo(50, 1);
    expect(encodePower(100)).toEqual([0x7f, 0x7f]);
  });
  it('produces a file that disassembles to moves and cuts', () => {
    const doc = new LaserDocument();
    doc.add(makeVector([rectPolyline(10, 10, 20, 20)], 0));
    const dev = { ...defaultDevice(), origin: 'top-left' as const };
    const job = planJob(doc).job;
    const plain = jobToRuidaPlain(job, dev);
    const file = jobToRuidaFile(job, dev);
    expect(Array.from(unswizzle(file))).toEqual(Array.from(plain));
    const asm = disassembleRuida(plain);
    expect(asm.some((l) => l.startsWith('?? '))).toBe(false);
    expect(asm.filter((l) => l.startsWith('CUT_ABS'))).toHaveLength(4);
    expect(asm).toContain('MOVE_ABS 10.000, 10.000');
    expect(asm[asm.length - 1]).toBe('EOF');
  });
});
