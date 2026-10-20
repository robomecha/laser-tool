// 작업 화면: 렌더링(작업대, 도형, 선택, 미리보기)과 마우스 도구 처리
import { DeviceSettings, fromMachine } from '../core/device';
import { LaserDocument } from '../core/document';
import {
  about,
  BBox,
  dist,
  ellipsePolyline,
  isEmptyBBox,
  Mat,
  mul,
  Polyline,
  rectPolyline,
  rotate,
  scale,
  translate,
  Vec,
} from '../core/geometry';
import { layerColor } from '../core/layers';
import { makeVector, shapeBBox, hitTest, Shape, worldPaths } from '../core/shapes';
import { Job } from '../cam/job';
import { cachedImageEl } from '../io/image-import';

export type Tool = 'select' | 'line' | 'rect' | 'ellipse' | 'text' | 'pan';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'move'; start: Vec; orig: Map<string, Mat>; moved: boolean }
  | { kind: 'scale'; handle: Handle; box: BBox; orig: Map<string, Mat> }
  | { kind: 'rotate'; center: Vec; a0: number; orig: Map<string, Mat> }
  | { kind: 'band'; start: Vec; cur: Vec; additive: boolean }
  | { kind: 'shape'; tool: 'rect' | 'ellipse'; start: Vec; cur: Vec };

const HANDLE_PX = 7;

export class CanvasView {
  zoom = 2; // px per mm
  panX = 40;
  panY = 40;
  tool: Tool = 'select';

  /** 미리보기 */
  previewJob: Job | null = null;
  previewFraction = 1;
  previewTravel = true;
  /** 레이저 헤드 위치 (기계 좌표) */
  headPos: Vec | null = null;

  onCursor: (p: Vec) => void = () => {};
  onZoom: (z: number) => void = () => {};
  onToolDone: () => void = () => {};
  /** 텍스트 도구로 작업대를 클릭했을 때 (문서 좌표) */
  onTextClick: (p: Vec) => void = () => {};
  /** 입력 중인 텍스트 미리보기 (문서 좌표 폴리라인) 와 기준점 */
  textPreview: { anchor: Vec; paths: Polyline[] } | null = null;
  /** 매 렌더링 후 (화면 위 HTML 오버레이 위치 갱신용) */
  onRendered: () => void = () => {};

  private ctx: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private poly: Vec[] = [];
  private cursor: Vec = { x: 0, y: 0 };
  private spaceDown = false;
  private dpr = 1;
  private raf = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private doc: LaserDocument,
    private device: () => DeviceSettings,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('dblclick', () => this.finishPoly(false));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.tool === 'line') this.finishPoly(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) this.spaceDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    doc.onChange(() => this.requestRender());
    this.resize();
  }

  // ---------- 좌표 ----------

  toWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }
  toScreen(p: Vec): Vec {
    return { x: p.x * this.zoom + this.panX, y: p.y * this.zoom + this.panY };
  }

  private eventPos(e: MouseEvent): { s: Vec; w: Vec } {
    const r = this.canvas.getBoundingClientRect();
    const s = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { s, w: this.toWorld(s.x, s.y) };
  }

  setTool(t: Tool): void {
    this.cancelTool();
    this.tool = t;
    this.canvas.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    this.requestRender();
  }

  cancelTool(): void {
    this.poly = [];
    this.drag = null;
    this.requestRender();
  }

  /** Enter / 더블클릭 / 우클릭으로 폴리라인 완료 */
  finishPoly(close: boolean): void {
    if (this.tool !== 'line') return;
    // 더블클릭 시 마지막 클릭이 중복으로 들어가므로 제거
    const pts = this.poly.filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 1e-6);
    this.poly = [];
    if (pts.length >= 2) {
      this.doc.add(makeVector([{ pts, closed: close && pts.length > 2 }], this.doc.currentLayer, close ? 'Polygon' : 'Line'));
      this.onToolDone();
    }
    this.requestRender();
  }

  zoomToFit(box?: BBox): void {
    const d = this.device();
    const b = box && !isEmptyBBox(box) ? box : { minX: 0, minY: 0, maxX: d.bedWidth, maxY: d.bedHeight };
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    this.zoom = Math.min((w - 60) / bw, (h - 60) / bh);
    this.panX = (w - bw * this.zoom) / 2 - b.minX * this.zoom;
    this.panY = (h - bh * this.zoom) / 2 - b.minY * this.zoom;
    this.onZoom(this.zoom);
    this.requestRender();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr);
    this.render();
  }

  requestRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  // ---------- 입력 ----------

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { s } = this.eventPos(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    const nz = Math.min(200, Math.max(0.05, this.zoom * f));
    this.panX = s.x - ((s.x - this.panX) * nz) / this.zoom;
    this.panY = s.y - ((s.y - this.panY) * nz) / this.zoom;
    this.zoom = nz;
    this.onZoom(nz);
    this.requestRender();
  }

  private selectionOrig(): Map<string, Mat> {
    return new Map(this.doc.selected().map((s) => [s.id, [...s.transform] as Mat]));
  }

  private handleAt(s: Vec): Handle | null {
    if (!this.doc.selection.size || this.previewJob) return null;
    for (const [h, p] of this.handlePositions()) {
      if (Math.abs(p.x - s.x) <= HANDLE_PX && Math.abs(p.y - s.y) <= HANDLE_PX) return h;
    }
    return null;
  }

  private handlePositions(): [Handle, Vec][] {
    const b = this.doc.selectionBBox();
    if (isEmptyBBox(b)) return [];
    const a = this.toScreen({ x: b.minX, y: b.minY });
    const c = this.toScreen({ x: b.maxX, y: b.maxY });
    const mx = (a.x + c.x) / 2;
    const my = (a.y + c.y) / 2;
    return [
      ['nw', { x: a.x, y: a.y }], ['n', { x: mx, y: a.y }], ['ne', { x: c.x, y: a.y }], ['e', { x: c.x, y: my }],
      ['se', { x: c.x, y: c.y }], ['s', { x: mx, y: c.y }], ['sw', { x: a.x, y: c.y }], ['w', { x: a.x, y: my }],
      ['rot', { x: mx, y: a.y - 24 }],
    ];
  }

  private shapeAt(w: Vec): Shape | null {
    const tol = 4 / this.zoom;
    for (let i = this.doc.shapes.length - 1; i >= 0; i--) {
      const s = this.doc.shapes[i];
      if (!this.doc.layer(s.layer).show) continue;
      if (hitTest(s, w, tol)) return s;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const { s, w } = this.eventPos(e);
    if (e.button === 1 || (e.button === 0 && (this.spaceDown || this.tool === 'pan'))) {
      this.drag = { kind: 'pan', sx: s.x, sy: s.y, px: this.panX, py: this.panY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0 || this.previewJob) return;

    switch (this.tool) {
      case 'select': {
        const h = this.handleAt(s);
        if (h) {
          this.doc.checkpoint();
          const box = this.doc.selectionBBox();
          if (h === 'rot') {
            const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
            this.drag = { kind: 'rotate', center: c, a0: Math.atan2(w.y - c.y, w.x - c.x), orig: this.selectionOrig() };
          } else {
            this.drag = { kind: 'scale', handle: h, box, orig: this.selectionOrig() };
          }
          return;
        }
        const hit = this.shapeAt(w);
        if (hit) {
          if (e.shiftKey || e.ctrlKey) this.doc.toggleSelect(hit.id);
          else if (!this.doc.selection.has(hit.id)) this.doc.select([hit.id]);
          if (this.doc.selection.has(hit.id)) {
            this.drag = { kind: 'move', start: w, orig: this.selectionOrig(), moved: false };
          }
        } else {
          this.drag = { kind: 'band', start: w, cur: w, additive: e.shiftKey || e.ctrlKey };
        }
        return;
      }
      case 'rect':
      case 'ellipse':
        this.drag = { kind: 'shape', tool: this.tool, start: w, cur: w };
        return;
      case 'text':
        this.onTextClick(w);
        return;
      case 'line': {
        if (this.poly.length > 2 && dist(this.toScreen(this.poly[0]), s) < 8) {
          this.finishPoly(true);
          return;
        }
        this.poly.push(this.snap(w, e.shiftKey));
        this.requestRender();
        return;
      }
    }
  }

  /** Shift: 직전 점 기준 45° 단위 스냅 */
  private snap(w: Vec, shift: boolean): Vec {
    if (!shift || !this.poly.length) return w;
    const p = this.poly[this.poly.length - 1];
    const a = Math.round(Math.atan2(w.y - p.y, w.x - p.x) / (Math.PI / 4)) * (Math.PI / 4);
    const r = dist(p, w);
    return { x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) };
  }

  private applyOrig(orig: Map<string, Mat>, m: Mat): void {
    for (const s of this.doc.selected()) {
      const o = orig.get(s.id);
      if (o) s.transform = mul(m, o);
    }
    this.doc.emit('shapes');
  }

  private onMove(e: PointerEvent): void {
    const { s, w } = this.eventPos(e);
    this.cursor = w;
    this.onCursor(w);
    const d = this.drag;
    if (!d) {
      if (this.tool === 'select') {
        const h = this.handleAt(s);
        const cursors: Record<Handle, string> = {
          nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
          n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'crosshair',
        };
        this.canvas.style.cursor = h ? cursors[h] : this.shapeAt(w) ? 'move' : 'default';
      }
      if (this.tool === 'line' && this.poly.length) this.requestRender();
      return;
    }
    switch (d.kind) {
      case 'pan':
        this.panX = d.px + (s.x - d.sx);
        this.panY = d.py + (s.y - d.sy);
        this.requestRender();
        break;
      case 'move': {
        let dx = w.x - d.start.x;
        let dy = w.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (!d.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
        if (!d.moved) {
          this.doc.checkpoint();
          d.moved = true;
        }
        this.applyOrig(d.orig, translate(dx, dy));
        break;
      }
      case 'scale': {
        const b = d.box;
        const h = d.handle;
        // 고정점 = 반대편 핸들
        const fx = h.includes('w') ? b.maxX : h.includes('e') ? b.minX : (b.minX + b.maxX) / 2;
        const fy = h.includes('n') ? b.maxY : h.includes('s') ? b.minY : (b.minY + b.maxY) / 2;
        const bw = b.maxX - b.minX || 1e-6;
        const bh = b.maxY - b.minY || 1e-6;
        let sx = h.includes('e') ? (w.x - b.minX) / bw : h.includes('w') ? (b.maxX - w.x) / bw : 1;
        let sy = h.includes('s') ? (w.y - b.minY) / bh : h.includes('n') ? (b.maxY - w.y) / bh : 1;
        const corner = h.length === 2;
        if (corner && !e.shiftKey) {
          // 모서리 핸들은 기본 비율 유지 (Shift 로 자유 변형)
          const k = Math.abs(sx) > Math.abs(sy) ? sx : sy;
          sx = sy = k;
        }
        if (Math.abs(sx) < 1e-3) sx = 1e-3;
        if (Math.abs(sy) < 1e-3) sy = 1e-3;
        this.applyOrig(d.orig, about(scale(sx, sy), fx, fy));
        break;
      }
      case 'rotate': {
        let a = Math.atan2(w.y - d.center.y, w.x - d.center.x) - d.a0;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        this.applyOrig(d.orig, about(rotate(a), d.center.x, d.center.y));
        break;
      }
      case 'band':
      case 'shape':
        d.cur = w;
        if (d.kind === 'shape' && e.shiftKey) {
          const side = Math.max(Math.abs(w.x - d.start.x), Math.abs(w.y - d.start.y));
          d.cur = { x: d.start.x + Math.sign(w.x - d.start.x || 1) * side, y: d.start.y + Math.sign(w.y - d.start.y || 1) * side };
        }
        this.requestRender();
        break;
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === 'pan') {
      this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : 'default';
      return;
    }
    if (d.kind === 'move' && !d.moved) {
      // 클릭만 했으면 선택만 단일화
      const hit = this.shapeAt(d.start);
      if (hit && !(e.shiftKey || e.ctrlKey)) this.doc.select([hit.id]);
    }
    if (d.kind === 'band') {
      const b = {
        minX: Math.min(d.start.x, d.cur.x), maxX: Math.max(d.start.x, d.cur.x),
        minY: Math.min(d.start.y, d.cur.y), maxY: Math.max(d.start.y, d.cur.y),
      };
      // 왼→오 드래그: 완전히 포함된 도형, 오→왼: 걸친 도형 (CAD 방식)
      const crossing = d.cur.x < d.start.x;
      const ids = this.doc.shapes
        .filter((s) => this.doc.layer(s.layer).show)
        .filter((s) => {
          const sb = shapeBBox(s);
          return crossing
            ? sb.maxX >= b.minX && sb.minX <= b.maxX && sb.maxY >= b.minY && sb.minY <= b.maxY
            : sb.minX >= b.minX && sb.maxX <= b.maxX && sb.minY >= b.minY && sb.maxY <= b.maxY;
        })
        .map((s) => s.id);
      if (!d.additive && Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * this.zoom < 3) this.doc.clearSelection();
      else this.doc.select(ids, d.additive);
    }
    if (d.kind === 'shape') {
      const x = Math.min(d.start.x, d.cur.x);
      const y = Math.min(d.start.y, d.cur.y);
      const w = Math.abs(d.cur.x - d.start.x);
      const h = Math.abs(d.cur.y - d.start.y);
      if (w > 0.1 && h > 0.1) {
        const path = d.tool === 'rect' ? rectPolyline(x, y, w, h) : ellipsePolyline(x + w / 2, y + h / 2, w / 2, h / 2);
        this.doc.add(makeVector([path], this.doc.currentLayer, d.tool === 'rect' ? 'Rectangle' : 'Ellipse'));
        this.onToolDone();
      }
    }
    this.requestRender();
  }

  // ---------- 렌더링 ----------

  render(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, W, H);
    const z = this.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, this.panX * this.dpr, this.panY * this.dpr);
    const px = 1 / this.zoom; // 화면 1px 에 해당하는 mm

    this.drawBed(px);
    if (this.previewJob) this.drawPreview(px);
    else this.drawShapes(px);
    this.drawHead(px);
    this.drawToolOverlay(px);

    // 화면 좌표 오버레이
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.previewJob) this.drawSelection();
    this.onRendered();
  }

  private drawBed(px: number): void {
    const ctx = this.ctx;
    const d = this.device();
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(0, 0, d.bedWidth, d.bedHeight);
    // 그리드: 줌에 따라 간격 조정
    const minor = this.zoom > 4 ? 5 : 10;
    ctx.lineWidth = px;
    for (const [step, color] of [[minor, '#e2e2de'], [50, '#c8c8c2']] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = 0; x <= d.bedWidth; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, d.bedHeight);
      }
      for (let y = 0; y <= d.bedHeight; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(d.bedWidth, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#888';
    ctx.strokeRect(0, 0, d.bedWidth, d.bedHeight);
    // 원점 표시
    const o = fromMachine(d, 0, 0);
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.arc(o.x, o.y, 5 * px, 0, Math.PI * 2);
    ctx.fill();
    // 눈금 숫자
    ctx.save();
    ctx.fillStyle = '#9aa0a8';
    ctx.font = `${11 * px}px sans-serif`;
    for (let x = 0; x <= d.bedWidth; x += 50) {
      const m = Math.abs(x - (d.origin.includes('right') ? d.bedWidth : 0));
      ctx.fillText(String(m), x + 2 * px, -4 * px);
    }
    ctx.textAlign = 'right';
    for (let y = 50; y <= d.bedHeight; y += 50) {
      const m = Math.abs(y - (d.origin.includes('bottom') ? d.bedHeight : 0));
      ctx.fillText(String(m), -4 * px, y + 4 * px);
    }
    ctx.restore();
  }

  private tracePaths(s: Shape): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const l of worldPaths(s)) {
      if (!l.pts.length) continue;
      ctx.moveTo(l.pts[0].x, l.pts[0].y);
      for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i].x, l.pts[i].y);
      if (l.closed) ctx.closePath();
    }
  }

  private drawShapes(px: number): void {
    const ctx = this.ctx;
    for (const s of this.doc.shapes) {
      const layer = this.doc.layer(s.layer);
      if (!layer.show) continue;
      const color = layerColor(s.layer);
      const sel = this.doc.selection.has(s.id);
      if (s.type === 'image') {
        const img = cachedImageEl(s.src, () => this.requestRender());
        ctx.save();
        ctx.transform(...s.transform);
        if (img) {
          ctx.globalAlpha = layer.output ? 1 : 0.4;
          ctx.drawImage(img, 0, 0, s.w, s.h);
        } else {
          ctx.fillStyle = '#ccc';
          ctx.fillRect(0, 0, s.w, s.h);
        }
        ctx.restore();
        this.tracePaths(s);
        ctx.lineWidth = px;
        ctx.strokeStyle = color;
        ctx.setLineDash(sel ? [4 * px, 3 * px] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      this.tracePaths(s);
      if (layer.mode === 'fill') {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = (sel ? 1.5 : 1) * px;
      ctx.strokeStyle = color;
      ctx.globalAlpha = layer.output ? 1 : 0.4;
      ctx.setLineDash(sel ? [5 * px, 3 * px] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  private drawSelection(): void {
    if (!this.doc.selection.size) return;
    const ctx = this.ctx;
    const b = this.doc.selectionBBox();
    if (isEmptyBBox(b)) return;
    const a = this.toScreen({ x: b.minX, y: b.minY });
    const c = this.toScreen({ x: b.maxX, y: b.maxY });
    ctx.strokeStyle = '#3d8bfd';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
    ctx.setLineDash([]);
    const hp = this.handlePositions();
    ctx.beginPath();
    ctx.moveTo((a.x + c.x) / 2, a.y);
    ctx.lineTo((a.x + c.x) / 2, a.y - 24);
    ctx.stroke();
    for (const [h, p] of hp) {
      ctx.fillStyle = h === 'rot' ? '#30a46c' : '#fff';
      ctx.strokeStyle = '#3d8bfd';
      if (h === 'rot') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
      }
    }
    // 크기 라벨
    ctx.fillStyle = '#3d8bfd';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${(b.maxX - b.minX).toFixed(2)} × ${(b.maxY - b.minY).toFixed(2)} mm`, a.x, c.y + 16);
  }

  private drawToolOverlay(px: number): void {
    const ctx = this.ctx;
    const d = this.drag;
    ctx.lineWidth = px;
    if (d?.kind === 'band') {
      const crossing = d.cur.x < d.start.x;
      ctx.strokeStyle = crossing ? '#30a46c' : '#3d8bfd';
      ctx.fillStyle = crossing ? 'rgba(48,164,108,0.08)' : 'rgba(61,139,253,0.08)';
      ctx.setLineDash(crossing ? [4 * px, 3 * px] : []);
      const x = Math.min(d.start.x, d.cur.x);
      const y = Math.min(d.start.y, d.cur.y);
      const w = Math.abs(d.cur.x - d.start.x);
      const h = Math.abs(d.cur.y - d.start.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
    if (d?.kind === 'shape') {
      const x = Math.min(d.start.x, d.cur.x);
      const y = Math.min(d.start.y, d.cur.y);
      const w = Math.abs(d.cur.x - d.start.x);
      const h = Math.abs(d.cur.y - d.start.y);
      ctx.strokeStyle = layerColor(this.doc.currentLayer);
      ctx.beginPath();
      if (d.tool === 'rect') ctx.rect(x, y, w, h);
      else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.textPreview) {
      const { anchor, paths } = this.textPreview;
      ctx.strokeStyle = layerColor(this.doc.currentLayer);
      ctx.beginPath();
      for (const l of paths) {
        if (!l.pts.length) continue;
        ctx.moveTo(l.pts[0].x, l.pts[0].y);
        for (const p of l.pts.slice(1)) ctx.lineTo(p.x, p.y);
        if (l.closed) ctx.closePath();
      }
      ctx.stroke();
      // 기준점 (첫 줄 기준선)
      ctx.strokeStyle = '#3d8bfd';
      ctx.beginPath();
      ctx.moveTo(anchor.x - 6 * px, anchor.y);
      ctx.lineTo(anchor.x + 6 * px, anchor.y);
      ctx.moveTo(anchor.x, anchor.y - 6 * px);
      ctx.lineTo(anchor.x, anchor.y + 6 * px);
      ctx.stroke();
    }
    if (this.tool === 'line' && this.poly.length) {
      ctx.strokeStyle = layerColor(this.doc.currentLayer);
      ctx.beginPath();
      ctx.moveTo(this.poly[0].x, this.poly[0].y);
      for (const p of this.poly.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.lineTo(this.cursor.x, this.cursor.y);
      ctx.stroke();
      ctx.fillStyle = '#3d8bfd';
      for (const p of this.poly) ctx.fillRect(p.x - 2 * px, p.y - 2 * px, 4 * px, 4 * px);
    }
  }

  private drawHead(px: number): void {
    if (!this.headPos) return;
    const ctx = this.ctx;
    const p = fromMachine(this.device(), this.headPos.x, this.headPos.y);
    ctx.strokeStyle = '#e5484d';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(p.x - 8 * px, p.y);
    ctx.lineTo(p.x + 8 * px, p.y);
    ctx.moveTo(p.x, p.y - 8 * px);
    ctx.lineTo(p.x, p.y + 8 * px);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * px, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawPreview(px: number): void {
    const ctx = this.ctx;
    const job = this.previewJob!;
    // 원본 도형은 흐리게
    ctx.globalAlpha = 0.15;
    this.drawShapes(px);
    ctx.globalAlpha = 1;
    const total = job.blocks.reduce((n, b) => n + b.moves.length, 0);
    let budget = Math.round(total * this.previewFraction);
    let pos: Vec = fromMachine(this.device(), 0, 0);
    ctx.lineCap = 'round';
    for (const bl of job.blocks) {
      if (budget <= 0) break;
      const color = layerColor(bl.layer);
      for (const m of bl.moves) {
        if (budget-- <= 0) break;
        if (m.p > 0) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = bl.kind === 'raster' ? Math.max(0.15, m.p / Math.max(bl.power, 1)) : 1;
          ctx.lineWidth = bl.kind === 'vector' ? 1.2 * px : Math.max(px, 0.08);
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(m.x, m.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (this.previewTravel && m.p < 0) {
          ctx.strokeStyle = 'rgba(229,72,77,0.6)';
          ctx.lineWidth = px;
          ctx.setLineDash([3 * px, 3 * px]);
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(m.x, m.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        pos = m;
      }
    }
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4 * px, 0, Math.PI * 2);
    ctx.fill();
  }
}
