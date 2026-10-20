// 격자 배열 / 원형 배열 대화상자
import { circularArray, gridArray } from '../core/array';
import { DeviceSettings } from '../core/device';
import { LaserDocument } from '../core/document';
import { isEmptyBBox } from '../core/geometry';

type Form = HTMLFormElement & { elements: HTMLFormControlsCollection };

const field = (f: Form, name: string) => f.elements.namedItem(name) as HTMLInputElement;
const num = (f: Form, name: string, def = 0) => {
  const v = Number(field(f, name).value);
  return Number.isFinite(v) ? v : def;
};

export class ArrayDialogs {
  constructor(
    private doc: LaserDocument,
    private device: () => DeviceSettings,
    private status: (msg: string) => void,
  ) {}

  private needSelection(): boolean {
    if (this.doc.selection.size) return true;
    this.status('배열할 도형을 먼저 선택하세요');
    return false;
  }

  openGrid(): void {
    if (!this.needSelection()) return;
    const dlg = document.getElementById('grid-array-dialog') as HTMLDialogElement;
    const f = dlg.querySelector('form') as Form;
    const b = this.doc.selectionBBox();
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const update = () => {
      const cols = Math.max(1, Math.floor(num(f, 'columns', 1)));
      const rows = Math.max(1, Math.floor(num(f, 'rows', 1)));
      const gap = field(f, 'spacing').value === 'gap';
      const sx = num(f, 'spacingX');
      const sy = num(f, 'spacingY');
      const totalW = (cols - 1) * (gap ? w + sx : sx) + w;
      const totalH = (rows - 1) * (gap ? h + sy : sy) + h;
      dlg.querySelector('[data-role=size]')!.textContent = `선택 크기 ${w.toFixed(1)} × ${h.toFixed(1)} mm`;
      const d = this.device();
      const over = b.minX + totalW > d.bedWidth || b.minY + totalH > d.bedHeight;
      dlg.querySelector('[data-role=summary]')!.textContent =
        `총 ${cols * rows}개, 전체 크기 ${totalW.toFixed(1)} × ${totalH.toFixed(1)} mm` + (over ? ' – ⚠ 작업대를 벗어납니다' : '');
    };
    f.oninput = update;
    update();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const copies = gridArray(this.doc.selected(), {
        columns: num(f, 'columns', 1),
        rows: num(f, 'rows', 1),
        spacingX: num(f, 'spacingX'),
        spacingY: num(f, 'spacingY'),
        spacing: field(f, 'spacing').value as 'gap' | 'pitch',
      });
      this.commit(copies);
    };
    dlg.showModal();
  }

  openCircular(): void {
    if (!this.needSelection()) return;
    const dlg = document.getElementById('circular-array-dialog') as HTMLDialogElement;
    const f = dlg.querySelector('form') as Form;
    const b = this.doc.selectionBBox();
    if (isEmptyBBox(b)) return;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const setCenter = (x: number, y: number) => {
      field(f, 'cx').value = x.toFixed(2);
      field(f, 'cy').value = y.toFixed(2);
    };
    // 기본 중심: 선택 영역 아래쪽 (선택 높이의 1.5배 거리) – 원본이 원의 맨 위에 오도록
    const below = () => setCenter(cx, cy + Math.max(b.maxY - b.minY, b.maxX - b.minX, 10) * 1.5);
    below();
    for (const btn of dlg.querySelectorAll<HTMLButtonElement>('[data-center]')) {
      btn.onclick = () => {
        const d = this.device();
        if (btn.dataset.center === 'below') below();
        else if (btn.dataset.center === 'selection') setCenter(cx, cy);
        else setCenter(d.bedWidth / 2, d.bedHeight / 2);
      };
    }
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const copies = circularArray(this.doc.selected(), {
        count: num(f, 'count', 2),
        totalAngle: num(f, 'totalAngle', 360),
        center: { x: num(f, 'cx', cx), y: num(f, 'cy', cy) },
        rotateCopies: field(f, 'rotateCopies').checked,
      });
      this.commit(copies);
    };
    dlg.showModal();
  }

  private commit(copies: ReturnType<typeof gridArray>): void {
    if (!copies.length) {
      this.status('만들 복사본이 없습니다 (개수를 2 이상으로)');
      return;
    }
    const originals = [...this.doc.selection];
    this.doc.add(copies, false);
    // 원본과 복사본을 함께 선택해 바로 이동·정렬할 수 있게
    this.doc.select([...originals, ...copies.map((c) => c.id)]);
    this.status(`복사본 ${copies.length}개를 만들었습니다 (Ctrl+Z 로 되돌리기)`);
  }
}
