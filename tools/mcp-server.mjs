#!/usr/bin/env node
// Laser Tool MCP 서버: Claude 등 MCP 클라이언트가 브라우저에서 실행 중인 Laser Tool 에 그림을 그리게 한다.
//
//   Claude ──MCP(stdio)──▶ 이 서버 ──WebSocket(127.0.0.1:47801)──▶ 브라우저 Laser Tool ([AI 연결] 버튼)
//
// 안전: 레이저 실행(시작/프레임/조그)은 MCP 로 제공하지 않는다. 가공은 사람이 앱에서 직접 시작한다.
// stdout 은 MCP 통신 전용이므로 로그는 stderr 로만 쓴다.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { INSTRUCTIONS, TOOL_DEFS } from '../src/ai/tool-defs.ts';

const PORT = Number(process.env.LASER_MCP_PORT || 47801);
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const TIMEOUT_MS = 30000;
const log = (...a) => console.error('[laser-mcp]', ...a);

// ---------------- 브라우저 브리지 ----------------
//
// 첫 번째로 뜬 서버가 포트를 잡고(허브) 브라우저와 연결한다. Claude Desktop 과 Claude Code 처럼
// 여러 클라이언트가 각자 이 서버를 띄우면, 나중 서버는 포트가 사용 중이므로 허브에 접속해
// 요청을 넘기는 중계(relay) 모드로 동작한다. 허브가 종료되면 중계 서버가 허브 역할을 이어받는다.

let client = null; // 허브: 브라우저 연결
let relay = null; // 중계: 허브로 가는 연결
let bridgeError = null;
let nextId = 1;
const pending = new Map();
const RELAY_HEADER = 'x-laser-relay';

function settle(msg) {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.error) p.reject(new Error(msg.error));
  else p.resolve(msg.result);
}

function rejectAll(reason) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
}

function send(ws, method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('브라우저 응답 시간 초과'));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const NOT_CONNECTED =
  'Laser Tool 브라우저가 연결되지 않았습니다. 브라우저에서 http://localhost:5173 을 열고 상단의 [AI 연결] 버튼을 누르세요.';

function callBrowser(method, params) {
  if (!client || client.readyState !== 1) return Promise.reject(new Error(NOT_CONNECTED));
  return send(client, method, params);
}

async function call(method, params = {}) {
  if (relay && relay.readyState === 1) return send(relay, method, params);
  if (bridgeError) throw new Error(bridgeError);
  if (!client || client.readyState !== 1) {
    // 앱이 꺼져 있으면 띄우고, 열려 있는 탭이 자동으로 다시 붙을 시간을 준다
    await ensureApp();
    if (!(await waitBrowser(3000))) {
      throw new Error(`Laser Tool 앱(${APP_URL})이 브라우저에 열려 있지 않습니다. open_app 도구로 브라우저에 열거나, 사용자에게 ${APP_URL} 을 열어 달라고 하세요.`);
    }
  }
  return callBrowser(method, params);
}

function serveRelay(ws) {
  log('다른 laser-tool MCP 서버가 중계로 연결됨');
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      ws.send(JSON.stringify({ id: msg.id, result: await callBrowser(msg.method, msg.params ?? {}) }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, error: e.message }));
    }
  });
}

function startHub() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
  wss.on('listening', () => {
    bridgeError = null;
    log(`브라우저 연결 대기: ws://127.0.0.1:${PORT}`);
  });
  wss.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      startRelay();
    } else {
      bridgeError = e.message;
      log(bridgeError);
    }
  });
  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin || '';
    if (!ALLOWED_ORIGIN.test(origin)) {
      log(`거부된 연결 (origin: ${origin || '없음'})`);
      ws.close(1008, 'origin not allowed');
      return;
    }
    if (req.headers[RELAY_HEADER] === '1') {
      serveRelay(ws);
      return;
    }
    if (client) client.close(1000, 'replaced');
    client = ws;
    // 브라우저가 다른 서비스가 아닌 이 서버에 붙었음을 확인할 수 있도록 인사 메시지를 먼저 보낸다
    ws.send(JSON.stringify({ hello: 'laser-tool-mcp', version: 1 }));
    log(`브라우저 연결됨 (${origin})`);
    ws.on('message', (raw) => {
      try {
        settle(JSON.parse(raw.toString()));
      } catch {
        /* 무시 */
      }
    });
    ws.on('close', () => {
      if (client === ws) client = null;
      rejectAll('브라우저 연결이 끊어졌습니다');
      log('브라우저 연결 끊김');
    });
  });
}

function startRelay() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { origin: 'http://localhost', [RELAY_HEADER]: '1' } });
  let opened = false;
  ws.on('open', () => {
    opened = true;
    relay = ws;
    bridgeError = null;
    log(`이미 실행 중인 laser-tool MCP 서버(포트 ${PORT})를 통해 중계합니다`);
  });
  ws.on('message', (raw) => {
    try {
      settle(JSON.parse(raw.toString()));
    } catch {
      /* 무시 */
    }
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (relay === ws) relay = null;
    rejectAll('중계 연결이 끊어졌습니다. 다시 시도하세요.');
    if (!opened) bridgeError = `포트 ${PORT} 를 다른 프로그램이 쓰고 있습니다. LASER_MCP_PORT 로 바꾸세요.`;
    // 허브가 사라졌으면 이 서버가 허브가 된다 (아니면 다시 중계)
    setTimeout(startHub, 1000);
  });
}

startHub();

// ---------------- 앱(Vite 개발 서버) 자동 실행 ----------------

const APP_URL = process.env.LASER_APP_URL || 'http://localhost:5173';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function appUp() {
  try {
    const r = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let starting = null;
/** 앱 서버가 꺼져 있으면 백그라운드로 띄운다 (`npm run dev` 와 같음). 이 MCP 서버가 끝나도 계속 실행된다 */
function ensureApp() {
  starting ??= (async () => {
    if (await appUp()) return 'running';
    const port = new URL(APP_URL).port || '5173';
    const vite = join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite, '--port', port, '--strictPort'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log(`앱 서버 시작: ${APP_URL} (pid ${child.pid})`);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await appUp()) return 'started';
    }
    throw new Error(`앱 서버(${APP_URL})를 시작하지 못했습니다. 프로젝트 폴더에서 npm run dev 를 실행해 보세요.`);
  })().finally(() => {
    starting = null;
  });
  return starting;
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function waitBrowser(ms) {
  for (let t = 0; t < ms; t += 250) {
    if ((client && client.readyState === 1) || (relay && relay.readyState === 1)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `오류: ${e.message}` }], isError: true });

// ---------------- MCP 도구 (정의는 src/ai/tool-defs.ts 에서 앱 대화창과 공유) ----------------

const server = new McpServer(
  { name: 'laser-tool', version: '0.1.0' },
  { instructions: ['앱이 열려 있지 않다는 오류가 나면 open_app 을 먼저 호출한다.', ...INSTRUCTIONS].join('\n') },
);

server.registerTool(
  'open_app',
  {
    description: 'Laser Tool 앱을 준비한다: 앱 서버가 꺼져 있으면 시작하고, 브라우저에 열려 있지 않으면 기본 브라우저로 연다. 다른 도구가 "브라우저에 열려 있지 않습니다" 오류를 내면 호출.',
    inputSchema: {},
  },
  async () => {
    try {
      const app = await ensureApp();
      if (await waitBrowser(500)) return text({ url: APP_URL, app, browser: '이미 연결됨' });
      openInBrowser(APP_URL);
      const ok = await waitBrowser(20000);
      return text({
        url: APP_URL,
        app,
        browser: ok ? '브라우저를 열고 연결됨' : '브라우저를 열었지만 아직 연결되지 않음 – 사용자에게 상단 [AI 연결] 버튼을 눌러 달라고 하세요',
      });
    } catch (e) {
      return fail(e);
    }
  },
);

for (const t of TOOL_DEFS) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, async (args) => {
    try {
      const r = await call(t.name, args ?? {});
      if (!t.image) return text(r);
      return {
        content: [
          { type: 'image', data: r.png, mimeType: 'image/png' },
          { type: 'text', text: r.caption },
        ],
      };
    } catch (e) {
      return fail(e);
    }
  });
}

await server.connect(new StdioServerTransport());
log('MCP 서버 시작');
