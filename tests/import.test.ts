import { describe, expect, it } from 'vitest';
import { bboxOfPolylines, polylineLength } from '../src/core/geometry';
import { importDXF } from '../src/io/dxf-import';
import { parsePathData } from '../src/io/svg-path';

describe('SVG path parser', () => {
  it('parses absolute and relative lines with close', () => {
    const p = parsePathData('M10 10 h20 v20 H10 z m 50 0 l 10 0');
    expect(p).toHaveLength(2);
    expect(p[0].closed).toBe(true);
    expect(p[0].pts).toHaveLength(4);
    expect(p[1].pts[0]).toEqual({ x: 60, y: 10 });
    expect(p[1].pts[1]).toEqual({ x: 70, y: 10 });
  });
  it('handles compact arc flags', () => {
    const p = parsePathData('M0 0a5 5 0 1010 0');
    const last = p[0].pts[p[0].pts.length - 1];
    expect(last.x).toBeCloseTo(10);
    expect(last.y).toBeCloseTo(0);
  });
  it('implicit lineto after moveto and cubic curves', () => {
    const p = parsePathData('M0,0 10,0 C 10 10 20 10 20 0');
    const b = bboxOfPolylines(p);
    expect(b.maxX).toBeCloseTo(20);
    expect(b.maxY).toBeGreaterThan(7);
  });
});

const dxf = (body: string) =>
  ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', body, '0', 'ENDSEC', '0', 'EOF'].join('\n');

describe('DXF import', () => {
  it('imports LINE and CIRCLE and flips Y', () => {
    const text = dxf(
      ['0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '50', '0', 'CIRCLE', '8', '0', '62', '1', '10', '50', '20', '25', '40', '10'].join('\n'),
    );
    const { shapes } = importDXF(text);
    expect(shapes).toHaveLength(2);
    const line = shapes[0];
    if (line.type !== 'vector') throw new Error();
    // Y 뒤집힘: (0,0) → (0,50), (100,50) → (100,0)
    expect(line.paths[0].pts[0]).toEqual({ x: 0, y: 50 });
    expect(line.paths[0].pts[1]).toEqual({ x: 100, y: 0 });
    const circle = shapes[1];
    if (circle.type !== 'vector') throw new Error();
    expect(polylineLength(circle.paths[0])).toBeCloseTo(2 * Math.PI * 10, 0);
    // 색상 1(빨강) → 팔레트 2번(빨강)
    expect(circle.layer).toBe(2);
  });
  it('LWPOLYLINE with bulge forms a semicircle', () => {
    const text = dxf(['0', 'LWPOLYLINE', '90', '2', '70', '0', '10', '0', '20', '0', '42', '1', '10', '10', '20', '0'].join('\n'));
    const { shapes } = importDXF(text);
    const s = shapes[0];
    if (s.type !== 'vector') throw new Error();
    expect(polylineLength(s.paths[0])).toBeCloseTo(Math.PI * 5, 1);
  });
});
