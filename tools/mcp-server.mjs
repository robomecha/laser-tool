#!/usr/bin/env node
// Laser Tool MCP 서버: Claude 등 MCP 클라이언트가 브라우저에서 실행 중인 Laser Tool 에 그림을 그리게 한다.
//
//   Claude ──MCP(stdio)──▶ 이 서버 ──WebSocket(127.0.0.1:5174)──▶ 브라우저 Laser Tool ([AI 연결] 버튼)
//
// 안전: 레이저 실행(시작/프레임/조그)은 MCP 로 제공하지 않는다. 가공은 사람이 앱에서 직접 시작한다.
// stdout 은 MCP 통신 전용이므로 로그는 stderr 로만 쓴다.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

const PORT = Number(process.env.LASER_MCP_PORT || 5174);
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const TIMEOUT_MS = 30000;
const log = (...a) => console.error('[laser-mcp]', ...a);

// ---------------- 브라우저 브리지 ----------------

let client = null;
let bridgeError = null;
let nextId = 1;
const pending = new Map();

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('listening', () => log(`브라우저 연결 대기: ws://127.0.0.1:${PORT}`));
wss.on('error', (e) => {
  bridgeError = e.code === 'EADDRINUSE' ? `포트 ${PORT} 를 다른 프로그램(또는 다른 MCP 서버 인스턴스)이 쓰고 있습니다. LASER_MCP_PORT 로 바꾸세요.` : e.message;
  log(bridgeError);
});
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGIN.test(origin)) {
    log(`거부된 연결 (origin: ${origin || '없음'})`);
    ws.close(1008, 'origin not allowed');
    return;
  }
  if (client) client.close(1000, 'replaced');
  client = ws;
  log(`브라우저 연결됨 (${origin})`);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  });
  ws.on('close', () => {
    if (client === ws) client = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('브라우저 연결이 끊어졌습니다'));
      pending.delete(id);
    }
    log('브라우저 연결 끊김');
  });
});

function call(method, params = {}) {
  if (bridgeError) return Promise.reject(new Error(bridgeError));
  if (!client || client.readyState !== 1) {
    return Promise.reject(
      new Error('Laser Tool 브라우저가 연결되지 않았습니다. 브라우저에서 http://localhost:5173 을 열고 상단의 [AI 연결] 버튼을 누르세요.'),
    );
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('브라우저 응답 시간 초과'));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    client.send(JSON.stringify({ id, method, params }));
  });
}

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `오류: ${e.message}` }], isError: true });

/** 브라우저 메서드를 그대로 호출하는 도구 등록 */
function tool(name, description, inputSchema, method = name) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return text(await call(method, args ?? {}));
    } catch (e) {
      return fail(e);
    }
  });
}

// ---------------- MCP 도구 ----------------

const server = new McpServer(
  { name: 'laser-tool', version: '0.1.0' },
  {
    instructions: [
      'Laser Tool(레이저 커팅/각인 편집기)을 조작한다. 좌표 단위는 mm, 작업대 왼쪽 위가 (0,0)이고 Y 는 아래로 증가한다.',
      '도형은 색상 레이어(0~29)에 속하고 레이어마다 가공 모드가 있다: line=선 따라 절단, fill=닫힌 도형 내부 스캔 각인, image=비트맵 각인.',
      '작업 순서: get_canvas_info 로 작업대 크기 확인 → draw_shapes / add_text / import_svg 로 그리기 → set_layer 로 가공 설정 → snapshot 으로 결과 확인 후 수정.',
      '복잡한 그림(일러스트, 패턴, 로고)은 SVG 를 작성해 import_svg 로 넣는 것이 편하다. 각인할 면은 닫힌 도형으로 만들고 fill 레이어에 둔다.',
      '레이저 가공 시작은 사용자가 앱에서 직접 한다. 끝나면 사용자에게 미리보기(P)로 확인 후 시작하라고 안내한다.',
    ].join('\n'),
  },
);

const layer = z.number().int().min(0).max(29).optional().describe('색상 레이어 0~29 (생략 시 현재 레이어)');
const pt = z.tuple([z.number(), z.number()]);
const common = { layer, name: z.string().optional() };
const shapeSpec = z.discriminatedUnion('type', [
  z.object({ type: z.literal('line'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), ...common }),
  z.object({ type: z.literal('polyline'), points: z.array(pt).min(2), closed: z.boolean().optional(), ...common }),
  z.object({ type: z.literal('rect'), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), radius: z.number().min(0).optional().describe('모서리 둥글기 mm'), ...common }),
  z.object({ type: z.literal('circle'), cx: z.number(), cy: z.number(), r: z.number().positive(), ...common }),
  z.object({ type: z.literal('ellipse'), cx: z.number(), cy: z.number(), rx: z.number().positive(), ry: z.number().positive(), ...common }),
  z.object({ type: z.literal('path'), d: z.string().describe('SVG path 데이터, mm 단위 문서 좌표'), ...common }),
]);
const ids = z.array(z.string()).min(1).describe('도형 id 목록 (list_shapes / draw 결과에서 얻음)');

tool('get_canvas_info', '작업대 크기, 원점, 사용 중 레이어와 설정, 도형 수, 팔레트 색, 사용 가능한 글꼴을 돌려준다.', {});

tool(
  'draw_shapes',
  '도형을 그린다 (선, 폴리라인/다각형, 사각형, 원, 타원, SVG path). 만든 도형 id 를 돌려준다.',
  { shapes: z.array(shapeSpec).min(1) },
);

tool(
  'add_text',
  '텍스트를 글꼴 윤곽선 경로로 변환해 추가한다 (한글 지원 나눔고딕 기본).',
  {
    text: z.string().min(1).describe('줄바꿈은 \\n'),
    x: z.number(),
    y: z.number(),
    size: z.number().positive().describe('글자 크기 mm (em 높이)'),
    anchor: z.enum(['top-left', 'center', 'baseline-left']).optional().describe('x,y 기준점 (기본 top-left: 글자 영역 왼쪽 위)'),
    align: z.enum(['left', 'center', 'right']).optional(),
    letterSpacing: z.number().optional().describe('자간 (em 비율)'),
    lineHeight: z.number().positive().optional(),
    font: z.number().int().min(0).optional().describe('get_canvas_info 의 fonts 인덱스'),
    layer,
  },
);

tool(
  'import_svg',
  'SVG 문서를 가져온다. 선 색은 가장 가까운 팔레트 레이어로 배정되며 layer 를 주면 모두 그 레이어로. x/y/width/height 를 주면 그 영역에 비율 유지로 맞춘다.',
  {
    svg: z.string().min(10).describe('완전한 <svg ...>...</svg> 문서. width/height 에 mm 단위를 쓰면 실제 크기가 된다'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    layer,
  },
);

tool('list_shapes', '모든 도형의 id, 이름, 종류, 레이어, 범위(bbox mm)를 돌려준다.', {});

tool(
  'transform_shapes',
  '도형을 이동/크기 변경/회전/반전한다. 여러 옵션을 주면 scale → rotate → mirror → 이동 순으로 선택 영역 중심 기준 적용.',
  {
    ids,
    dx: z.number().optional(),
    dy: z.number().optional(),
    scale: z.number().positive().optional().describe('균일 배율'),
    width: z.number().positive().optional().describe('선택 영역 폭을 이 값(mm)으로 (비율 유지, height 와 함께 주면 각각)'),
    height: z.number().positive().optional(),
    rotate: z.number().optional().describe('시계 방향 각도(deg)'),
    mirror: z.enum(['horizontal', 'vertical']).optional(),
    moveTo: z.object({ x: z.number(), y: z.number() }).optional().describe('선택 영역 왼쪽 위를 이 위치로'),
    centerAt: z.object({ x: z.number(), y: z.number() }).optional().describe('선택 영역 중심을 이 위치로'),
  },
);

tool('delete_shapes', '도형을 삭제한다. all=true 면 전부 삭제.', { ids: z.array(z.string()).optional(), all: z.boolean().optional() });

tool('set_shape_layer', '도형을 다른 색상 레이어로 옮긴다.', { ids, layer: z.number().int().min(0).max(29) });

tool(
  'set_layer',
  '레이어 가공 설정을 바꾼다.',
  {
    layer: z.number().int().min(0).max(29),
    name: z.string().optional(),
    mode: z.enum(['line', 'fill', 'image']).optional().describe('line=절단(선), fill=내부 스캔 각인, image=비트맵 각인'),
    speed: z.number().positive().optional().describe('mm/s'),
    power: z.number().min(0).max(100).optional().describe('최대 출력 %'),
    minPower: z.number().min(0).max(100).optional(),
    passes: z.number().int().min(1).max(50).optional(),
    interval: z.number().positive().optional().describe('fill/image 라인 간격 mm'),
    angle: z.number().optional().describe('fill 스캔 각도 deg'),
    dither: z.enum(['floyd', 'atkinson', 'threshold', 'grayscale']).optional(),
    output: z.boolean().optional().describe('false 면 출력 안 함 (가이드선 등)'),
  },
);

tool(
  'offset_shapes',
  '도형의 오프셋(평행 윤곽)을 새 도형으로 만든다. 양수=바깥, 음수=안쪽.',
  { ids, distance: z.number(), join: z.enum(['round', 'miter', 'square']).optional() },
);

tool(
  'boolean_shapes',
  '닫힌 도형들을 합치기/빼기/교집합/배타적합 하여 하나로 바꾼다. difference 는 ids[0] 에서 나머지를 뺀다.',
  { ids: z.array(z.string()).min(2), op: z.enum(['union', 'difference', 'intersection', 'xor']) },
);

tool('preview_job', '가공 경로를 계산해 예상 시간, 가공/공이동 거리, 경고를 돌려준다 (레이저는 움직이지 않음).', {});

tool('undo', '마지막 편집을 실행 취소한다.', {});

server.registerTool(
  'snapshot',
  {
    description: '현재 작업대와 도형을 PNG 이미지로 돌려준다. 그린 결과를 눈으로 확인할 때 사용.',
    inputSchema: {
      width: z.number().int().min(200).max(2000).optional().describe('이미지 폭 px (기본 900)'),
      region: z.enum(['bed', 'shapes']).optional().describe('bed=작업대 전체(기본), shapes=도형 영역 확대'),
    },
  },
  async (args) => {
    try {
      const r = await call('snapshot', args ?? {});
      return {
        content: [
          { type: 'image', data: r.png, mimeType: 'image/png' },
          { type: 'text', text: r.caption },
        ],
      };
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
log('MCP 서버 시작');
