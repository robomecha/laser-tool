/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bboxOfPolylines, ellipsePolyline, Polyline, signedArea } from '../src/core/geometry';
import { textToPolylines } from '../src/core/text';
import { styleTextPaths, textOnPath } from '../src/core/text-style';
import { parseFont } from '../src/io/font';

const fontBuf = readFileSync('node_modules/@expo-google-fonts/nanum-gothic/400Regular/NanumGothic_400Regular.ttf');
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));
const netArea = (ls: Polyline[]) => Math.abs(ls.reduce((a, l) => a + signedArea(l.pts), 0));

describe('text style', () => {
  it('weight makes glyphs thicker and slant shifts the top right', () => {
    const base = textToPolylines(font, 'H', { size: 20 });
    const bold = styleTextPaths(base, { weight: 0.5 });
    expect(netArea(bold)).toBeGreaterThan(netArea(styleTextPaths(base)) * 1.1);
    const italic = styleTextPaths(base, { slant: 12 });
    const b0 = bboxOfPolylines(base);
    const b1 = bboxOfPolylines(italic);
    expect(b1.maxX).toBeGreaterThan(b0.maxX + 2);
    // 기준선(y≈0) 부근은 거의 그대로
    expect(Math.abs(b1.minX - b0.minX)).toBeLessThan(1);
  });

  it('keeps holes (o, ㅇ) after merging', () => {
    const ls = styleTextPaths(textToPolylines(font, 'o', { size: 20 }));
    expect(ls.length).toBe(2);
  });
});

describe('text on path', () => {
  it('places glyphs around a circle', () => {
    const circle = ellipsePolyline(0, 0, 40, 40);
    const ls = textOnPath(font, 'ABCD', circle, { size: 10, position: 75 });
    expect(ls.length).toBeGreaterThanOrEqual(4);
    const b = bboxOfPolylines(ls);
    // position 75% = 원의 위쪽 (y 음수), 글자는 바깥쪽(위)으로
    expect(b.maxY).toBeLessThan(-30);
    expect(b.minY).toBeGreaterThan(-55);
  });

  it('below side puts glyphs inside the circle', () => {
    const circle = ellipsePolyline(0, 0, 40, 40);
    const b = bboxOfPolylines(textOnPath(font, 'ABCD', circle, { size: 10, position: 75, side: 'below' }));
    expect(b.minY).toBeGreaterThan(-41);
  });

  it('drops glyphs beyond an open path end', () => {
    const line: Polyline = { pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }], closed: false };
    const full = textOnPath(font, 'ABCDEFGHIJ', line, { size: 10, position: 50 });
    const b = bboxOfPolylines(full);
    expect(b.minX).toBeGreaterThan(-6);
    expect(b.maxX).toBeLessThan(26);
  });
});
