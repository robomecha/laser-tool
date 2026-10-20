import { describe, expect, it } from 'vitest';
import { handlers, AiContext } from '../src/ai/handlers';
import { defaultDevice } from '../src/core/device';
import { LaserDocument } from '../src/core/document';
import type { TextTool } from '../src/ui/text-tool';

const makeCtx = (): AiContext => ({
  doc: new LaserDocument(),
  device: defaultDevice,
  textTool: { fontNames: () => ['test'], fontAt: async () => { throw new Error('no font in test'); } } as unknown as TextTool,
});

type Created = { created: { id: string; bbox: { x: number; y: number; width: number; height: number } }[] };

describe('AI handlers', () => {
  it('draws shapes on requested layers with correct bounds', async () => {
    const ctx = makeCtx();
    const r = (await handlers.draw_shapes(ctx, {
      shapes: [
        { type: 'rect', x: 10, y: 20, width: 30, height: 40, radius: 5, layer: 2 },
        { type: 'circle', cx: 100, cy: 100, r: 10 },
        { type: 'path', d: 'M0 0 L10 0 L10 10 Z', layer: 4 },
      ],
    })) as Created;
    expect(r.created).toHaveLength(3);
    expect(r.created[0].bbox).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(r.created[1].bbox.width).toBeCloseTo(20, 1);
    expect(ctx.doc.shapes.map((s) => s.layer)).toEqual([2, 0, 4]);
  });

  it('transforms by moveTo / width and undoes', async () => {
    const ctx = makeCtx();
    const r = (await handlers.draw_shapes(ctx, { shapes: [{ type: 'rect', x: 0, y: 0, width: 10, height: 5 }] })) as Created;
    const t = (await handlers.transform_shapes(ctx, { ids: [r.created[0].id], width: 40, moveTo: { x: 50, y: 60 } })) as { bbox: Created['created'][0]['bbox'] };
    expect(t.bbox.x).toBeCloseTo(50);
    expect(t.bbox.y).toBeCloseTo(60);
    expect(t.bbox.width).toBeCloseTo(40);
    expect(t.bbox.height).toBeCloseTo(20);
    await handlers.undo(ctx, {});
    expect(ctx.doc.shapes).toHaveLength(1);
  });

  it('sets layer settings and plans a job preview', async () => {
    const ctx = makeCtx();
    await handlers.draw_shapes(ctx, { shapes: [{ type: 'rect', x: 10, y: 10, width: 20, height: 20, layer: 1 }] });
    const l = (await handlers.set_layer(ctx, { layer: 1, mode: 'fill', speed: 100, power: 25 })) as { mode: string; speed: number };
    expect(l.mode).toBe('fill');
    expect(l.speed).toBe(100);
    const pv = (await handlers.preview_job(ctx, {})) as { blocks: { kind: string }[] };
    expect(pv.blocks[0].kind).toBe('fill');
  });

  it('rejects unknown ids and supports boolean union', async () => {
    const ctx = makeCtx();
    expect(() => handlers.transform_shapes(ctx, { ids: ['nope'], dx: 1 })).toThrow(/없는 도형/);
    const r = (await handlers.draw_shapes(ctx, {
      shapes: [
        { type: 'rect', x: 0, y: 0, width: 10, height: 10 },
        { type: 'rect', x: 5, y: 0, width: 10, height: 10 },
      ],
    })) as Created;
    const u = (await handlers.boolean_shapes(ctx, { ids: r.created.map((c) => c.id), op: 'union' })) as { bbox: { width: number } };
    expect(u.bbox.width).toBeCloseTo(15);
    expect(ctx.doc.shapes).toHaveLength(1);
  });
});

describe('AI array tool', () => {
  it('grid and circular arrays add copies', async () => {
    const ctx = makeCtx();
    const r = (await handlers.draw_shapes(ctx, { shapes: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10 }] })) as Created;
    const g = (await handlers.array_shapes(ctx, { ids: [r.created[0].id], kind: 'grid', columns: 3, rows: 2, spacingX: 2, spacingY: 2 })) as { created: string[] };
    expect(g.created).toHaveLength(5);
    const c = (await handlers.array_shapes(ctx, { ids: [r.created[0].id], kind: 'circular', count: 4, centerX: 5, centerY: 40 })) as { created: string[] };
    expect(c.created).toHaveLength(3);
    expect(ctx.doc.shapes).toHaveLength(9);
    expect(() => handlers.array_shapes(ctx, { ids: [r.created[0].id], kind: 'circular', count: 3 })).toThrow(/center/);
  });
});

describe('AI polygon shapes', () => {
  it('draws a hexagon and a 5-point star', async () => {
    const ctx = makeCtx();
    const r = (await handlers.draw_shapes(ctx, {
      shapes: [
        { type: 'polygon', cx: 50, cy: 50, r: 20, sides: 6 },
        { type: 'polygon', cx: 120, cy: 50, r: 20, sides: 5, star: true, innerRatio: 0.4 },
      ],
    })) as Created;
    const [hex, star] = ctx.doc.shapes;
    if (hex.type !== 'vector' || star.type !== 'vector') throw new Error();
    expect(hex.paths[0].pts).toHaveLength(6);
    expect(star.paths[0].pts).toHaveLength(10);
    // 별은 꼭짓점이 위: 위쪽 끝이 중심에서 r 만큼
    expect(r.created[1].bbox.y).toBeCloseTo(30);
    // 육각형 밑변 수평: 높이 = r*sqrt(3)
    expect(r.created[0].bbox.height).toBeCloseTo(20 * Math.sqrt(3), 1);
  });
});
