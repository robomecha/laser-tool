// 텍스트 도구: 글꼴 관리(내장 · 파일 업로드 · PC 설치 글꼴), 스타일(굵게·기울임·외곽선 굵기),
// 작업대 위 입력 상자와 실시간 미리보기, 곡선 따라 쓰기
import nanumRegularUrl from '@expo-google-fonts/nanum-gothic/400Regular/NanumGothic_400Regular.ttf?url';
import nanumBoldUrl from '@expo-google-fonts/nanum-gothic/700Bold/NanumGothic_700Bold.ttf?url';
import { LaserDocument } from '../core/document';
import { apply, Mat, Polyline, translate, transformPolyline, Vec } from '../core/geometry';
import { hitTest, makeVector, TextMeta, VectorShape, worldPaths } from '../core/shapes';
import { TextAlign, textToPolylines } from '../core/text';
import { styleTextPaths, SYNTH_BOLD_RATIO, SYNTH_ITALIC_DEG, textOnPath, TextOnPathOptions } from '../core/text-style';
import { Font, fontFamilyStyle, parseFont } from '../io/font';
import { CanvasView } from './canvas-view';

interface FontEntry {
  family: string;
  style: string;
  source: 'builtin' | 'file' | 'pc';
  /** 내장 글꼴은 처음 쓸 때 내려받는다 */
  url?: string;
  /** PC 글꼴 (Local Font Access API) */
  local?: { postscriptName: string; blob(): Promise<Blob> };
  font?: Font;
}

/** 글꼴 하나 + 굵게/기울임 요청 → 실제 쓸 글꼴과 합성 여부 */
export interface TextRequest {
  font?: number;
  size: number;
  align?: TextAlign;
  letterSpacing?: number;
  lineHeight?: number;
  bold?: boolean;
  italic?: boolean;
  /** 외곽선 굵기 mm (+ 두껍게 / − 가늘게) */
  weight?: number;
}

interface LocalFontData {
  family: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isBold = (s: string) => /bold|black|heavy|extra ?bold|semi ?bold|demi/i.test(s);
const isItalic = (s: string) => /italic|oblique/i.test(s);

export class TextTool {
  private fonts: FontEntry[] = [
    { family: '나눔고딕', style: 'Regular', source: 'builtin', url: nanumRegularUrl },
    { family: '나눔고딕', style: 'Bold', source: 'builtin', url: nanumBoldUrl },
  ];
  private anchor: Vec | null = null;
  /** 수정 중인 기존 텍스트 도형 */
  private editTarget: VectorShape | null = null;
  private input = $<HTMLTextAreaElement>('text-input');
  private familySel = $<HTMLSelectElement>('text-family');
  private styleSel = $<HTMLSelectElement>('text-style');
  private loadToken = 0;
  private pcLoaded = false;

  /** 상태 표시줄 메시지 */
  onStatus: (msg: string) => void = () => {};
  /** 텍스트 도형을 추가한 뒤 */
  onDone: () => void = () => {};

  constructor(
    private doc: LaserDocument,
    private view: CanvasView,
  ) {
    this.renderFamilies('나눔고딕');
    view.onTextClick = (p) => void this.begin(p);
    view.onRendered = () => this.placeInput();

    this.input.addEventListener('input', () => this.updatePreview());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
    });
    this.familySel.addEventListener('change', () => this.renderStyles());
    for (const id of ['text-size', 'text-spacing', 'text-line', 'text-align', 'text-family', 'text-style', 'text-bold', 'text-italic', 'text-weight']) {
      $(id).addEventListener('change', () => {
        this.updatePreview();
        if (this.anchor) this.input.focus();
      });
    }
    $('text-font-upload').onclick = () => $<HTMLInputElement>('file-font').click();
    $<HTMLInputElement>('file-font').onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      (e.target as HTMLInputElement).value = '';
      if (f) void this.addFontFile(f);
    };
    $('text-pc-fonts').onclick = () => void this.loadPcFonts();
    this.setupPathDialog();
  }

  /** 도구 선택 시 옵션 바 표시 */
  setActive(on: boolean): void {
    $('text-options').hidden = !on;
    if (!on) this.cancel();
    else void this.resolve(this.request()).catch(() => {}); // 미리 내려받기
  }

  get editing(): boolean {
    return this.anchor !== null;
  }

  // ---------------- 글꼴 목록 ----------------

  private families(): string[] {
    return [...new Set(this.fonts.map((f) => f.family))];
  }

  private renderFamilies(select?: string): void {
    const cur = select ?? this.familySel.value;
    const groups: Record<FontEntry['source'], string[]> = { builtin: [], file: [], pc: [] };
    for (const fam of this.families()) groups[this.fonts.find((f) => f.family === fam)!.source].push(fam);
    const label = { builtin: '내장 글꼴', file: '불러온 글꼴 파일', pc: 'PC 설치 글꼴' };
    this.familySel.replaceChildren(
      ...(Object.keys(groups) as FontEntry['source'][])
        .filter((k) => groups[k].length)
        .map((k) => {
          const g = document.createElement('optgroup');
          g.label = label[k];
          for (const fam of k === 'pc' ? groups[k].sort((a, b) => a.localeCompare(b)) : groups[k]) {
            const o = document.createElement('option');
            o.value = o.textContent = fam;
            g.append(o);
          }
          return g;
        }),
    );
    if (cur && this.families().includes(cur)) this.familySel.value = cur;
    this.renderStyles();
  }

  private renderStyles(): void {
    const cur = this.styleSel.value;
    const styles = this.fonts.filter((f) => f.family === this.familySel.value).map((f) => f.style);
    this.styleSel.replaceChildren(
      ...styles.map((s) => {
        const o = document.createElement('option');
        o.value = o.textContent = s;
        return o;
      }),
    );
    const regular = styles.find((s) => /^(regular|normal|book|medium|r)$/i.test(s)) ?? styles[0];
    this.styleSel.value = styles.includes(cur) ? cur : regular;
  }

  /** AI 도구용: 평면 글꼴 목록 ("가족 스타일") */
  fontNames(): string[] {
    return this.fonts.map((f) => `${f.family} ${f.style}`);
  }

  async addFontFile(f: File): Promise<void> {
    try {
      const font = parseFont(await f.arrayBuffer());
      const { family, style } = fontFamilyStyle(font);
      this.fonts = this.fonts.filter((x) => !(x.family === family && x.style === style));
      this.fonts.push({ family, style, source: 'file', font });
      this.renderFamilies(family);
      this.styleSel.value = style;
      this.updatePreview();
      this.onStatus(`글꼴을 불러왔습니다: ${family} ${style}`);
    } catch (e) {
      this.onStatus(`글꼴을 읽을 수 없습니다: ${(e as Error).message}`);
    }
  }

  /** PC 에 설치된 글꼴 목록 (Chrome/Edge 의 Local Font Access API, 처음에 권한 요청) */
  async loadPcFonts(): Promise<void> {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (!q) {
      this.onStatus('이 브라우저는 PC 글꼴 목록을 지원하지 않습니다. Chrome 또는 Edge 에서 열거나 [글꼴 파일…] 로 불러오세요.');
      return;
    }
    try {
      const list = await q.call(window);
      const seen = new Set(this.fonts.map((f) => `${f.family}|${f.style}`));
      let n = 0;
      for (const d of list) {
        const key = `${d.family}|${d.style}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.fonts.push({ family: d.family, style: d.style, source: 'pc', local: { postscriptName: d.postscriptName, blob: () => d.blob() } });
        n++;
      }
      this.pcLoaded = true;
      this.renderFamilies();
      this.onStatus(`PC 글꼴 ${n}개를 목록에 추가했습니다 (글꼴 상자에서 'PC 설치 글꼴' 아래)`);
    } catch (e) {
      this.onStatus(`PC 글꼴을 불러오지 못했습니다: ${(e as Error).message} (권한을 허용해야 합니다)`);
    }
  }

  get hasPcFonts(): boolean {
    return this.pcLoaded;
  }

  private async load(entry: FontEntry): Promise<Font> {
    if (entry.font) return entry.font;
    let buf: ArrayBuffer;
    if (entry.url) {
      const res = await fetch(entry.url);
      if (!res.ok) throw new Error(`글꼴 내려받기 실패 (${res.status})`);
      buf = await res.arrayBuffer();
    } else if (entry.local) {
      buf = await (await entry.local.blob()).arrayBuffer();
    } else throw new Error('글꼴 데이터가 없습니다');
    entry.font = parseFont(buf, entry.local?.postscriptName);
    return entry.font;
  }

  /** 글꼴 목록의 index 번째 글꼴 */
  async fontAt(index: number): Promise<Font> {
    const entry = this.fonts[index];
    if (!entry) throw new Error(`글꼴 ${index} 이(가) 없습니다 (0~${this.fonts.length - 1})`);
    return this.load(entry);
  }

  // ---------------- 스타일 해석 ----------------

  /** 화면 설정값 */
  private request(): TextRequest {
    return {
      size: Math.max(0.1, Number($<HTMLInputElement>('text-size').value) || 10),
      letterSpacing: Number($<HTMLInputElement>('text-spacing').value) || 0,
      lineHeight: Number($<HTMLInputElement>('text-line').value) || 1.2,
      align: $<HTMLSelectElement>('text-align').value as TextAlign,
      bold: $<HTMLInputElement>('text-bold').checked,
      italic: $<HTMLInputElement>('text-italic').checked,
      weight: Number($<HTMLInputElement>('text-weight').value) || 0,
    };
  }

  private selectedIndex(): number {
    const i = this.fonts.findIndex((f) => f.family === this.familySel.value && f.style === this.styleSel.value);
    return i < 0 ? 0 : i;
  }

  /**
   * 굵게/기울임 요청을 같은 가족의 실제 스타일로 바꾸고, 없으면 합성(외곽선 두껍게 / 기울이기)한다.
   */
  private async resolve(r: TextRequest): Promise<{ font: Font; slant: number; weight: number }> {
    const base = this.fonts[r.font ?? this.selectedIndex()];
    if (!base) throw new Error('글꼴이 없습니다');
    const wantBold = Boolean(r.bold) || isBold(base.style);
    const wantItalic = Boolean(r.italic) || isItalic(base.style);
    const same = this.fonts.filter((f) => f.family === base.family);
    const exact = same.find((f) => isBold(f.style) === wantBold && isItalic(f.style) === wantItalic);
    const boldOnly = same.find((f) => isBold(f.style) === wantBold && !isItalic(f.style));
    const pick = exact ?? (wantBold ? boldOnly : undefined) ?? base;
    const font = await this.load(pick);
    const synthBold = wantBold && !isBold(pick.style);
    const synthItalic = wantItalic && !isItalic(pick.style);
    return {
      font,
      slant: synthItalic ? SYNTH_ITALIC_DEG : 0,
      weight: (r.weight ?? 0) + (synthBold ? r.size * SYNTH_BOLD_RATIO : 0),
    };
  }

  /** 기준선 왼쪽(정렬 기준점)이 (0,0) 인 텍스트 윤곽선 */
  async makeTextPaths(text: string, r: TextRequest): Promise<Polyline[]> {
    const { font, slant, weight } = await this.resolve(r);
    const raw = textToPolylines(font, text, { size: r.size, align: r.align, letterSpacing: r.letterSpacing, lineHeight: r.lineHeight });
    return styleTextPaths(raw, { slant, weight });
  }

  /** 경로를 따라 배치한 텍스트 윤곽선 (문서 좌표) */
  async makePathTextPaths(text: string, path: Polyline, r: TextRequest & Omit<TextOnPathOptions, 'size'>): Promise<Polyline[]> {
    const { font, slant, weight } = await this.resolve(r);
    // 기울임은 글자마다 자기 기준선 기준으로 (회전 전에) 적용한다
    const raw = textOnPath(font, text, path, { ...r, size: r.size, slant });
    return styleTextPaths(raw, { weight });
  }

  // ---------------- 텍스트 원본 (다시 편집용) ----------------

  /** 화면 설정 → 도형에 저장할 원본 정보 */
  private metaFromUI(content: string): TextMeta {
    const r = this.request();
    return {
      content,
      family: this.familySel.value,
      style: this.styleSel.value,
      size: r.size,
      letterSpacing: r.letterSpacing ?? 0,
      lineHeight: r.lineHeight ?? 1.2,
      align: r.align ?? 'left',
      bold: Boolean(r.bold),
      italic: Boolean(r.italic),
      weight: r.weight ?? 0,
    };
  }

  /** 도형의 원본 정보를 텍스트 도구 화면에 되살린다 */
  private applyMetaToUI(m: TextMeta): void {
    if (this.families().includes(m.family)) {
      this.familySel.value = m.family;
      this.renderStyles();
      if (this.fonts.some((f) => f.family === m.family && f.style === m.style)) this.styleSel.value = m.style;
    } else {
      this.onStatus(`글꼴 '${m.family}' 을(를) 찾을 수 없어 현재 글꼴로 바꿉니다 (PC 글꼴이면 [🖥 PC 글꼴] 을 먼저 누르세요)`);
    }
    $<HTMLInputElement>('text-size').value = String(m.size);
    $<HTMLInputElement>('text-spacing').value = String(m.letterSpacing);
    $<HTMLInputElement>('text-line').value = String(m.lineHeight);
    $<HTMLSelectElement>('text-align').value = m.align;
    $<HTMLInputElement>('text-bold').checked = m.bold;
    $<HTMLInputElement>('text-italic').checked = m.italic;
    $<HTMLInputElement>('text-weight').value = String(m.weight);
  }

  /** 글꼴 요청 → 원본 정보 (AI 도구가 만든 텍스트도 나중에 수정할 수 있게) */
  metaFromRequest(content: string, r: TextRequest, path?: TextMeta['path']): TextMeta {
    const f = this.fonts[r.font ?? this.selectedIndex()] ?? this.fonts[0];
    return {
      content,
      family: f.family,
      style: f.style,
      size: r.size,
      letterSpacing: r.letterSpacing ?? 0,
      lineHeight: r.lineHeight ?? 1.2,
      align: r.align ?? 'left',
      bold: Boolean(r.bold),
      italic: Boolean(r.italic),
      weight: r.weight ?? 0,
      ...(path ? { path } : {}),
    };
  }

  /** 글꼴 목록 index (AI 도구) → 가족·스타일 */
  fontInfo(index: number): { family: string; style: string } | null {
    const f = this.fonts[index];
    return f ? { family: f.family, style: f.style } : null;
  }

  /** 원본 정보 → 글꼴 요청 (글꼴이 없으면 현재 선택 글꼴) */
  private requestFromMeta(m: TextMeta): TextRequest {
    const i = this.fonts.findIndex((f) => f.family === m.family && f.style === m.style);
    const j = i >= 0 ? i : this.fonts.findIndex((f) => f.family === m.family);
    return {
      font: j >= 0 ? j : this.selectedIndex(),
      size: m.size,
      letterSpacing: m.letterSpacing,
      lineHeight: m.lineHeight,
      align: m.align,
      bold: m.bold,
      italic: m.italic,
      weight: m.weight,
    };
  }

  /** 원본 정보로 윤곽선을 다시 만든다 (일반 텍스트는 로컬 좌표, 곡선 텍스트는 만들 때의 문서 좌표) */
  async buildFromMeta(m: TextMeta): Promise<Polyline[]> {
    const r = this.requestFromMeta(m);
    if (m.path) return this.makePathTextPaths(m.content, m.path.line, { ...r, ...m.path });
    return this.makeTextPaths(m.content, r);
  }

  /** 텍스트 도형을 새 원본으로 바꾼다 (위치·회전·크기 변환은 유지). AI 도구에서도 쓴다 */
  async replaceText(shape: VectorShape, meta: TextMeta): Promise<void> {
    const paths = await this.buildFromMeta(meta);
    if (!paths.length) throw new Error('텍스트 경로가 비어 있습니다 (글꼴에 없는 글자일 수 있습니다)');
    this.doc.checkpoint();
    shape.paths = paths;
    shape.text = meta;
    shape.name = this.label(meta.content);
    this.doc.emit('all');
  }

  /** 텍스트 도형 편집 시작 (선택 도구 더블클릭, [✎ 텍스트 수정], 텍스트 도구로 기존 글자 클릭) */
  edit(shape: VectorShape): void {
    const meta = shape.text;
    if (!meta) {
      this.onStatus('이 도형은 텍스트 원본이 없어 수정할 수 없습니다 (이전 버전에서 만들었거나 오프셋·불리언 결과)');
      return;
    }
    this.applyMetaToUI(meta);
    if (meta.path) {
      this.openPathDialog(shape);
      return;
    }
    this.close();
    this.editTarget = shape;
    this.anchor = apply(shape.transform, { x: 0, y: 0 });
    this.input.value = meta.content;
    this.input.hidden = false;
    this.view.hiddenShapeId = shape.id;
    this.placeInput();
    this.updatePreview();
    setTimeout(() => {
      this.input.focus();
      this.input.select();
    }, 0);
    this.onStatus('텍스트 수정 중 – Enter 확정 · Esc 취소');
  }

  // ---------------- 작업대 입력 ----------------

  private textShapeAt(p: Vec): VectorShape | null {
    for (let i = this.doc.shapes.length - 1; i >= 0; i--) {
      const s = this.doc.shapes[i];
      if (s.type === 'vector' && s.text && !s.text.path && this.doc.layer(s.layer).show && hitTest(s, p, 3 / this.view.zoom)) return s;
    }
    return null;
  }

  private async begin(p: Vec): Promise<void> {
    if (this.anchor && this.input.value.trim()) await this.commit();
    else this.close();
    // 기존 텍스트를 클릭하면 그 텍스트를 수정
    const hit = this.textShapeAt(p);
    if (hit) return this.edit(hit);
    this.anchor = p;
    this.input.value = '';
    this.input.hidden = false;
    this.placeInput();
    this.updatePreview();
    // 포인터 이벤트가 끝난 뒤 포커스 (캔버스가 포커스를 가져가지 않도록)
    setTimeout(() => this.input.focus(), 0);
  }

  /** 미리보기·입력 상자 위치용 변환 (수정 중이면 도형의 변환 그대로) */
  private previewMatrix(): Mat {
    return this.editTarget ? this.editTarget.transform : translate(this.anchor!.x, this.anchor!.y);
  }

  private placeInput(): void {
    if (!this.anchor || this.input.hidden) return;
    const s = this.view.toScreen(this.anchor);
    const size = this.request().size * this.view.zoom;
    this.input.style.left = `${Math.round(s.x)}px`;
    this.input.style.top = `${Math.round(s.y + Math.max(8, size * 0.4))}px`;
  }

  private async updatePreview(): Promise<void> {
    const anchor = this.anchor;
    if (!anchor) return;
    const text = this.input.value;
    this.input.rows = Math.max(1, text.split('\n').length);
    const token = ++this.loadToken;
    let paths: Polyline[];
    try {
      paths = await this.makeTextPaths(text, this.request());
    } catch (e) {
      this.onStatus((e as Error).message);
      return;
    }
    if (token !== this.loadToken || this.anchor !== anchor) return;
    const m = this.previewMatrix();
    this.view.textPreview = { anchor, paths: paths.map((l) => transformPolyline(m, l)) };
    this.placeInput();
    this.view.requestRender();
  }

  private label(text: string): string {
    const l = text.replace(/\s+/g, ' ').trim();
    return `Text "${l.length > 20 ? l.slice(0, 20) + '…' : l}"`;
  }

  async commit(): Promise<void> {
    const anchor = this.anchor;
    const editing = this.editTarget;
    const text = this.input.value;
    const meta = this.metaFromUI(text);
    this.close();
    if (!anchor) return;
    if (!text.trim()) {
      if (editing) this.onStatus('내용이 비어 있어 원래 텍스트를 유지했습니다 (지우려면 Del)');
      return;
    }
    try {
      if (editing) {
        await this.replaceText(editing, meta);
        this.doc.select([editing.id]);
        this.onStatus('텍스트를 수정했습니다');
        return;
      }
      const paths = await this.makeTextPaths(text, this.request());
      if (!paths.length) return;
      const s = makeVector(paths, this.doc.currentLayer, this.label(text), translate(anchor.x, anchor.y));
      s.text = meta;
      this.doc.add(s);
      this.onDone();
    } catch (e) {
      this.onStatus((e as Error).message);
    }
  }

  cancel(): void {
    this.close();
  }

  private close(): void {
    this.anchor = null;
    this.editTarget = null;
    this.view.hiddenShapeId = null;
    this.loadToken++;
    this.input.hidden = true;
    this.input.blur();
    this.view.textPreview = null;
    this.view.requestRender();
  }

  // ---------------- 곡선 따라 쓰기 ----------------

  private pathTarget(): { shape: VectorShape; path: Polyline } | null {
    const s = this.doc.selected().find((x): x is VectorShape => x.type === 'vector');
    if (!s) return null;
    // 가장 긴 경로를 기준선으로
    const paths = worldPaths(s);
    const len = (l: Polyline) => l.pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - l.pts[i - 1].x, p.y - l.pts[i - 1].y) : 0), 0);
    const path = paths.reduce((a, b) => (len(b) > len(a) ? b : a));
    return { shape: s, path };
  }

  /** editShape 를 주면 그 곡선 텍스트를 수정 */
  openPathDialog(editShape?: VectorShape): void {
    const em = editShape?.text?.path ? editShape.text : null;
    const target = em ? { path: em.path!.line } : this.pathTarget();
    if (!target) {
      this.onStatus('먼저 선택 도구로 글자를 올릴 곡선(원, 선, 경로)을 선택하세요');
      return;
    }
    const dlg = $<HTMLDialogElement>('text-path-dialog');
    const f = dlg.querySelector('form')!;
    const val = (n: string) => f.elements.namedItem(n) as HTMLInputElement;
    const sideSel = f.elements.namedItem('side') as HTMLSelectElement;
    if (em) {
      val('text').value = em.content;
      val('size').value = String(em.size);
      val('position').value = String(em.path!.position);
      sideSel.value = em.path!.side;
      val('reverse').checked = em.path!.reverse;
      val('offset').value = String(em.path!.offset);
    } else {
      if (!val('size').value) val('size').value = String(this.request().size);
      if (!val('position').value) val('position').value = target.path.closed ? '75' : '50';
    }
    dlg.querySelector('h3')!.textContent = em ? '〰 곡선 텍스트 수정' : '〰 곡선 따라 쓰기';
    const place = () => ({
      position: Number(val('position').value) || 0,
      side: sideSel.value as 'above' | 'below',
      reverse: val('reverse').checked,
      offset: Number(val('offset').value) || 0,
    });
    const opts = () => ({ ...this.request(), size: Math.max(0.1, Number(val('size').value) || 10), ...place() });
    // 수정 중이면 도형을 숨기고, 도형을 옮긴 변환을 미리보기에 그대로 적용
    const m: Mat = editShape?.transform ?? [1, 0, 0, 1, 0, 0];
    if (editShape) this.view.hiddenShapeId = editShape.id;
    let token = 0;
    const preview = async () => {
      const my = ++token;
      const text = val('text').value;
      try {
        const paths = text.trim() ? await this.makePathTextPaths(text, target.path, opts()) : [];
        if (my !== token) return;
        this.view.textPreview = { anchor: apply(m, target.path.pts[0]), paths: paths.map((l) => transformPolyline(m, l)) };
        this.view.requestRender();
      } catch (e) {
        this.onStatus((e as Error).message);
      }
    };
    f.oninput = () => void preview();
    void preview();
    dlg.onclose = async () => {
      token++;
      this.view.textPreview = null;
      this.view.hiddenShapeId = null;
      this.view.requestRender();
      if (dlg.returnValue !== 'ok') return;
      const text = val('text').value;
      if (!text.trim()) return;
      const meta: TextMeta = { ...this.metaFromUI(text), size: opts().size, path: { line: target.path, ...place() } };
      try {
        if (editShape) {
          await this.replaceText(editShape, meta);
          this.onStatus('텍스트를 수정했습니다');
          return;
        }
        const paths = await this.buildFromMeta(meta);
        if (!paths.length) return this.onStatus('경로가 짧아 글자를 배치하지 못했습니다');
        const s = makeVector(paths, this.doc.currentLayer, this.label(text));
        s.text = meta;
        this.doc.add(s);
        this.onStatus('곡선을 따라 텍스트를 배치했습니다');
      } catch (e) {
        this.onStatus((e as Error).message);
      }
    };
    dlg.showModal();
    val('text').focus();
  }

  private setupPathDialog(): void {
    const dlg = $<HTMLDialogElement>('text-path-dialog');
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
  }
}
