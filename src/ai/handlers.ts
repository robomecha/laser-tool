// MCP 도구 요청 처리기 (tools/mcp-server.mjs 의 도구와 1:1 대응)
import { DeviceSettings, fromMachine } from '../core/device';
import { LaserDocument } from '../core/document';
import { about, arcPoints, BBox, ellipsePolyline, isEmptyBBox, Mat, mul, Polyline, rectPolyline, rotate, scale, translate, Vec } from '../core/geometry';
import { circularArray, gridArray } from '../core/array';
import { BoolOp, booleanOp, OffsetJoin, offsetPolylines } from '../core/clip';
import { DitherMode, LayerMode, LayerSettings, PALETTE } from '../core/layers';
import { applyToShape, ImageShape, makeVector, Shape, shapeBBox, VectorShape, worldPaths } from '../core/shapes';
import { bboxOfPolylines } from '../core/geometry';
import type { TextAlign } from '../core/text';
import { estimateJob, formatDuration, jobBBox } from '../cam/job';
import { planJob } from '../cam/planner';
import { grayForShapes } from '../io/image-import';
import { importSVG } from '../io/svg-import';
import { parsePathData } from '../io/svg-path';
import { renderSnapshot } from '../ui/snapshot';
import type { TextTool } from '../ui/text-tool';

export interface AiContext {
  doc: LaserDocument;
  device: () => DeviceSettings;
  textTool: TextTool;
}

type Params = Record<string, unknown>;
type Handler = (ctx: AiContext, p: Params) => unknown | Promise<unknown>;

const round = (v: number) => Math.round(v * 100) / 100;
const box = (b: BBox) =>
  isEmptyBBox(b) ? null : { x: round(b.minX), y: round(b.minY), width: round(b.maxX - b.minX), height: round(b.maxY - b.minY) };

function layerOf(ctx: AiContext, p: { layer?: number }): number {
  return p.layer ?? ctx.doc.currentLayer;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): Polyline {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) return rectPolyline(x, y, w, h);
  const pts: Vec[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    pts.push({ x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) }, ...arcPoints(cx, cy, r, r, a0, a0 + Math.PI / 2));
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return { pts, closed: true };
}

interface ShapeSpec {
  type: 'line' | 'polyline' | 'rect' | 'circle' | 'ellipse' | 'path';
  layer?: number;
  name?: string;
  [k: string]: unknown;
}

function specToPaths(s: ShapeSpec): Polyline[] {
  const n = (k: string) => Number(s[k]);
  switch (s.type) {
    case 'line':
      return [{ pts: [{ x: n('x1'), y: n('y1') }, { x: n('x2'), y: n('y2') }], closed: false }];
    case 'polyline':
      return [{ pts: (s.points as [number, number][]).map(([x, y]) => ({ x, y })), closed: Boolean(s.closed) }];
    case 'rect':
      return [roundedRect(n('x'), n('y'), n('width'), n('height'), Number(s.radius ?? 0))];
    case 'circle':
      return [ellipsePolyline(n('cx'), n('cy'), n('r'), n('r'))];
    case 'ellipse':
      return [ellipsePolyline(n('cx'), n('cy'), n('rx'), n('ry'))];
    case 'path':
      return parsePathData(String(s.d));
  }
}

const NAMES: Record<ShapeSpec['type'], string> = {
  line: 'Line', polyline: 'Polyline', rect: 'Rectangle', circle: 'Circle', ellipse: 'Ellipse', path: 'Path',
};

function shapesById(ctx: AiContext, ids: string[]): Shape[] {
  const out = ids.map((id) => ctx.doc.get(id));
  const missing = ids.filter((_, i) => !out[i]);
  if (missing.length) throw new Error(`없는 도형 id: ${missing.join(', ')}`);
  return out as Shape[];
}

function groupBBox(shapes: Shape[]): BBox {
  return bboxOfPolylines(shapes.flatMap(worldPaths));
}

function layerInfo(l: LayerSettings) {
  return { layer: l.index, name: l.name, color: PALETTE[l.index], mode: l.mode, speed: l.speed, power: l.power, minPower: l.minPower, passes: l.passes, interval: l.interval, angle: l.angle, dither: l.dither, output: l.output };
}

export const handlers: Record<string, Handler> = {
  get_canvas_info(ctx) {
    const d = ctx.device();
    return {
      units: 'mm (작업대 왼쪽 위가 0,0 / Y 아래로 증가)',
      bed: { width: d.bedWidth, height: d.bedHeight },
      machineOrigin: { corner: d.origin, documentPosition: fromMachine(d, 0, 0) },
      controller: d.controller,
      currentLayer: ctx.doc.currentLayer,
      shapeCount: ctx.doc.shapes.length,
      shapesBBox: box(ctx.doc.allBBox()),
      layersInUse: ctx.doc.usedLayers().map(layerInfo),
      palette: PALETTE.map((color, i) => ({ layer: i, color })),
      fonts: ctx.textTool.fontNames().map((name, i) => ({ index: i, name })),
    };
  },

  draw_shapes(ctx, p) {
    const specs = p.shapes as ShapeSpec[];
    const created: Shape[] = [];
    for (const s of specs) {
      const paths = specToPaths(s).filter((l) => l.pts.length > 1);
      if (!paths.length) throw new Error(`${s.type}: 그릴 수 있는 경로가 없습니다`);
      created.push(makeVector(paths, layerOf(ctx, s), s.name ?? NAMES[s.type]));
    }
    ctx.doc.add(created);
    return { created: created.map((s) => ({ id: s.id, name: s.name, layer: s.layer, bbox: box(shapeBBox(s)) })) };
  },

  async add_text(ctx, p) {
    const req = {
      font: Number(p.font ?? 0),
      size: Number(p.size),
      align: (p.align as TextAlign) ?? 'left',
      letterSpacing: Number(p.letterSpacing ?? 0),
      lineHeight: Number(p.lineHeight ?? 1.2),
      bold: Boolean(p.bold),
      italic: Boolean(p.italic),
      weight: Number(p.weight ?? 0),
    };
    const paths = await ctx.textTool.makeTextPaths(String(p.text), req);
    if (!paths.length) throw new Error('텍스트 경로가 비어 있습니다 (글꼴에 없는 글자일 수 있습니다)');
    const b = bboxOfPolylines(paths);
    const x = Number(p.x);
    const y = Number(p.y);
    let m: Mat;
    switch (p.anchor ?? 'top-left') {
      case 'baseline-left':
        m = translate(x, y);
        break;
      case 'center':
        m = translate(x - (b.minX + b.maxX) / 2, y - (b.minY + b.maxY) / 2);
        break;
      default:
        m = translate(x - b.minX, y - b.minY);
    }
    const label = String(p.text).replace(/\s+/g, ' ').trim();
    const s = makeVector(paths, layerOf(ctx, p as { layer?: number }), `Text "${label.length > 20 ? label.slice(0, 20) + '…' : label}"`, m);
    s.text = ctx.textTool.metaFromRequest(String(p.text), req);
    // 원본의 기준점(0,0)은 기준선 왼쪽이므로 정렬용 이동만큼 변환에 포함되어 있다
    ctx.doc.add(s);
    return { id: s.id, bbox: box(shapeBBox(s)) };
  },

  async text_on_path(ctx, p) {
    const [shape] = shapesById(ctx, [String(p.id)]);
    if (shape.type !== 'vector') throw new Error('벡터 도형(원·선·경로)만 기준 곡선으로 쓸 수 있습니다');
    const paths = worldPaths(shape);
    const len = (l: Polyline) => l.pts.reduce((a, q, i) => (i ? a + Math.hypot(q.x - l.pts[i - 1].x, q.y - l.pts[i - 1].y) : 0), 0);
    const path = paths.reduce((a, b) => (len(b) > len(a) ? b : a));
    const req = {
      font: Number(p.font ?? 0),
      size: Number(p.size),
      letterSpacing: Number(p.letterSpacing ?? 0),
      bold: Boolean(p.bold),
      italic: Boolean(p.italic),
      weight: Number(p.weight ?? 0),
      position: Number(p.position ?? (path.closed ? 75 : 50)),
      side: (p.side as 'above' | 'below') ?? 'above',
      reverse: Boolean(p.reverse),
      offset: Number(p.offset ?? 0),
    };
    const out = await ctx.textTool.makePathTextPaths(String(p.text), path, req);
    if (!out.length) throw new Error('경로가 짧아 글자를 배치하지 못했습니다');
    const label = String(p.text).replace(/\s+/g, ' ').trim();
    const s = makeVector(out, layerOf(ctx, p as { layer?: number }), `Text "${label.slice(0, 20)}"`);
    s.text = ctx.textTool.metaFromRequest(String(p.text), req, { line: path, position: req.position, side: req.side, reverse: req.reverse, offset: req.offset });
    ctx.doc.add(s);
    return { id: s.id, bbox: box(shapeBBox(s)) };
  },

  async edit_text(ctx, p) {
    const [shape] = shapesById(ctx, [String(p.id)]);
    if (shape.type !== 'vector' || !shape.text) throw new Error('텍스트 원본이 있는 도형만 수정할 수 있습니다 (add_text / text_on_path 로 만든 텍스트)');
    const old = shape.text;
    const font = p.font !== undefined ? ctx.textTool.fontInfo(Number(p.font)) : null;
    if (p.font !== undefined && !font) throw new Error(`글꼴 ${p.font} 이(가) 없습니다`);
    const pick = <T>(k: string, v: T): T => (p[k] !== undefined ? (p[k] as T) : v);
    const meta = {
      ...old,
      ...(font ?? {}),
      content: pick('text', old.content),
      size: pick('size', old.size),
      letterSpacing: pick('letterSpacing', old.letterSpacing),
      lineHeight: pick('lineHeight', old.lineHeight),
      align: pick('align', old.align),
      bold: pick('bold', old.bold),
      italic: pick('italic', old.italic),
      weight: pick('weight', old.weight),
      ...(old.path
        ? {
            path: {
              ...old.path,
              position: pick('position', old.path.position),
              side: pick('side', old.path.side),
              reverse: pick('reverse', old.path.reverse),
              offset: pick('offset', old.path.offset),
            },
          }
        : {}),
    };
    await ctx.textTool.replaceText(shape, meta);
    return { id: shape.id, text: meta.content, bbox: box(shapeBBox(shape)) };
  },

  import_svg(ctx, p) {
    const { shapes, warnings } = importSVG(String(p.svg), layerOf(ctx, p as { layer?: number }));
    if (!shapes.length) throw new Error(`SVG 에서 도형을 찾지 못했습니다. ${warnings.join(' ')}`);
    if (p.layer !== undefined) for (const s of shapes) s.layer = Number(p.layer);
    for (const s of shapes) if (s.type === 'image') ctx.doc.layer(s.layer).mode = 'image';
    // 지정 영역에 맞추기
    let b = groupBBox(shapes);
    const bw = b.maxX - b.minX || 1;
    const bh = b.maxY - b.minY || 1;
    const k = Math.min(p.width ? Number(p.width) / bw : Infinity, p.height ? Number(p.height) / bh : Infinity);
    if (Number.isFinite(k)) for (const s of shapes) applyToShape(s, about(scale(k), b.minX, b.minY));
    b = groupBBox(shapes);
    const tx = p.x !== undefined ? Number(p.x) - b.minX : 0;
    const ty = p.y !== undefined ? Number(p.y) - b.minY : 0;
    if (tx || ty) for (const s of shapes) applyToShape(s, translate(tx, ty));
    ctx.doc.add(shapes);
    return { created: shapes.map((s) => ({ id: s.id, name: s.name, layer: s.layer })), bbox: box(groupBBox(shapes)), warnings };
  },

  list_shapes(ctx) {
    return ctx.doc.shapes.map((s) => ({
      id: s.id, name: s.name, type: s.type, layer: s.layer, mode: ctx.doc.layer(s.layer).mode, bbox: box(shapeBBox(s)),
      ...(s.type === 'vector' ? { paths: s.paths.length, closed: s.paths.every((l) => l.closed) } : {}),
      ...(s.type === 'vector' && s.text ? { text: s.text.content, font: `${s.text.family} ${s.text.style}`, size: s.text.size, onPath: Boolean(s.text.path) } : {}),
    }));
  },

  transform_shapes(ctx, p) {
    const shapes = shapesById(ctx, p.ids as string[]);
    const doc = ctx.doc;
    doc.select(shapes.map((s) => s.id));
    let b = groupBBox(shapes);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    let m: Mat = [1, 0, 0, 1, 0, 0];
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    if (p.scale) m = mul(about(scale(Number(p.scale)), cx, cy), m);
    if (p.width || p.height) {
      const sx = p.width ? Number(p.width) / w : Number(p.height) / h;
      const sy = p.height ? Number(p.height) / h : sx;
      m = mul(about(scale(sx, sy), cx, cy), m);
    }
    if (p.rotate) m = mul(about(rotate((Number(p.rotate) * Math.PI) / 180), cx, cy), m);
    if (p.mirror) m = mul(about(p.mirror === 'horizontal' ? scale(-1, 1) : scale(1, -1), cx, cy), m);
    doc.transformSelected(m);
    b = groupBBox(shapes);
    let tx = Number(p.dx ?? 0);
    let ty = Number(p.dy ?? 0);
    const mt = p.moveTo as Vec | undefined;
    const ca = p.centerAt as Vec | undefined;
    if (mt) {
      tx += mt.x - b.minX;
      ty += mt.y - b.minY;
    }
    if (ca) {
      tx += ca.x - (b.minX + b.maxX) / 2;
      ty += ca.y - (b.minY + b.maxY) / 2;
    }
    if (tx || ty) doc.transformSelected(translate(tx, ty), false);
    return { bbox: box(groupBBox(shapes)) };
  },

  delete_shapes(ctx, p) {
    const doc = ctx.doc;
    if (p.all) {
      const n = doc.shapes.length;
      doc.selectAll();
      doc.deleteSelected();
      return { deleted: n };
    }
    const shapes = shapesById(ctx, (p.ids as string[]) ?? []);
    if (!shapes.length) throw new Error('ids 또는 all=true 가 필요합니다');
    doc.select(shapes.map((s) => s.id));
    doc.deleteSelected();
    return { deleted: shapes.length };
  },

  set_shape_layer(ctx, p) {
    const shapes = shapesById(ctx, p.ids as string[]);
    ctx.doc.select(shapes.map((s) => s.id));
    ctx.doc.setLayerOfSelected(Number(p.layer));
    return { moved: shapes.length, layer: p.layer };
  },

  set_layer(ctx, p) {
    const patch: Partial<LayerSettings> = {};
    for (const k of ['name', 'speed', 'power', 'minPower', 'passes', 'interval', 'angle', 'output'] as const) {
      if (p[k] !== undefined) (patch as Record<string, unknown>)[k] = p[k];
    }
    if (p.mode) patch.mode = p.mode as LayerMode;
    if (p.dither) patch.dither = p.dither as DitherMode;
    ctx.doc.updateLayer(Number(p.layer), patch);
    return layerInfo(ctx.doc.layer(Number(p.layer)));
  },

  offset_shapes(ctx, p) {
    const shapes = shapesById(ctx, p.ids as string[]).filter((s): s is VectorShape => s.type === 'vector');
    const out: Shape[] = [];
    for (const s of shapes) {
      const paths = offsetPolylines(worldPaths(s), Number(p.distance), { join: (p.join as OffsetJoin) ?? 'round' });
      if (paths.length) out.push(makeVector(paths, s.layer, `${s.name} 오프셋`));
    }
    if (!out.length) throw new Error('오프셋 결과가 없습니다 (닫힌 도형인지, 안쪽 오프셋이 너무 크지 않은지 확인)');
    ctx.doc.add(out);
    return { created: out.map((s) => ({ id: s.id, bbox: box(shapeBBox(s)) })) };
  },

  boolean_shapes(ctx, p) {
    const shapes = shapesById(ctx, p.ids as string[]).filter((s): s is VectorShape => s.type === 'vector');
    if (shapes.length < 2) throw new Error('벡터 도형이 2개 이상 필요합니다');
    const paths = booleanOp(p.op as BoolOp, shapes.map((s) => worldPaths(s)));
    if (!paths.length) throw new Error('결과가 비어 있습니다 (겹치는 닫힌 도형이 없습니다)');
    const result = makeVector(paths, shapes[0].layer, String(p.op));
    ctx.doc.replace(shapes.map((s) => s.id), [result]);
    return { id: result.id, paths: paths.length, bbox: box(shapeBBox(result)) };
  },

  array_shapes(ctx, p) {
    const shapes = shapesById(ctx, p.ids as string[]);
    let copies: Shape[];
    if (p.kind === 'grid') {
      copies = gridArray(shapes, {
        columns: Number(p.columns ?? 1),
        rows: Number(p.rows ?? 1),
        spacingX: Number(p.spacingX ?? 5),
        spacingY: Number(p.spacingY ?? 5),
        spacing: (p.spacing as 'gap' | 'pitch') ?? 'gap',
      });
    } else {
      if (p.centerX === undefined || p.centerY === undefined) throw new Error('circular 배열에는 centerX, centerY 가 필요합니다');
      copies = circularArray(shapes, {
        count: Number(p.count ?? 2),
        center: { x: Number(p.centerX), y: Number(p.centerY) },
        totalAngle: Number(p.totalAngle ?? 360),
        rotateCopies: p.rotateCopies !== false,
      });
    }
    if (!copies.length) throw new Error('만들 복사본이 없습니다 (개수를 2 이상으로)');
    ctx.doc.add(copies);
    return { created: copies.map((s) => s.id), bbox: box(groupBBox([...shapes, ...copies])) };
  },

  async preview_job(ctx) {
    const dev = ctx.device();
    const images = await grayForShapes(ctx.doc.shapes.filter((s): s is ImageShape => s.type === 'image'));
    const start = fromMachine(dev, 0, 0);
    const { job, warnings } = planJob(ctx.doc, { images, start });
    if (!job.blocks.length) return { empty: true, warnings: [...warnings, '출력할 도형이 없습니다'] };
    const st = estimateJob(job, dev.travelSpeed, start);
    const b = jobBBox(job);
    const outside = b.minX < -0.01 || b.minY < -0.01 || b.maxX > dev.bedWidth + 0.01 || b.maxY > dev.bedHeight + 0.01;
    return {
      estimatedTime: formatDuration(st.seconds),
      cutLength_m: round(st.cutLength / 1000),
      travelLength_m: round(st.travelLength / 1000),
      blocks: job.blocks.map((bl) => ({ layer: bl.layer, kind: bl.kind, speed: bl.speed, power: bl.power, moves: bl.moves.length })),
      bbox: box(b),
      warnings: outside ? [...warnings, '작업대 밖으로 나가는 경로가 있습니다'] : warnings,
    };
  },

  undo(ctx) {
    if (!ctx.doc.canUndo) return { undone: false };
    ctx.doc.undo();
    return { undone: true, shapeCount: ctx.doc.shapes.length };
  },

  snapshot(ctx, p) {
    return renderSnapshot(ctx.doc, ctx.device(), Number(p.width ?? 900), (p.region as 'bed' | 'shapes') ?? 'bed');
  },
};
