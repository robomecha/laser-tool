import { describe, expect, it } from 'vitest';
import { circularArray, gridArray } from '../src/core/array';
import { rectPolyline } from '../src/core/geometry';
import { makeVector, shapeBBox, shapeCenter } from '../src/core/shapes';

const square = () => makeVector([rectPolyline(0, 0, 10, 10)], 3);

describe('grid array', () => {
  it('makes rows×cols-1 copies with gap spacing', () => {
    const copies = gridArray([square()], { columns: 3, rows: 2, spacingX: 5, spacingY: 2, spacing: 'gap' });
    expect(copies).toHaveLength(5);
    const xs = [...new Set(copies.map((c) => Math.round(shapeBBox(c).minX)))].sort((a, b) => a - b);
    expect(xs).toEqual([0, 15, 30]);
    expect(Math.max(...copies.map((c) => shapeBBox(c).minY))).toBeCloseTo(12);
    expect(copies.every((c) => c.layer === 3)).toBe(true);
  });

  it('uses center pitch when spacing=pitch and gives new ids', () => {
    const s = square();
    const copies = gridArray([s], { columns: 2, rows: 1, spacingX: 25, spacingY: 0, spacing: 'pitch' });
    expect(shapeBBox(copies[0]).minX).toBeCloseTo(25);
    expect(copies[0].id).not.toBe(s.id);
  });
});

describe('circular array', () => {
  it('spreads copies evenly around the center', () => {
    const s = makeVector([rectPolyline(45, -5, 10, 10)], 0); // 중심 (50,0), 반지름 50
    const copies = circularArray([s], { count: 4, center: { x: 0, y: 0 }, totalAngle: 360, rotateCopies: true });
    expect(copies).toHaveLength(3);
    const c = copies.map(shapeCenter);
    expect(c[0].x).toBeCloseTo(0);
    expect(c[0].y).toBeCloseTo(50);
    expect(c[1].x).toBeCloseTo(-50);
    expect(c[2].y).toBeCloseTo(-50);
  });

  it('keeps orientation when rotateCopies=false and includes both ends for partial arcs', () => {
    const s = makeVector([rectPolyline(40, -5, 20, 10)], 0);
    const copies = circularArray([s], { count: 3, center: { x: 0, y: 0 }, totalAngle: 180, rotateCopies: false });
    const last = shapeBBox(copies[1]);
    expect((last.minX + last.maxX) / 2).toBeCloseTo(-50);
    expect(last.maxX - last.minX).toBeCloseTo(20); // 회전하지 않아 폭 유지
  });
});
