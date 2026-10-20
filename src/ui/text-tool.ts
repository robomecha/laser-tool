// 텍스트 도구: 글꼴 관리(기본 내장 + 사용자 업로드), 작업대 위 입력 상자, 실시간 미리보기
import nanumRegularUrl from '@expo-google-fonts/nanum-gothic/400Regular/NanumGothic_400Regular.ttf?url';
import nanumBoldUrl from '@expo-google-fonts/nanum-gothic/700Bold/NanumGothic_700Bold.ttf?url';
import { LaserDocument } from '../core/document';
import { translate, transformPolyline, Vec } from '../core/geometry';
import { makeVector } from '../core/shapes';
import { TextAlign, textToPolylines } from '../core/text';
import { Font, fontDisplayName, parseFont } from '../io/font';
import { CanvasView } from './canvas-view';

interface FontEntry {
  name: string;
  /** 내장 글꼴은 처음 쓸 때 내려받는다 */
  url?: string;
  font?: Font;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class TextTool {
  private fonts: FontEntry[] = [
    { name: '나눔고딕 (기본)', url: nanumRegularUrl },
    { name: '나눔고딕 Bold', url: nanumBoldUrl },
  ];
  private anchor: Vec | null = null;
  private input = $<HTMLTextAreaElement>('text-input');
  private fontSel = $<HTMLSelectElement>('text-font');
  private loadToken = 0;

  /** 상태 표시줄 메시지 */
  onStatus: (msg: string) => void = () => {};
  /** 텍스트 도형을 추가한 뒤 */
  onDone: () => void = () => {};

  constructor(
    private doc: LaserDocument,
    private view: CanvasView,
  ) {
    this.renderFontList();
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
    for (const id of ['text-size', 'text-spacing', 'text-line', 'text-align', 'text-font']) {
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
  }

  /** 도구 선택 시 옵션 바 표시 */
  setActive(on: boolean): void {
    $('text-options').hidden = !on;
    if (!on) this.cancel();
    else void this.currentFont().catch(() => {}); // 미리 내려받기
  }

  get editing(): boolean {
    return this.anchor !== null;
  }

  async addFontFile(f: File): Promise<void> {
    try {
      const font = parseFont(await f.arrayBuffer());
      const name = `${fontDisplayName(font)} (${f.name})`;
      this.fonts.push({ name, font });
      this.renderFontList();
      this.fontSel.value = String(this.fonts.length - 1);
      this.updatePreview();
      this.onStatus(`글꼴을 불러왔습니다: ${name}`);
    } catch (e) {
      this.onStatus(`글꼴을 읽을 수 없습니다: ${(e as Error).message}`);
    }
  }

  private renderFontList(): void {
    const cur = this.fontSel.value;
    this.fontSel.replaceChildren(
      ...this.fonts.map((f, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = f.name;
        return o;
      }),
    );
    if (cur) this.fontSel.value = cur;
  }

  private async currentFont(): Promise<Font> {
    const entry = this.fonts[Number(this.fontSel.value) || 0];
    if (!entry.font) {
      const res = await fetch(entry.url!);
      if (!res.ok) throw new Error(`글꼴 내려받기 실패 (${res.status})`);
      entry.font = parseFont(await res.arrayBuffer());
    }
    return entry.font;
  }

  private options() {
    return {
      size: Math.max(0.1, Number($<HTMLInputElement>('text-size').value) || 10),
      letterSpacing: Number($<HTMLInputElement>('text-spacing').value) || 0,
      lineHeight: Number($<HTMLInputElement>('text-line').value) || 1.2,
      align: $<HTMLSelectElement>('text-align').value as TextAlign,
    };
  }

  private async begin(p: Vec): Promise<void> {
    if (this.anchor && this.input.value.trim()) await this.commit();
    this.anchor = p;
    this.input.value = '';
    this.input.hidden = false;
    this.placeInput();
    this.updatePreview();
    // 포인터 이벤트가 끝난 뒤 포커스 (캔버스가 포커스를 가져가지 않도록)
    setTimeout(() => this.input.focus(), 0);
  }

  private placeInput(): void {
    if (!this.anchor || this.input.hidden) return;
    const s = this.view.toScreen(this.anchor);
    const size = this.options().size * this.view.zoom;
    this.input.style.left = `${Math.round(s.x)}px`;
    this.input.style.top = `${Math.round(s.y + Math.max(8, size * 0.4))}px`;
  }

  private async updatePreview(): Promise<void> {
    const anchor = this.anchor;
    if (!anchor) return;
    const text = this.input.value;
    this.input.rows = Math.max(1, text.split('\n').length);
    const token = ++this.loadToken;
    let font: Font;
    try {
      font = await this.currentFont();
    } catch (e) {
      this.onStatus((e as Error).message);
      return;
    }
    if (token !== this.loadToken || this.anchor !== anchor) return;
    const m = translate(anchor.x, anchor.y);
    this.view.textPreview = {
      anchor,
      paths: textToPolylines(font, text, this.options()).map((l) => transformPolyline(m, l)),
    };
    this.placeInput();
    this.view.requestRender();
  }

  async commit(): Promise<void> {
    const anchor = this.anchor;
    const text = this.input.value;
    this.close();
    if (!anchor || !text.trim()) return;
    try {
      const font = await this.currentFont();
      const paths = textToPolylines(font, text, this.options());
      if (!paths.length) return;
      const label = text.replace(/\s+/g, ' ').trim();
      this.doc.add(makeVector(paths, this.doc.currentLayer, `Text "${label.length > 20 ? label.slice(0, 20) + '…' : label}"`, translate(anchor.x, anchor.y)));
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
    this.loadToken++;
    this.input.hidden = true;
    this.input.blur();
    this.view.textPreview = null;
    this.view.requestRender();
  }
}
