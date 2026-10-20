import { describe, expect, it } from 'vitest';
import { about, apply, ellipsePolyline, invert, mul, pointInPolygon, polylineLength, rotate, scale, svgArcToPoints, translate } from '../src/core/geometry';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('matrix', () => {
  it('composes and inverts', () => {
    const m = mul(translate(10, 5), mul(rotate(0.3), scale(2, 3)));
    const p = { x: 1.5, y: -2 };
    const q = apply(invert(m), apply(m, p));
    close(q.x, p.x);
    close(q.y, p.y);
  });
  it('about() keeps the pivot fixed', () => {
    const m = about(rotate(1), 7, 9);
    const p = apply(m, { x: 7, y: 9 });
    close(p.x, 7);
    close(p.y, 9);
  });
});

describe('shapes', () => {
  it('ellipse circumference ≈ 2πr', () => {
    const c = ellipsePolyline(0, 0, 10, 10);
    expect(Math.abs(polylineLength(c) - 2 * Math.PI * 10)).toBeLessThan(0.05);
  });
  it('point in polygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
  it('svg arc half circle ends at target and passes through radius', () => {
    const pts = svgArcToPoints({ x: 0, y: 0 }, 5, 5, 0, false, true, { x: 10, y: 0 });
    const last = pts[pts.length - 1];
    close(last.x, 10);
    close(last.y, 0);
    for (const p of pts) close(Math.hypot(p.x - 5, p.y), 5, 1e-6);
  });
});
