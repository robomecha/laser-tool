// Laser Tool MCP 서버: Claude 등 MCP 클라이언트가 브라우저에서 실행 중인 Laser Tool 에 그림을 그리게 한다.
//
//   Claude ──MCP(stdio)──▶ 이 서버 ──WebSocket(127.0.0.1:47801)──▶ 브라우저 Laser Tool (로컬 앱 · exe · 웹 버전)
//
// AI 사용량은 이 서버를 실행한 사용자의 MCP 클라이언트(예: Claude Desktop 구독)에서 나간다.
// 안전: 레이저 실행(시작/프레임/조그)은 MCP 로 제공하지 않는다. 가공은 사람이 앱에서 직접 시작한다.
// stdout 은 MCP 통신 전용이므로 로그는 stderr 로만 쓴다.
//
// 실행: node tools/mcp-server.mjs (개발용, Vite 앱) · LaserTool.exe --mcp (exe 앱)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocket, WebSocketServer } from 'ws';
import { INSTRUCTIONS, TOOL_DEFS } from '../src/ai/tool-defs.ts';

/** 앱이 꺼져 있을 때 띄우는 방법 (개발 서버 / exe) */
export interface AppLauncher {
  /** 사용자에게 안내할 앱 주소 */
  url: string;
  /** 앱이 떠 있게 한다. 'running' | 'started' */
  ensure(): Promise<string>;
  /** 앱 창(브라우저)을 연다 */
  open(): void;
}

const PORT = Number(process.env.LASER_MCP_PORT || 47801);
const TIMEOUT_MS = 30000;
const RELAY_HEADER = 'x-laser-relay';
const log = (...a: unknown[]) => console.error('[laser-mcp]', ...a);

/** 연결을 허용하는 페이지 주소: 내 PC(localhost) 와 공식 웹 버전, LASER_MCP_ORIGINS 로 추가 */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const WEB_ORIGINS = new Set(['https://robomecha.github.io', ...(process.env.LASER_MCP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
export const originAllowed = (o: string): boolean => LOCAL_ORIGIN.test(o) || WEB_ORIGINS.has(o);

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export async function runMcp(app: AppLauncher): Promise<void> {
  // ---------------- 브라우저 브리지 ----------------
  //
  // 첫 번째로 뜬 서버가 포트를 잡고(허브) 브라우저와 연결한다. Claude Desktop 과 Claude Code 처럼
  // 여러 클라이언트가 각자 이 서버를 띄우면, 나중 서버는 포트가 사용 중이므로 허브에 접속해
  // 요청을 넘기는 중계(relay) 모드로 동작한다. 허브가 종료되면 중계 서버가 허브 역할을 이어받는다.
  let client: WebSocket | null = null; // 허브: 브라우저 연결
  let relay: WebSocket | null = null; // 중계: 허브로 가는 연결
  let bridgeError: string | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const settle = (msg: { id: number; result?: unknown; error?: string }) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  };
  const rejectAll = (reason: string) => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      pending.delete(id);
    }
  };
  const send = (ws: WebSocket, method: string, params: unknown) => {
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('브라우저 응답 시간 초과'));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const NOT_CONNECTED = `Laser Tool 이 연결되지 않았습니다. ${app.url} (또는 웹 버전)을 열고 상단의 [AI 연결] 을 켜세요.`;
  const callBrowser = (method: string, params: unknown) => {
    if (!client || client.readyState !== 1) return Promise.reject(new Error(NOT_CONNECTED));
    return send(client, method, params);
  };
  const waitBrowser = async (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      if ((client && client.readyState === 1) || (relay && relay.readyState === 1)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  const call = async (method: string, params: unknown = {}) => {
    if (relay && relay.readyState === 1) return send(relay, method, params);
    if (bridgeError) throw new Error(bridgeError);
    if (!client || client.readyState !== 1) {
      // 앱이 꺼져 있으면 띄우고, 열려 있는 탭이 자동으로 다시 붙을 시간을 준다
      await app.ensure();
      if (!(await waitBrowser(3000))) {
        throw new Error(`Laser Tool 앱(${app.url})이 열려 있지 않습니다. open_app 도구로 열거나, 사용자에게 앱을 열고 [AI 연결] 을 켜 달라고 하세요.`);
      }
    }
    return callBrowser(method, params);
  };

  const serveRelay = (ws: WebSocket) => {
    log('다른 laser-tool MCP 서버가 중계로 연결됨');
    ws.on('message', async (raw) => {
      let msg: { id: number; method: string; params?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        ws.send(JSON.stringify({ id: msg.id, result: await callBrowser(msg.method, msg.params ?? {}) }));
      } catch (e) {
        ws.send(JSON.stringify({ id: msg.id, error: (e as Error).message }));
      }
    });
  };

  const startHub = () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
    wss.on('listening', () => {
      bridgeError = null;
      log(`브라우저 연결 대기: ws://127.0.0.1:${PORT}`);
    });
    wss.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') startRelay();
      else {
        bridgeError = e.message;
        log(bridgeError);
      }
    });
    wss.on('connection', (ws, req) => {
      const origin = req.headers.origin || '';
      if (!originAllowed(origin)) {
        log(`거부된 연결 (origin: ${origin || '없음'})`);
        ws.close(1008, 'origin not allowed');
        return;
      }
      if (req.headers[RELAY_HEADER] === '1') return serveRelay(ws);
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
  };

  const startRelay = () => {
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
  };

  startHub();

  // ---------------- MCP 도구 (정의는 src/ai/tool-defs.ts 에서 앱 대화창과 공유) ----------------

  const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
  const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `오류: ${(e as Error).message}` }], isError: true });

  const server = new McpServer(
    { name: 'laser-tool', version: '0.1.0' },
    { instructions: ['앱이 열려 있지 않다는 오류가 나면 open_app 을 먼저 호출한다.', ...INSTRUCTIONS].join('\n') },
  );

  server.registerTool(
    'open_app',
    {
      description: 'Laser Tool 앱을 준비한다: 꺼져 있으면 시작하고 앱 창을 연다. 다른 도구가 "열려 있지 않습니다" 오류를 내면 호출.',
      inputSchema: {},
    },
    async () => {
      try {
        const state = await app.ensure();
        // 방금 시작했다면 앱이 스스로 창을 연다: 그 창이 연결될 때까지 기다린다
        if (await waitBrowser(state === 'started' ? 15000 : 500)) return text({ url: app.url, app: state, browser: '연결됨' });
        app.open();
        const ok = await waitBrowser(20000);
        return text({
          url: app.url,
          app: state,
          browser: ok ? '앱 창을 열고 연결됨' : '앱 창을 열었지만 아직 연결되지 않음 – 사용자에게 상단 [AI 연결] 을 켜 달라고 하세요',
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  for (const t of TOOL_DEFS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, async (args: unknown) => {
      try {
        const r = (await call(t.name, args ?? {})) as { png: string; caption: string };
        if (!t.image) return text(r);
        return {
          content: [
            { type: 'image' as const, data: r.png, mimeType: 'image/png' },
            { type: 'text' as const, text: r.caption },
          ],
        };
      } catch (e) {
        return fail(e);
      }
    });
  }

  await server.connect(new StdioServerTransport());
  log('MCP 서버 시작');
}
