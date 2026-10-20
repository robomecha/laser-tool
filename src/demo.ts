// 소개용 예제 화면: 주소에 ?demo=1 (편집) / 2 (가공 미리보기) / 3 (AI 대화) 를 붙이면 예제 작품을 그린다.
// docs/images 의 화면 이미지를 만들 때 쓴다 (tools/screenshots.mjs).
import { circularArray, gridArray } from './core/array';
import { LaserDocument } from './core/document';
import { ellipsePolyline, Polyline, rectPolyline, regularPolygon, translate, uprightRotation, Vec } from './core/geometry';
import { makeVector, Shape, VectorShape } from './core/shapes';
import type { ChatPanel } from './ai/chat';
import type { CanvasView } from './ui/canvas-view';
import type { TextTool } from './ui/text-tool';

export interface DemoContext {
  doc: LaserDocument;
  view: CanvasView;
  textTool: TextTool;
  chat: ChatPanel;
  run: (cmd: string) => void | Promise<void>;
}

const roundRect = (x: number, y: number, w: number, h: number, r: number): Polyline => {
  const pts: Vec[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return { pts, closed: true };
};

async function text(ctx: DemoContext, content: string, x: number, y: number, size: number, layer: number, opts: { bold?: boolean; align?: 'left' | 'center' } = {}): Promise<VectorShape> {
  const req = { size, bold: opts.bold, align: opts.align ?? 'center' };
  const paths = await ctx.textTool.makeTextPaths(content, req);
  const s = makeVector(paths, layer, `Text "${content}"`, translate(x, y));
  s.text = ctx.textTool.metaFromRequest(content, req);
  return s;
}

async function pathText(ctx: DemoContext, content: string, line: Polyline, size: number, layer: number, position: number, side: 'above' | 'below' = 'above', reverse = false): Promise<VectorShape> {
  const req = { size, bold: true, position, side, reverse, offset: 0 };
  const paths = await ctx.textTool.makePathTextPaths(content, line, req);
  const s = makeVector(paths, layer, `Text "${content}"`);
  s.text = ctx.textTool.metaFromRequest(content, req, { line, position, side, reverse, offset: 0 });
  return s;
}

/** 원형 코스터 + 육각형 배열 + 별 원형 배열 + 이름표 */
async function buildProject(ctx: DemoContext): Promise<Shape[]> {
  const { doc } = ctx;
  const shapes: Shape[] = [];
  // 레이어: 1 파랑 = 채우기 각인, 2 빨강 = 절단, 3 초록 = 라인 각인, 5 주황 = 채우기
  doc.updateLayer(1, { name: '각인', mode: 'fill', speed: 250, power: 25, interval: 0.1 });
  doc.updateLayer(2, { name: '절단', mode: 'line', speed: 12, power: 80, passes: 2 });
  doc.updateLayer(3, { name: '라인', mode: 'line', speed: 80, power: 20 });
  doc.updateLayer(5, { name: '별', mode: 'fill', speed: 300, power: 30, interval: 0.1 });

  // 원형 코스터 (지름 90mm)
  const cx = 85;
  const cy = 110;
  shapes.push(makeVector([ellipsePolyline(cx, cy, 45, 45)], 2, '코스터 외곽'));
  shapes.push(makeVector([ellipsePolyline(cx, cy, 39, 39)], 3, '안쪽 테두리'));
  const ring = ellipsePolyline(cx, cy, 31, 31);
  shapes.push(await pathText(ctx, 'LASER · TOOL · CAFE', ring, 6, 1, 75));
  shapes.push(await pathText(ctx, 'SINCE 2026', ring, 5, 1, 25, 'below', true));
  shapes.push(await text(ctx, '커피', cx, cy + 6, 18, 1, { bold: true }));
  shapes.push(makeVector([regularPolygon(cx, cy - 16, 5, 5, -Math.PI / 2, 0.45)], 5, '별'));

  // 육각형 격자 배열
  const hex = makeVector([regularPolygon(175, 55, 14, 6, uprightRotation(6))], 3, '육각형');
  shapes.push(hex, ...gridArray([hex], { columns: 4, rows: 2, spacingX: 4, spacingY: 4, spacing: 'gap' }));

  // 별 원형 배열
  const star = makeVector([regularPolygon(300, 150, 9, 5, -Math.PI / 2, 0.45)], 5, '별');
  shapes.push(star, ...circularArray([star], { count: 8, center: { x: 300, y: 185 }, totalAngle: 360, rotateCopies: true }));
  shapes.push(makeVector([ellipsePolyline(300, 185, 12, 12)], 2, '가운데 원'));

  // 이름표
  shapes.push(makeVector([roundRect(150, 205, 95, 50, 8)], 2, '이름표'));
  shapes.push(makeVector([ellipsePolyline(162, 217, 3, 3)], 2, '끈 구멍'));
  shapes.push(await text(ctx, '홍길동', 197.5, 238, 15, 1, { bold: true }));
  shapes.push(makeVector([rectPolyline(160, 245, 75, 0.01)], 3, '밑줄'));
  return shapes;
}

export async function runDemo(ctx: DemoContext, scene: number): Promise<void> {
  const { doc, view } = ctx;
  doc.load([], []);
  const shapes = await buildProject(ctx);
  doc.add(shapes, false);
  view.zoomToFit();

  if (scene === 1) {
    // 이름표를 선택해 핸들·크기 표시가 보이게
    const t = shapes.find((s) => s.name === '이름표');
    if (t) doc.select([t.id]);
    doc.currentLayer = 1;
  } else if (scene === 2) {
    await ctx.run('preview');
    const slider = document.getElementById('preview-slider') as HTMLInputElement;
    slider.value = '720';
    slider.dispatchEvent(new Event('input'));
  } else if (scene === 3) {
    ctx.chat.toggle(true);
    // 예제 화면에서는 API 키 안내를 숨긴다 (키 확인이 끝난 뒤)
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector<HTMLElement>('#chat-panel .chat-note')!.hidden = true;
    const say = (cls: string, msg: string) => ctx.chat.showMessage(cls, msg);
    say('user', '지름 90mm 원형 코스터 만들어 줘. 가운데 "커피"는 채우기로 새기고 테두리를 따라 가게 이름도 넣어 줘.');
    say('assistant', '코스터를 그릴게요.');
    say('tool', '🔧 작업대 확인 ✓');
    say('tool', '🔧 도형 그리기 ✓');
    say('tool', '🔧 곡선 따라 쓰기 ✓');
    say('tool', '🔧 텍스트 추가 ✓');
    say('tool', '🔧 레이어 설정 ✓');
    say('tool', '🔧 결과 확인 ✓');
    say(
      'assistant',
      '완성했습니다.\n• 빨간 원(C02): 절단, 2회 반복\n• 파란 글자(C01): 채우기 각인 250mm/s · 25%\n• 위쪽 "LASER · TOOL · CAFE", 아래쪽 "SINCE 2026"\n미리보기(P)로 확인한 뒤 시작하세요. 크기나 글꼴을 바꾸고 싶으면 말씀해 주세요.',
    );
  }
}
