#!/usr/bin/env node
// Laser Tool MCP 서버 (개발용): 본체는 server/mcp.ts. 앱이 꺼져 있으면 Vite 개발 서버를 띄운다.
// exe 사용자는 LaserTool.exe --mcp 를 쓴다.
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMcp } from '../server/mcp.ts';

const APP_URL = process.env.LASER_APP_URL || 'http://localhost:5173';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const log = (...a) => console.error('[laser-mcp]', ...a);

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
function ensure() {
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

function open() {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', APP_URL]] : process.platform === 'darwin' ? ['open', [APP_URL]] : ['xdg-open', [APP_URL]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

await runMcp({ url: APP_URL, ensure, open });
