// LaserTool.exe 의 본체: 앱 파일을 내장 서버로 제공하고 Chrome/Edge 앱 창을 연다.
//
// - 앱 파일(dist/)은 Node 단일 실행 파일(SEA) 의 asset 으로 들어 있다. 개발 중 `node build/launcher.cjs` 로
//   실행하면 프로젝트의 dist/ 폴더를 쓴다.
// - 127.0.0.1 에서만 열리며 /api/chat 은 개발 서버와 같은 처리기를 쓴다.
//   API 키: exe 옆 laser-tool.env (또는 환경 변수 ANTHROPIC_API_KEY)
// - 앱 창이 5초마다 /__ping 을 보낸다. 창을 모두 닫아 신호가 끊기면 서버도 종료한다.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { handleChat } from './chat-handler';

const APP_NAME = 'LaserTool';
const PORTS = [47810, 47811, 47812, 47813];
const IDLE_EXIT_MS = 20_000;
const FIRST_PING_MS = 90_000;

// ---------------- 파일 제공 ----------------

type Sea = { isSea(): boolean; getAsset(key: string): ArrayBuffer };
let sea: Sea | null = null;
try {
  const s = require('node:sea') as Sea;
  if (s.isSea()) sea = s;
} catch {
  /* 일반 node 로 실행 */
}

const exeDir = sea ? dirname(process.execPath) : resolve(__dirname, '..');
const dataDir = join(process.env.LOCALAPPDATA || exeDir, APP_NAME);
mkdirSync(dataDir, { recursive: true });
const logFile = join(dataDir, 'log.txt');
const log = (...a: unknown[]) => {
  const line = `[${new Date().toISOString()}] ${a.map(String).join(' ')}\n`;
  try {
    appendFileSync(logFile, line);
  } catch {
    /* 무시 */
  }
  if (!sea) process.stdout.write(line);
};

const files = new Map<string, Buffer>();
function loadFiles(): void {
  if (sea) {
    const manifest = JSON.parse(Buffer.from(sea.getAsset('manifest.json')).toString('utf8')) as string[];
    for (const p of manifest) files.set(p, Buffer.from(sea.getAsset(`dist/${p}`)));
  } else {
    const dist = join(exeDir, 'dist');
    const walk = (dir: string, rel = '') => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const r = rel ? `${rel}/${name}` : name;
        if (statSync(full).isDirectory()) walk(full, r);
        else files.set(r, readFileSync(full));
      }
    };
    if (!existsSync(dist)) throw new Error('dist 폴더가 없습니다. 먼저 npm run build 를 실행하세요.');
    walk(dist);
  }
  log(`앱 파일 ${files.size}개`);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

// ---------------- API 키 ----------------

function loadEnvFile(): void {
  for (const f of [join(exeDir, 'laser-tool.env'), join(exeDir, '.env.local')]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1].startsWith('ANTHROPIC_') && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    log(`설정 파일 읽음: ${f}`);
  }
}

const MISSING_KEY =
  'Claude API 키가 설정되지 않았습니다. 키 없이 쓰려면 Claude Desktop 채팅에서 "laser-tool 로 ... 만들어 줘" 라고 요청하세요. 키를 쓰려면 LaserTool.exe 옆에 laser-tool.env 파일을 만들고 ANTHROPIC_API_KEY=키 를 넣은 뒤 프로그램을 다시 실행하세요.';

// ---------------- 서버 ----------------

let lastPing = 0;
const started = Date.now();

function serve(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/__ping') {
    lastPing = Date.now();
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (url.pathname === '/__laser-tool') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(APP_NAME);
    return;
  }
  if (url.pathname.startsWith('/api/chat')) {
    void handleChat(req, res, MISSING_KEY);
    return;
  }
  let p = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!p || !files.has(p)) p = p.includes('.') ? p : 'index.html';
  const body = files.get(p);
  if (!body) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(p).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': p === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(body);
}

/** 이미 같은 프로그램이 떠 있는지 */
async function isOurs(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/__laser-tool`, { signal: AbortSignal.timeout(1000) });
    return r.ok && (await r.text()) === APP_NAME;
  } catch {
    return false;
  }
}

function listen(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const srv = createServer(serve);
    srv.once('error', () => ok(false));
    srv.listen(port, '127.0.0.1', () => ok(true));
  });
}

// ---------------- 앱 창 ----------------

function findBrowser(): string | null {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const list = [
    join(pf, 'Google/Chrome/Application/chrome.exe'),
    join(pf86, 'Google/Chrome/Application/chrome.exe'),
    join(local, 'Google/Chrome/Application/chrome.exe'),
    join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    join(pf, 'Microsoft/Edge/Application/msedge.exe'),
  ];
  return list.find((p) => existsSync(p)) ?? null;
}

function openWindow(url: string): void {
  const browser = findBrowser();
  if (!browser) {
    log('Chrome/Edge 를 찾지 못해 기본 브라우저로 엽니다');
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  // 전용 프로필: 앱 창 크기·권한(USB, 글꼴)이 일반 브라우저와 섞이지 않게
  const profile = join(dataDir, 'browser');
  const args = [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900'];
  log(`앱 창: ${browser}`);
  spawn(browser, args, { detached: true, stdio: 'ignore' }).unref();
}

function alertBox(msg: string): void {
  // 콘솔 없는 프로그램이라 오류는 Windows 메시지 상자로 알린다
  const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(msg)}, 'Laser Tool') | Out-Null`;
  spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// ---------------- 시작 ----------------

async function main(): Promise<void> {
  log(`${APP_NAME} 시작 (node ${process.version}, sea=${Boolean(sea)})`);
  loadEnvFile();
  loadFiles();
  for (const port of PORTS) {
    if (await isOurs(port)) {
      // 이미 실행 중이면 창만 하나 더 연다
      openWindow(`http://localhost:${port}/`);
      log(`이미 실행 중 (포트 ${port}) – 창만 엽니다`);
      setTimeout(() => process.exit(0), 1500);
      return;
    }
    if (await listen(port)) {
      const url = `http://localhost:${port}/`;
      log(`서버 시작: ${url}`);
      openWindow(url);
      setInterval(() => {
        const now = Date.now();
        const idle = lastPing ? now - lastPing > IDLE_EXIT_MS : now - started > FIRST_PING_MS;
        if (idle) {
          log('앱 창이 닫혀 종료합니다');
          process.exit(0);
        }
      }, 2000);
      return;
    }
  }
  throw new Error(`사용할 수 있는 포트가 없습니다 (${PORTS.join(', ')})`);
}

// ---------------- MCP 모드 (LaserTool.exe --mcp) ----------------
//
// Claude Desktop 등 MCP 클라이언트가 이 모드로 실행한다 (stdio). 앱이 꺼져 있으면 exe 를 일반 모드로 띄운다.
// AI 사용량은 그 사용자의 MCP 클라이언트(구독)에서 나간다.

async function runningPort(): Promise<number | null> {
  for (const port of PORTS) if (await isOurs(port)) return port;
  return null;
}

function launchApp(): void {
  // 일반 모드 exe: 이미 실행 중이면 창만 하나 더 연다
  const args = sea ? [] : [process.argv[1]];
  spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

async function mcpMain(): Promise<void> {
  log('MCP 모드 시작');
  const { runMcp } = await import('./mcp.ts');
  await runMcp({
    url: `http://localhost:${PORTS[0]}/`,
    async ensure() {
      if (await runningPort()) return 'running';
      launchApp();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (await runningPort()) return 'started';
      }
      throw new Error('Laser Tool 앱을 시작하지 못했습니다');
    },
    open: launchApp,
  });
}

(process.argv.includes('--mcp') ? mcpMain() : main()).catch((e) => {
  log(`오류: ${(e as Error).stack ?? e}`);
  if (process.argv.includes('--mcp')) {
    console.error(`[laser-mcp] ${(e as Error).message}`);
    process.exit(1);
  }
  alertBox(`Laser Tool 을 시작하지 못했습니다:\n${(e as Error).message}\n\n로그: ${logFile}`);
  setTimeout(() => process.exit(1), 3000);
});
