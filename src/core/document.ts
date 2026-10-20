import { BBox, emptyBBox, Mat, unionBBox } from './geometry';
import { defaultLayer, LayerSettings } from './layers';
import { applyToShape, cloneShape, Shape, shapeBBox } from './shapes';

interface Snapshot {
  shapes: Shape[];
  layers: [number, LayerSettings][];
}

type Listener = (what: ChangeKind) => void;
export type ChangeKind = 'shapes' | 'selection' | 'layers' | 'all';

const MAX_HISTORY = 100;

/** 편집 중인 작업 문서: 도형, 레이어 설정, 선택 상태, 실행 취소 기록 */
export class LaserDocument {
  shapes: Shape[] = [];
  layers = new Map<number, LayerSettings>();
  selection = new Set<string>();
  /** 새로 그리는 도형이 들어갈 레이어 */
  currentLayer = 0;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners: Listener[] = [];

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  emit(what: ChangeKind): void {
    for (const fn of this.listeners) fn(what);
  }

  // ---------- 기록 ----------

  private snapshot(): Snapshot {
    return {
      shapes: this.shapes.map((s) => cloneShape(s)),
      layers: [...this.layers.entries()].map(([k, v]) => [k, { ...v }]),
    };
  }

  private restore(s: Snapshot): void {
    this.shapes = s.shapes.map((x) => cloneShape(x));
    this.layers = new Map(s.layers.map(([k, v]) => [k, { ...v }]));
    const ids = new Set(this.shapes.map((x) => x.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
  }

  /** 변경 직전에 호출한다. */
  checkpoint(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.emit('all');
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.emit('all');
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ---------- 레이어 ----------

  layer(index: number): LayerSettings {
    let l = this.layers.get(index);
    if (!l) {
      l = defaultLayer(index);
      this.layers.set(index, l);
    }
    return l;
  }

  /** 도형이 하나라도 있는 레이어 (인덱스 순) */
  usedLayers(): LayerSettings[] {
    const used = [...new Set(this.shapes.map((s) => s.layer))].sort((a, b) => a - b);
    return used.map((i) => this.layer(i));
  }

  updateLayer(index: number, patch: Partial<LayerSettings>): void {
    this.checkpoint();
    Object.assign(this.layer(index), patch);
    this.emit('layers');
  }

  // ---------- 도형 ----------

  add(shapes: Shape | Shape[], select = true): void {
    const arr = Array.isArray(shapes) ? shapes : [shapes];
    if (!arr.length) return;
    this.checkpoint();
    for (const s of arr) {
      this.layer(s.layer);
      this.shapes.push(s);
    }
    if (select) {
      this.selection = new Set(arr.map((s) => s.id));
    }
    this.emit('all');
  }

  get(id: string): Shape | undefined {
    return this.shapes.find((s) => s.id === id);
  }

  selected(): Shape[] {
    return this.shapes.filter((s) => this.selection.has(s.id));
  }

  deleteSelected(): void {
    if (!this.selection.size) return;
    this.checkpoint();
    this.shapes = this.shapes.filter((s) => !this.selection.has(s.id));
    this.selection.clear();
    this.emit('all');
  }

  select(ids: Iterable<string>, additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.emit('selection');
  }

  toggleSelect(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.emit('selection');
  }

  clearSelection(): void {
    if (!this.selection.size) return;
    this.selection.clear();
    this.emit('selection');
  }

  selectAll(): void {
    this.select(this.shapes.map((s) => s.id));
  }

  /** 선택 도형에 변환 적용. 드래그 중에는 checkpoint=false 로 반복 호출한다. */
  transformSelected(m: Mat, checkpoint = true): void {
    if (checkpoint) this.checkpoint();
    for (const s of this.selected()) applyToShape(s, m);
    this.emit('shapes');
  }

  setLayerOfSelected(index: number): void {
    if (!this.selection.size) return;
    this.checkpoint();
    this.layer(index);
    for (const s of this.selected()) s.layer = index;
    this.emit('all');
  }

  duplicateSelected(offset = 5): void {
    const copies = this.selected().map((s) => {
      const c = cloneShape(s, false);
      c.transform[4] += offset;
      c.transform[5] += offset;
      return c;
    });
    this.add(copies);
  }

  selectionBBox(): BBox {
    return this.selected().reduce((b, s) => unionBBox(b, shapeBBox(s)), emptyBBox());
  }

  allBBox(): BBox {
    return this.shapes.reduce((b, s) => unionBBox(b, shapeBBox(s)), emptyBBox());
  }

  /** 맨 앞/뒤 순서 변경 (출력 순서에도 영향) */
  reorderSelected(toFront: boolean): void {
    this.checkpoint();
    const sel = this.shapes.filter((s) => this.selection.has(s.id));
    const rest = this.shapes.filter((s) => !this.selection.has(s.id));
    this.shapes = toFront ? [...rest, ...sel] : [...sel, ...rest];
    this.emit('shapes');
  }

  clear(): void {
    this.checkpoint();
    this.shapes = [];
    this.layers.clear();
    this.selection.clear();
    this.emit('all');
  }

  /** 프로젝트 불러오기: 기록을 초기화한다. */
  load(shapes: Shape[], layers: LayerSettings[]): void {
    this.shapes = shapes;
    this.layers = new Map(layers.map((l) => [l.index, { ...defaultLayer(l.index), ...l }]));
    this.selection.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.emit('all');
  }
}
