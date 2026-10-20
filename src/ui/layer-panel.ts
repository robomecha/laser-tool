// 가공 레이어 목록 + 선택 레이어 상세 편집기
import { LaserDocument } from '../core/document';
import { DitherMode, layerColor, LayerMode, LayerSettings } from '../core/layers';

const MODE_LABEL: Record<LayerMode, string> = { line: '라인 (컷)', fill: '채우기', image: '이미지' };
const DITHER_LABEL: Record<DitherMode, string> = {
  floyd: 'Floyd-Steinberg',
  atkinson: 'Atkinson',
  threshold: '임계값',
  grayscale: '그레이스케일',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

export class LayerPanel {
  private selected: number | null = null;

  constructor(
    private doc: LaserDocument,
    private tbody: HTMLElement,
    private editor: HTMLElement,
  ) {
    doc.onChange((k) => {
      if (k !== 'shapes') this.render();
    });
    this.render();
  }

  private update(index: number, patch: Partial<LayerSettings>): void {
    this.doc.updateLayer(index, patch);
  }

  render(): void {
    const layers = this.doc.usedLayers();
    if (this.selected === null || !layers.some((l) => l.index === this.selected)) this.selected = layers[0]?.index ?? null;
    // 선택된 도형의 레이어를 강조
    const selLayers = new Set(this.doc.selected().map((s) => s.layer));
    this.tbody.replaceChildren();
    if (!layers.length) {
      this.tbody.append(el('tr', {}, [el('td', { className: 'empty', colSpan: 7, textContent: '도형을 그리거나 가져오면 레이어가 표시됩니다' })]));
    }
    for (const l of layers) {
      const tr = el('tr', { className: l.index === this.selected ? 'sel' : '' });
      tr.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('input,select')) return;
        this.selected = l.index;
        this.doc.currentLayer = l.index;
        this.render();
      });
      const sw = el('span', { className: 'swatch' });
      sw.style.background = layerColor(l.index);
      const mode = el('select');
      for (const m of Object.keys(MODE_LABEL) as LayerMode[]) mode.append(el('option', { value: m, textContent: MODE_LABEL[m], selected: m === l.mode }));
      mode.onchange = () => this.update(l.index, { mode: mode.value as LayerMode });
      const speed = el('input', { type: 'number', value: String(l.speed), min: '0.1', step: '1' });
      speed.style.width = '52px';
      speed.onchange = () => this.update(l.index, { speed: Math.max(0.1, Number(speed.value)) });
      const power = el('input', { type: 'number', value: String(l.power), min: '0', max: '100', step: '1' });
      power.style.width = '46px';
      power.onchange = () => this.update(l.index, { power: Math.min(100, Math.max(0, Number(power.value))) });
      const out = el('input', { type: 'checkbox', checked: l.output, title: '출력 여부' });
      out.onchange = () => this.update(l.index, { output: out.checked });
      const show = el('input', { type: 'checkbox', checked: l.show, title: '화면 표시' });
      show.onchange = () => this.update(l.index, { show: show.checked });
      const name = el('span', { textContent: l.name });
      if (selLayers.has(l.index)) name.style.fontWeight = '700';
      tr.append(
        el('td', {}, [sw]),
        el('td', {}, [name]),
        el('td', {}, [mode]),
        el('td', {}, [speed]),
        el('td', {}, [power]),
        el('td', {}, [out]),
        el('td', {}, [show]),
      );
      this.tbody.append(tr);
    }
    this.renderEditor();
  }

  private renderEditor(): void {
    this.editor.replaceChildren();
    if (this.selected === null) return;
    const l = this.doc.layer(this.selected);
    const num = (label: string, key: keyof LayerSettings, opts: { min?: number; max?: number; step?: number; unit?: string } = {}) => {
      const input = el('input', { type: 'number', value: String(l[key]), step: String(opts.step ?? 1) });
      if (opts.min !== undefined) input.min = String(opts.min);
      if (opts.max !== undefined) input.max = String(opts.max);
      input.onchange = () => {
        let v = Number(input.value);
        if (opts.min !== undefined) v = Math.max(opts.min, v);
        if (opts.max !== undefined) v = Math.min(opts.max, v);
        this.update(l.index, { [key]: v } as Partial<LayerSettings>);
      };
      return el('label', {}, [`${label}${opts.unit ? ` (${opts.unit})` : ''}`, input]);
    };
    const check = (label: string, key: keyof LayerSettings) => {
      const input = el('input', { type: 'checkbox', checked: Boolean(l[key]) });
      input.onchange = () => this.update(l.index, { [key]: input.checked } as Partial<LayerSettings>);
      return el('label', { className: 'check' }, [input, label]);
    };
    const nameInput = el('input', { type: 'text', value: l.name });
    nameInput.onchange = () => this.update(l.index, { name: nameInput.value || l.name });

    const items: HTMLElement[] = [
      el('label', {}, ['이름', nameInput]),
      num('속도', 'speed', { min: 0.1, unit: 'mm/s' }),
      num('최대 출력', 'power', { min: 0, max: 100, unit: '%' }),
      num('최소 출력', 'minPower', { min: 0, max: 100, unit: '%' }),
      num('반복 횟수', 'passes', { min: 1, max: 50 }),
    ];
    if (l.mode !== 'line') {
      items.push(
        num('라인 간격', 'interval', { min: 0.01, step: 0.01, unit: 'mm' }),
        num('오버스캔', 'overscan', { min: 0, step: 0.5, unit: 'mm' }),
        check('양방향 스캔', 'bidirectional'),
      );
    }
    if (l.mode === 'fill') items.push(num('스캔 각도', 'angle', { min: -180, max: 180, unit: '°' }));
    if (l.mode === 'image') {
      const d = el('select');
      for (const k of Object.keys(DITHER_LABEL) as DitherMode[]) d.append(el('option', { value: k, textContent: DITHER_LABEL[k], selected: k === l.dither }));
      d.onchange = () => this.update(l.index, { dither: d.value as DitherMode });
      items.push(el('label', {}, ['디더링', d]), check('이미지 반전', 'negative'));
      const dpi = el('span', { textContent: `≈ ${Math.round(25.4 / l.interval)} DPI` });
      dpi.style.color = 'var(--muted)';
      items.push(dpi);
    }
    items.push(check('에어 어시스트', 'airAssist'));
    this.editor.append(...items);
  }
}
