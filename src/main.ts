// 앱 진입점: 문서·화면·패널·장비 연결을 묶는다.
import { DeviceSettings, fromMachine, loadDevice, saveDevice, toMachine } from './core/device';
import { LaserDocument } from './core/document';
import { about, isEmptyBBox, Mat, rotate, scale, translate } from './core/geometry';
import { layerColor, PALETTE } from './core/layers';
import { BoolOp, booleanOp, OffsetJoin, offsetPolylines } from './core/clip';
import { cloneShape, ImageShape, makeVector, Shape, shapeBBox, VectorShape, worldPaths } from './core/shapes';
import { estimateJob, formatDuration, Job, jobBBox } from './cam/job';
import { planJob } from './cam/planner';
import { GrblConnection } from './device/grbl-serial';
import { RuidaUsbConnection } from './device/ruida-usb';
import { importDXF } from './io/dxf-import';
import { grayForShapes, importImage } from './io/image-import';
import { loadProjectInto, PROJECT_EXT, serializeProject } from './io/project';
import { importSVG } from './io/svg-import';
import { jobToGcode } from './output/gcode';
import { jobToRuidaFile, jobToRuidaPlain } from './output/ruida';
import { CanvasView, Tool } from './ui/canvas-view';
import { LayerPanel } from './ui/layer-panel';
import { AiBridge } from './ai/bridge';
import { TextTool } from './ui/text-tool';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let device: DeviceSettings = loadDevice();
const doc = new LaserDocument();
const view = new CanvasView($<HTMLCanvasElement>('view'), doc, () => device);
new LayerPanel(doc, document.querySelector('#layer-table tbody')!, $('layer-editor'));
const textTool = new TextTool(doc, view);
const ai = new AiBridge({ doc, device: () => device, textTool });
const grbl = new GrblConnection();
const ruida = new RuidaUsbConnection();
let clipboard: Shape[] = [];
let projectName = 'untitled';

// ---------------- 상태 표시 ----------------

let msgTimer = 0;
function status(msg: string, sticky = false): void {
  $('status-msg').textContent = msg;
  clearTimeout(msgTimer);
  if (!sticky) msgTimer = window.setTimeout(() => ($('status-msg').textContent = ''), 6000);
}

function log(line: string, cls: 'in' | 'out' | 'err' = 'in'): void {
  const c = $('console');
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = (cls === 'out' ? '> ' : '') + line;
  c.append(div);
  while (c.childElementCount > 500) c.firstElementChild?.remove();
  c.scrollTop = c.scrollHeight;
}

view.onCursor = (p) => {
  const m = toMachine(device, p.x, p.y);
  $('status-pos').textContent = `X ${m.x.toFixed(2)}  Y ${m.y.toFixed(2)} mm`;
};
view.onZoom = (z) => ($('status-zoom').textContent = `${Math.round(z * 100) / 100} px/mm`);
view.onToolDone = () => {};
textTool.onStatus = (m) => status(m);
textTool.onDone = () => status('텍스트를 추가했습니다 (경로로 변환됨)');

// ---------------- 팔레트 ----------------

function renderPalette(): void {
  const p = $('palette');
  p.replaceChildren();
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.textContent = String(i).padStart(2, '0');
    b.title = `레이어 C${String(i).padStart(2, '0')} – 클릭: 선택 도형을 이 레이어로 / 새 도형 레이어 지정`;
    if (i === doc.currentLayer) b.className = 'current';
    b.onclick = () => {
      doc.currentLayer = i;
      if (doc.selection.size) doc.setLayerOfSelected(i);
      renderPalette();
    };
    p.append(b);
  });
}

// ---------------- 수치 편집 ----------------

const numX = $<HTMLInputElement>('num-x');
const numY = $<HTMLInputElement>('num-y');
const numW = $<HTMLInputElement>('num-w');
const numH = $<HTMLInputElement>('num-h');
const numRot = $<HTMLInputElement>('num-rot');

function refreshNumeric(): void {
  const b = doc.selectionBBox();
  const has = !isEmptyBBox(b);
  for (const i of [numX, numY, numW, numH, numRot]) i.disabled = !has;
  if (!has) {
    for (const i of [numX, numY, numW, numH]) i.value = '';
    return;
  }
  if (document.activeElement !== numX) numX.value = b.minX.toFixed(2);
  if (document.activeElement !== numY) numY.value = b.minY.toFixed(2);
  if (document.activeElement !== numW) numW.value = (b.maxX - b.minX).toFixed(2);
  if (document.activeElement !== numH) numH.value = (b.maxY - b.minY).toFixed(2);
}

function applyNumeric(which: 'x' | 'y' | 'w' | 'h' | 'rot'): void {
  const b = doc.selectionBBox();
  if (isEmptyBBox(b)) return;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const lock = $<HTMLInputElement>('num-lock').checked;
  let m: Mat;
  switch (which) {
    case 'x':
      m = translate(Number(numX.value) - b.minX, 0);
      break;
    case 'y':
      m = translate(0, Number(numY.value) - b.minY);
      break;
    case 'w': {
      const s = Math.max(0.01, Number(numW.value)) / (w || 1);
      m = about(scale(s, lock ? s : 1), b.minX, b.minY);
      break;
    }
    case 'h': {
      const s = Math.max(0.01, Number(numH.value)) / (h || 1);
      m = about(scale(lock ? s : 1, s), b.minX, b.minY);
      break;
    }
    case 'rot': {
      const a = (Number(numRot.value) * Math.PI) / 180;
      m = about(rotate(a), (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
      numRot.value = '0';
      break;
    }
  }
  doc.transformSelected(m);
}

numX.onchange = () => applyNumeric('x');
numY.onchange = () => applyNumeric('y');
numW.onchange = () => applyNumeric('w');
numH.onchange = () => applyNumeric('h');
numRot.onchange = () => applyNumeric('rot');

doc.onChange((k) => {
  refreshNumeric();
  if (k === 'all') renderPalette();
  document.querySelector<HTMLButtonElement>('[data-cmd=undo]')!.disabled = !doc.canUndo;
  document.querySelector<HTMLButtonElement>('[data-cmd=redo]')!.disabled = !doc.canRedo;
  if (view.previewJob && k !== 'selection') closePreview();
});

// ---------------- 파일 ----------------

function download(name: string, data: BlobPart, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function importFiles(files: FileList | File[]): Promise<void> {
  for (const f of Array.from(files)) {
    const ext = f.name.split('.').pop()!.toLowerCase();
    try {
      if (ext === 'ltp' || ext === 'json') {
        loadProjectInto(doc, await f.text());
        projectName = f.name.replace(/\.[^.]+$/, '');
        view.zoomToFit();
        status(`프로젝트 열기: ${f.name}`);
        continue;
      }
      let shapes: Shape[] = [];
      let warnings: string[] = [];
      if (ext === 'svg') ({ shapes, warnings } = importSVG(await f.text(), doc.currentLayer));
      else if (ext === 'dxf') ({ shapes, warnings } = importDXF(await f.text(), doc.currentLayer));
      else if (['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'].includes(ext)) {
        const img = await importImage(f, doc.currentLayer, f.name);
        shapes = [img];
        doc.layer(img.layer).mode = 'image';
      } else throw new Error('지원하지 않는 파일 형식입니다');
      // SVG 내장 이미지 크기 보정
      for (const s of shapes) if (s.type === 'image' && !s.pxW) doc.layer(s.layer).mode = 'image';
      doc.add(shapes);
      for (const w of warnings) log(`[가져오기] ${w}`, 'err');
      status(`${f.name}: 도형 ${shapes.length}개 가져옴${warnings.length ? ` (경고 ${warnings.length})` : ''}`);
    } catch (e) {
      status(`${f.name}: ${(e as Error).message}`);
      log(`[가져오기 실패] ${f.name}: ${(e as Error).message}`, 'err');
    }
  }
}

async function buildJob(): Promise<{ job: Job; warnings: string[] } | null> {
  const selectedOnly = $<HTMLInputElement>('opt-selected').checked;
  const imgs = doc.shapes.filter((s): s is ImageShape => s.type === 'image');
  let images;
  try {
    images = await grayForShapes(imgs);
  } catch (e) {
    status((e as Error).message);
    return null;
  }
  const res = planJob(doc, { selectedOnly, images, start: fromMachine(device, 0, 0) });
  for (const w of res.warnings) log(`[작업] ${w}`, 'err');
  if (!res.job.blocks.length) {
    status('출력할 도형이 없습니다 (레이어 출력 설정을 확인하세요)');
    return null;
  }
  const b = jobBBox(res.job);
  if (b.minX < -0.01 || b.minY < -0.01 || b.maxX > device.bedWidth + 0.01 || b.maxY > device.bedHeight + 0.01) {
    log('[작업] 경고: 작업 영역(작업대)을 벗어난 경로가 있습니다', 'err');
  }
  return res;
}

// ---------------- 미리보기 ----------------

let playTimer = 0;
async function openPreview(): Promise<void> {
  const res = await buildJob();
  if (!res) return;
  view.previewJob = res.job;
  view.previewFraction = 1;
  $<HTMLInputElement>('preview-slider').value = '1000';
  const st = estimateJob(res.job, device.travelSpeed, fromMachine(device, 0, 0));
  $('preview-stats').textContent = `예상 ${formatDuration(st.seconds)} · 가공 ${(st.cutLength / 1000).toFixed(2)} m · 공이동 ${(st.travelLength / 1000).toFixed(2)} m`;
  $('preview-bar').hidden = false;
  view.requestRender();
}

function closePreview(): void {
  clearInterval(playTimer);
  playTimer = 0;
  view.previewJob = null;
  $('preview-bar').hidden = true;
  view.requestRender();
}

$<HTMLInputElement>('preview-slider').oninput = (e) => {
  view.previewFraction = Number((e.target as HTMLInputElement).value) / 1000;
  view.requestRender();
};
$<HTMLInputElement>('preview-travel').onchange = (e) => {
  view.previewTravel = (e.target as HTMLInputElement).checked;
  view.requestRender();
};
$('preview-close').onclick = closePreview;
$('preview-play').onclick = () => {
  const slider = $<HTMLInputElement>('preview-slider');
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = 0;
    return;
  }
  if (Number(slider.value) >= 1000) slider.value = '0';
  playTimer = window.setInterval(() => {
    const v = Math.min(1000, Number(slider.value) + 4);
    slider.value = String(v);
    view.previewFraction = v / 1000;
    view.requestRender();
    if (v >= 1000) {
      clearInterval(playTimer);
      playTimer = 0;
    }
  }, 30);
};

// ---------------- 정렬/변형 명령 ----------------

function alignSelected(kind: string): void {
  const sel = doc.selected();
  if (sel.length < 2) {
    status('정렬하려면 도형을 2개 이상 선택하세요');
    return;
  }
  const all = doc.selectionBBox();
  doc.checkpoint();
  for (const s of sel) {
    const b = shapeBBox(s);
    let dx = 0;
    let dy = 0;
    if (kind === 'left') dx = all.minX - b.minX;
    if (kind === 'right') dx = all.maxX - b.maxX;
    if (kind === 'hcenter') dx = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2;
    if (kind === 'top') dy = all.minY - b.minY;
    if (kind === 'bottom') dy = all.maxY - b.maxY;
    if (kind === 'vcenter') dy = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2;
    s.transform[4] += dx;
    s.transform[5] += dy;
  }
  doc.emit('shapes');
}

function transformAroundSelection(m: Mat): void {
  const b = doc.selectionBBox();
  if (isEmptyBBox(b)) return;
  doc.transformSelected(about(m, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2));
}

// ---------------- 오프셋 / 불리언 ----------------

function selectedVectors(): VectorShape[] {
  return doc.selected().filter((s): s is VectorShape => s.type === 'vector');
}

function offsetSelected(): void {
  const shapes = selectedVectors();
  const delta = Number($<HTMLInputElement>('offset-dist').value);
  if (!shapes.length) return status('오프셋할 벡터 도형을 선택하세요');
  if (!delta) return status('오프셋 거리를 입력하세요 (양수: 바깥, 음수: 안쪽)');
  const join = $<HTMLSelectElement>('offset-join').value as OffsetJoin;
  const out: Shape[] = [];
  for (const s of shapes) {
    const paths = offsetPolylines(worldPaths(s), delta, { join });
    if (paths.length) out.push(makeVector(paths, s.layer, `${s.name} 오프셋`));
  }
  if (!out.length) return status('오프셋 결과가 없습니다 (안쪽 오프셋이 도형보다 크거나 닫힌 도형이 아닙니다)');
  doc.add(out);
  status(`오프셋 ${delta > 0 ? '바깥' : '안쪽'} ${Math.abs(delta)} mm: 도형 ${out.length}개 생성`);
}

const BOOL_NAMES: Record<BoolOp, string> = { union: '합치기', difference: '빼기', intersection: '교집합', xor: '배타적 합' };

function booleanSelected(op: BoolOp): void {
  // 선택한 순서 유지 (빼기: 처음 선택한 도형에서 나머지를 뺀다)
  const shapes = [...doc.selection].map((id) => doc.get(id)).filter((s): s is VectorShape => s?.type === 'vector');
  if (shapes.length < 2) return status(`${BOOL_NAMES[op]}: 닫힌 벡터 도형을 2개 이상 선택하세요`);
  const paths = booleanOp(op, shapes.map((s) => worldPaths(s)));
  if (!paths.length) return status(`${BOOL_NAMES[op]}: 결과가 비어 있습니다 (겹치는 닫힌 도형이 없습니다)`);
  doc.replace(
    shapes.map((s) => s.id),
    [makeVector(paths, shapes[0].layer, BOOL_NAMES[op])],
  );
  status(`${BOOL_NAMES[op]}: 경로 ${paths.length}개`);
}

const commands: Record<string, () => void | Promise<void>> = {
  new: () => {
    if (doc.shapes.length && !confirm('현재 작업을 지우고 새로 시작할까요?')) return;
    doc.load([], []);
    projectName = 'untitled';
  },
  open: () => $<HTMLInputElement>('file-open').click(),
  save: () => {
    download(`${projectName}${PROJECT_EXT}`, serializeProject(doc), 'application/json');
    status('프로젝트를 저장했습니다');
  },
  import: () => $<HTMLInputElement>('file-import').click(),
  'export-gcode': async () => {
    const res = await buildJob();
    if (!res) return;
    download(`${projectName}.gcode`, jobToGcode(res.job, device, { comment: projectName }), 'text/plain');
    status('G-code 를 내보냈습니다');
  },
  'export-rd': async () => {
    const res = await buildJob();
    if (!res) return;
    download(`${projectName}.rd`, jobToRuidaFile(res.job, device) as BlobPart, 'application/octet-stream');
    status('RD 파일을 내보냈습니다 (실험적 – 저출력으로 먼저 시험하세요)');
    log('[RD] 전송: npm run ruida:send -- <파일.rd> ' + device.ruidaHost);
  },
  undo: () => doc.undo(),
  redo: () => doc.redo(),
  delete: () => doc.deleteSelected(),
  duplicate: () => doc.duplicateSelected(),
  'align-left': () => alignSelected('left'),
  'align-hcenter': () => alignSelected('hcenter'),
  'align-right': () => alignSelected('right'),
  'align-top': () => alignSelected('top'),
  'align-vcenter': () => alignSelected('vcenter'),
  'align-bottom': () => alignSelected('bottom'),
  'mirror-h': () => transformAroundSelection(scale(-1, 1)),
  'mirror-v': () => transformAroundSelection(scale(1, -1)),
  'rotate-cw': () => transformAroundSelection(rotate(Math.PI / 2)),
  'rotate-ccw': () => transformAroundSelection(rotate(-Math.PI / 2)),
  'center-bed': () => {
    const b = doc.selectionBBox();
    if (isEmptyBBox(b)) return;
    doc.transformSelected(translate(device.bedWidth / 2 - (b.minX + b.maxX) / 2, device.bedHeight / 2 - (b.minY + b.maxY) / 2));
  },
  offset: () => offsetSelected(),
  'bool-union': () => booleanSelected('union'),
  'bool-difference': () => booleanSelected('difference'),
  'bool-intersection': () => booleanSelected('intersection'),
  preview: () => (view.previewJob ? closePreview() : openPreview()),
  device: () => openDeviceDialog(),
  'zoom-fit': () => view.zoomToFit(),
  copy: () => {
    clipboard = doc.selected().map((s) => cloneShape(s));
  },
  paste: () => {
    if (!clipboard.length) return;
    const copies = clipboard.map((s) => {
      const c = cloneShape(s, false);
      c.transform[4] += 10;
      c.transform[5] += 10;
      return c;
    });
    clipboard = copies.map((s) => cloneShape(s));
    doc.add(copies);
  },
};

document.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
  b.onclick = () => void commands[b.dataset.cmd!]?.();
});

function setTool(t: Tool): void {
  view.setTool(t);
  textTool.setActive(t === 'text');
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
  b.onclick = () => setTool(b.dataset.tool as Tool);
});

$<HTMLInputElement>('file-open').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files;
  if (f) void importFiles(f);
  (e.target as HTMLInputElement).value = '';
};
$<HTMLInputElement>('file-import').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files;
  if (f) void importFiles(f);
  (e.target as HTMLInputElement).value = '';
};

// 드래그 앤 드롭
const wrap = $('canvas-wrap');
wrap.addEventListener('dragover', (e) => {
  e.preventDefault();
  $('drop-hint').hidden = false;
});
wrap.addEventListener('dragleave', () => ($('drop-hint').hidden = true));
wrap.addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop-hint').hidden = true;
  if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
});

// ---------------- 단축키 ----------------

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const run = (c: string) => {
    e.preventDefault();
    void commands[c]();
  };
  if (ctrl && k === 'z' && !e.shiftKey) return run('undo');
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return run('redo');
  if (ctrl && k === 'a') {
    e.preventDefault();
    return doc.selectAll();
  }
  if (ctrl && k === 'd') return run('duplicate');
  if (ctrl && k === 'c') return run('copy');
  if (ctrl && k === 'v') return run('paste');
  if (ctrl && k === 'x') {
    commands.copy();
    return run('delete');
  }
  if (ctrl && k === 's') return run('save');
  if (ctrl && k === 'o') return run('open');
  if (ctrl && k === 'i') return run('import');
  if (ctrl) return;
  if (e.key === 'Delete' || e.key === 'Backspace') return run('delete');
  if (e.key === 'Escape') {
    if (view.previewJob) closePreview();
    else if (view.tool !== 'select') setTool('select');
    else doc.clearSelection();
    view.cancelTool();
    return;
  }
  if (e.key === 'Enter') return view.finishPoly(false);
  if (e.key.startsWith('Arrow') && doc.selection.size) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!;
    return doc.transformSelected(translate(d[0], d[1]));
  }
  const tools: Record<string, Tool> = { s: 'select', l: 'line', r: 'rect', e: 'ellipse', t: 'text', h: 'pan' };
  if (tools[k]) return setTool(tools[k]);
  if (k === 'p') return run('preview');
  if (k === 'o') return run('offset');
  if (k === 'f') return run('zoom-fit');
});

// ---------------- 장비 설정 ----------------

function openDeviceDialog(): void {
  const dlg = $<HTMLDialogElement>('device-dialog');
  const form = dlg.querySelector('form')!;
  for (const [k, v] of Object.entries(device)) {
    const input = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
    if (!input) continue;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(v);
    else input.value = String(v);
  }
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const next = { ...device } as Record<string, unknown>;
    for (const k of Object.keys(device)) {
      const input = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
      if (!input) continue;
      const cur = (device as unknown as Record<string, unknown>)[k];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') next[k] = input.checked;
      else if (typeof cur === 'number') next[k] = Number(input.value) || cur;
      else next[k] = input.value;
    }
    device = next as unknown as DeviceSettings;
    saveDevice(device);
    view.zoomToFit();
    status('장비 설정을 저장했습니다');
  };
  dlg.showModal();
}

// ---------------- 레이저 제어 (GRBL / Ruida USB) ----------------

const btnConnect = $<HTMLButtonElement>('btn-connect');
const btnPause = $<HTMLButtonElement>('btn-pause');
let paused = false;

/** 현재 연결된 컨트롤러 종류 (연결 안 됐으면 null) */
const active = (): 'grbl' | 'ruida' | null => (grbl.connected ? 'grbl' : ruida.connected ? 'ruida' : null);

function refreshLaserButtons(): void {
  const c = active();
  btnConnect.textContent = c ? '연결 해제' : device.controller === 'ruida' ? '연결 (Ruida USB)' : '연결';
  for (const id of ['btn-start', 'btn-pause', 'btn-stop', 'btn-frame', 'btn-home']) $<HTMLButtonElement>(id).disabled = !c;
  // Ruida 는 원점 설정·알람 해제를 컨트롤러 패널에서 한다
  for (const id of ['btn-setorigin', 'btn-unlock']) $<HTMLButtonElement>(id).disabled = c !== 'grbl';
  btnPause.textContent = paused ? '⏵ 재개' : '⏸ 일시정지';
}

function showStatus(state: string, x: number, y: number, connected: boolean): void {
  const el = $('conn-state');
  el.textContent = state;
  el.className = `state ${state === 'Move' ? 'Jog' : state}`;
  $('conn-pos').textContent = connected ? `X ${x.toFixed(2)} Y ${y.toFixed(2)}` : '';
  view.headPos = connected ? { x, y } : null;
  view.requestRender();
  refreshLaserButtons();
}

grbl.onLine = (line, dir) => log(line, line.startsWith('error') || line.startsWith('ALARM') ? 'err' : dir);
grbl.onStatus = (s) => showStatus(s.state, s.x, s.y, grbl.connected);
grbl.onProgress = (p) => {
  $('job-progress').style.width = `${p.total ? (p.acked / p.total) * 100 : 0}%`;
};
ruida.onLine = (line, dir) => log(line, dir);
ruida.onStatus = (s) => showStatus(s.state, s.x, s.y, ruida.connected);
ruida.onProgress = (p) => {
  $('job-progress').style.width = `${p.total ? (p.sent / p.total) * 100 : 0}%`;
};

btnConnect.onclick = async () => {
  if (!GrblConnection.supported()) {
    status('이 브라우저는 Web Serial 을 지원하지 않습니다. Chrome 또는 Edge 를 사용하세요.');
    return;
  }
  try {
    if (grbl.connected) await grbl.disconnect();
    else if (ruida.connected) await ruida.disconnect();
    else if (device.controller === 'ruida') {
      await ruida.connect(device.baudRate, device.ruidaMagic);
      log(`Ruida USB 연결됨 (magic 0x${device.ruidaMagic.toString(16)})`);
    } else {
      await grbl.connect(device.baudRate);
      log(`연결됨 (${device.baudRate} baud)`);
    }
  } catch (e) {
    const err = e as Error;
    let hint = err.message;
    if (err.name === 'NotFoundError') {
      // 포트 선택 창을 제공하지 않는 내장 브라우저(Electron 등)에서는 선택 없이 바로 이 오류가 난다
      hint = /Electron|Claude\//.test(navigator.userAgent)
        ? '이 창(앱 내장 브라우저)은 USB 포트 선택을 지원하지 않습니다. Chrome 또는 Edge 에서 http://localhost:5173 을 여세요.'
        : '포트를 선택하지 않았습니다. 목록에 없으면 USB 케이블·드라이버(CH340/FTDI)를 확인하세요.';
    } else if (err.name === 'NetworkError' || err.name === 'InvalidStateError') {
      hint = '포트를 열 수 없습니다. LightBurn·RDWorks·LaserGRBL 등 다른 프로그램이 포트를 쓰고 있지 않은지 확인하세요.';
    }
    status(`연결 실패: ${hint}`, true);
    log(`[연결 실패] ${err.name}: ${err.message}`, 'err');
  }
  refreshLaserButtons();
};

const guard = (fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } catch (e) {
    status((e as Error).message);
    log((e as Error).message, 'err');
  }
};

$('btn-start').onclick = guard(async () => {
  const c = active();
  if (!c || grbl.busy || ruida.busy) return;
  const res = await buildJob();
  if (!res) return;
  const st = estimateJob(res.job, device.travelSpeed, fromMachine(device, 0, 0));
  if (!confirm(`작업을 시작할까요?\n예상 시간 ${formatDuration(st.seconds)}\n\n레이저 안전 수칙(보안경, 환기, 화재 감시)을 지키세요.`)) return;
  const t0 = Date.now();
  paused = false;
  if (c === 'grbl') {
    const gcode = jobToGcode(res.job, device, { comment: projectName });
    log(`작업 시작: ${gcode.split('\n').length} 줄`);
    await grbl.stream(gcode);
  } else {
    const plain = jobToRuidaPlain(res.job, device, { startProcess: true });
    log(`Ruida 작업 전송: ${plain.length} bytes`);
    await ruida.sendJob(plain);
    await ruida.waitJobDone();
  }
  log(`작업 종료 (${formatDuration((Date.now() - t0) / 1000)})`);
  status('작업 완료');
});
btnPause.onclick = guard(async () => {
  paused = !paused;
  if (active() === 'ruida') await (paused ? ruida.pause() : ruida.resume());
  else await (paused ? grbl.pause() : grbl.resume());
  refreshLaserButtons();
});
$('btn-stop').onclick = guard(async () => {
  paused = false;
  if (active() === 'ruida') {
    await ruida.stop();
    log('정지', 'err');
  } else {
    await grbl.stop();
    log('정지 (소프트 리셋)', 'err');
  }
  refreshLaserButtons();
});
$('btn-home').onclick = guard(() => (active() === 'ruida' ? ruida.home() : grbl.send('$H')));
$('btn-unlock').onclick = guard(() => grbl.send('$X'));
$('btn-setorigin').onclick = guard(() => grbl.send('G10 L20 P1 X0 Y0'));
$('btn-frame').onclick = guard(async () => {
  const res = await buildJob();
  if (!res) return;
  const b = jobBBox(res.job);
  const corners = [
    toMachine(device, b.minX, b.minY),
    toMachine(device, b.maxX, b.minY),
    toMachine(device, b.maxX, b.maxY),
    toMachine(device, b.minX, b.maxY),
  ];
  if (active() === 'ruida') {
    await ruida.frame(corners, device.travelSpeed);
    return;
  }
  const F = Math.round(device.travelSpeed * 60);
  const lines = ['G90 G21'];
  if (device.framePower > 0) {
    const S = Math.round((device.framePower / 100) * device.sMax);
    lines.push(`G0 X${corners[0].x.toFixed(3)} Y${corners[0].y.toFixed(3)}`, `M3 S${S}`);
    for (const c of [...corners.slice(1), corners[0]]) lines.push(`G1 X${c.x.toFixed(3)} Y${c.y.toFixed(3)} F${F}`);
    lines.push('M5');
  } else {
    for (const c of [...corners, corners[0]]) lines.push(`G0 X${c.x.toFixed(3)} Y${c.y.toFixed(3)}`);
  }
  await grbl.stream(lines.join('\n'));
});

document.querySelectorAll<HTMLButtonElement>('[data-jog]').forEach((b) => {
  b.onclick = guard(async () => {
    const c = active();
    if (!c) return;
    const step = Number($<HTMLInputElement>('jog-step').value) || 1;
    const speed = Number($<HTMLInputElement>('jog-speed').value) || 50; // mm/s
    const feed = speed * 60;
    if (b.dataset.jog === 'home') {
      await (c === 'ruida' ? ruida.moveTo(0, 0, speed) : grbl.send(`$J=G90 G21 X0 Y0 F${feed}`));
      return;
    }
    // 버튼 방향은 화면 기준(오른쪽 +, 위쪽 +) → 원점 위치에 따라 기계 축 방향으로 변환
    const [vx, vy] = b.dataset.jog!.split(',').map(Number);
    const dx = (device.origin.includes('right') ? -vx : vx) * step;
    const dy = (device.origin.includes('top') ? -vy : vy) * step;
    await (c === 'ruida' ? ruida.jog(dx, dy, speed) : grbl.jog(dx, dy, feed));
  });
});

const consoleInput = $<HTMLInputElement>('console-input');
consoleInput.onkeydown = (e) => {
  if (e.key !== 'Enter' || !consoleInput.value.trim()) return;
  const cmd = consoleInput.value.trim();
  consoleInput.value = '';
  if (!grbl.connected) {
    log(ruida.connected ? '콘솔 명령은 GRBL 에서만 지원합니다' : '연결되지 않았습니다', 'err');
    return;
  }
  guard(() => grbl.send(cmd))();
};

// ---------------- AI (MCP) 연결 ----------------

const AI_LABEL = { off: '🤖 AI 연결', connecting: '🤖 AI 대기 중…', connected: '🤖 AI 연결됨' } as const;
ai.onState = (s) => {
  const b = $<HTMLButtonElement>('btn-ai');
  b.textContent = AI_LABEL[s];
  b.classList.toggle('active', s === 'connected');
  if (s === 'connected') {
    log('[AI] MCP 서버와 연결됨 – Claude 가 그림을 그릴 수 있습니다');
    status('AI 연결됨');
  } else if (s === 'connecting') status('AI: MCP 서버 대기 중 (Claude 에서 laser-tool 도구를 쓰면 자동으로 연결됩니다)', true);
};
ai.onReplaced = () => {
  log('[AI] 다른 창(탭)이 AI 연결을 가져갔습니다. 이 창에서 쓰려면 [AI 연결] 을 다시 누르세요.', 'err');
  status('AI: 다른 창에서 연결 중 – 이 창은 연결을 해제했습니다', true);
};
ai.onCall = (method, ok, info) => log(`[AI] ${method}${ok ? '' : ` 실패: ${info}`}`, ok ? 'in' : 'err');

/** 사용자가 직접 켜고 끈 경우만 기억한다 (기본값: 켜짐) */
function rememberAi(on: boolean): void {
  try {
    localStorage.setItem('laser-tool.ai', on ? '1' : '0');
  } catch {
    /* 무시 */
  }
}
commands.ai = () => {
  const on = ai.state === 'off';
  if (on) ai.start();
  else ai.stop();
  rememberAi(on);
};
let aiAuto = true;
try {
  aiAuto = localStorage.getItem('laser-tool.ai') !== '0';
} catch {
  /* 무시 */
}
if (aiAuto) ai.start();

// ---------------- 시작 ----------------

renderPalette();
refreshNumeric();
refreshLaserButtons();
requestAnimationFrame(() => view.zoomToFit());
status('준비됨 – SVG/DXF/이미지를 끌어다 놓거나 도구로 그려보세요', true);
log('Laser Tool v0.1 – GRBL / Ruida (USB: Chrome·Edge Web Serial)');

// 디버깅용
(window as unknown as { laser: unknown }).laser = { doc, view, grbl, ruida, layerColor };
