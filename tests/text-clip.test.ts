/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { booleanOp, offsetPolylines } from '../src/core/clip';
import { bboxOfPolylines, ellipsePolyline, Polyline, rectPolyline, signedArea } from '../src/core/geometry';
import { commandsToPolylines, textToPolylines } from '../src/core/text';
import { parseFont } from '../src/io/font';

const area = (ls: Polyline[]) => ls.reduce((a, l) => a + Math.abs(signedArea(l.pts)), 0);
/** 바깥(양)·구멍(음) 방향을 반영한 순 면적 */
const netArea = (ls: Polyline[]) => Math.abs(ls.reduce((a, l) => a + signedArea(l.pts), 0));

const fontBuf = readFileSync('node_modules/@expo-google-fonts/nanum-gothic/400Regular/NanumGothic_400Regular.ttf');
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

describe('text', () => {
  it('flattens path commands into closed polylines', () => {
    const ls = commandsToPolylines([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'Q', x1: 15, y1: 5, x: 10, y: 10 },
      { type: 'L', x: 0, y: 0 },
      { type: 'Z' },
    ]);
    expect(ls).toHaveLength(1);
    expect(ls[0].closed).toBe(true);
    expect(ls[0].pts.length).toBeGreaterThan(4);
    // 닫는 점 중복 제거
    expect(ls[0].pts[ls[0].pts.length - 1]).not.toEqual(ls[0].pts[0]);
  });

  it('converts Latin and Hangul text from a TTF', () => {
    const ls = textToPolylines(font, 'Ag 한글', { size: 20 });
    expect(ls.length).toBeGreaterThan(5);
    expect(ls.every((l) => l.closed)).toBe(true);
    const b = bboxOfPolylines(ls);
    // 기준선이 y=0, 글자는 위(−Y)로, 'g' 꼬리는 아래(+Y)로
    expect(b.minY).toBeLessThan(-10);
    expect(b.minY).toBeGreaterThan(-20);
    expect(b.maxY).toBeGreaterThan(0);
    expect(b.minX).toBeGreaterThanOrEqual(0);
  });

  it('stacks lines downward and aligns', () => {
    const one = bboxOfPolylines(textToPolylines(font, 'H', { size: 10 }));
    const two = bboxOfPolylines(textToPolylines(font, 'H\nH', { size: 10, lineHeight: 1.5 }));
    expect(two.maxY - one.maxY).toBeCloseTo(15, 1);
    const right = bboxOfPolylines(textToPolylines(font, 'HHH', { size: 10, align: 'right' }));
    expect(right.maxX).toBeLessThanOrEqual(0.01);
    const center = bboxOfPolylines(textToPolylines(font, 'HHH', { size: 10, align: 'center' }));
    expect(Math.abs(center.minX + center.maxX)).toBeLessThan(1);
  });
});

describe('boolean', () => {
  const a = [rectPolyline(0, 0, 10, 10)];
  const b = [rectPolyline(5, 5, 10, 10)];

  it('union / difference / intersection / xor areas', () => {
    expect(area(booleanOp('union', [a, b]))).toBeCloseTo(175, 3);
    expect(area(booleanOp('difference', [a, b]))).toBeCloseTo(75, 3);
    expect(area(booleanOp('intersection', [a, b]))).toBeCloseTo(25, 3);
    expect(netArea(booleanOp('xor', [a, b]))).toBeCloseTo(150, 3);
  });

  it('keeps holes of a shape when unioned with another', () => {
    const ring = [rectPolyline(0, 0, 30, 30), rectPolyline(10, 10, 10, 10)];
    const far = [rectPolyline(50, 0, 10, 10)];
    const res = booleanOp('union', [ring, far]);
    expect(res).toHaveLength(3);
    expect(netArea(res)).toBeCloseTo(900 - 100 + 100, 3);
  });

  it('difference punches a hole', () => {
    const res = booleanOp('difference', [[rectPolyline(0, 0, 30, 30)], [rectPolyline(10, 10, 10, 10)]]);
    expect(res).toHaveLength(2);
    expect(netArea(res)).toBeCloseTo(800, 3);
  });

  it('ignores open paths and empty input', () => {
    expect(booleanOp('union', [])).toEqual([]);
    expect(booleanOp('union', [[{ pts: [{ x: 0, y: 0 }, { x: 5, y: 5 }], closed: false }]])).toEqual([]);
  });
});

describe('offset', () => {
  it('grows and shrinks a square', () => {
    const sq = [rectPolyline(0, 0, 10, 10)];
    const out = offsetPolylines(sq, 1, { join: 'miter' });
    const b = bboxOfPolylines(out);
    expect(b.minX).toBeCloseTo(-1, 3);
    expect(b.maxY).toBeCloseTo(11, 3);
    expect(area(out)).toBeCloseTo(144, 2);
    expect(area(offsetPolylines(sq, -2))).toBeCloseTo(36, 2);
    expect(offsetPolylines(sq, -6)).toEqual([]);
  });

  it('round join approximates the Minkowski area', () => {
    const out = offsetPolylines([rectPolyline(0, 0, 10, 10)], 2, { join: 'round' });
    expect(area(out)).toBeCloseTo(100 + 4 * 20 + Math.PI * 4, 0);
  });

  it('offsets a circle radius', () => {
    const out = offsetPolylines([ellipsePolyline(0, 0, 10, 10)], 3);
    const b = bboxOfPolylines(out);
    expect(b.maxX).toBeCloseTo(13, 1);
  });

  it('turns an open line into an outline', () => {
    const out = offsetPolylines([{ pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false }], 1);
    expect(out).toHaveLength(1);
    expect(out[0].closed).toBe(true);
    const b = bboxOfPolylines(out);
    expect(b.minY).toBeCloseTo(-1, 2);
    expect(b.maxX).toBeCloseTo(11, 2);
  });

  it('works on text outlines', () => {
    const t = textToPolylines(font, 'O', { size: 20 });
    const grown = offsetPolylines(t, 0.5);
    expect(netArea(grown)).toBeGreaterThan(netArea(t));
  });
});
