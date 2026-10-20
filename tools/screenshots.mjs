#!/usr/bin/env node
// 소개용 화면 이미지 만들기: 개발 서버(npm run dev)가 떠 있는 상태에서 실행
//   node tools/screenshots.mjs [baseUrl]  →  docs/images/screen-1.png … screen-3.png
// Chrome(없으면 Edge) headless 로 ?demo=N 예제 화면을 1600×1000 으로 찍는다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || 'http://localhost:5173/';
const out = join(root, 'docs', 'images');
mkdirSync(out, { recursive: true });

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) throw new Error('Chrome / Edge 를 찾을 수 없습니다');

const lang = process.env.SHOT_LANG || 'ko';
for (const n of [1, 2, 3]) {
  const profile = join(tmpdir(), `laser-tool-shot-${process.pid}-${n}`);
  const file = join(out, `screen-${n}${lang === 'ko' ? '' : `-${lang}`}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`,
    `--lang=${lang}`, '--window-size=1600,1000', '--force-device-scale-factor=1',
    '--virtual-time-budget=8000', `--screenshot=${file}`,
    `${base}?demo=${n}&lang=${lang}`,
  ], { stdio: 'ignore' });
  rmSync(profile, { recursive: true, force: true });
  console.log(existsSync(file) ? `✓ ${file}` : `✗ ${file}`);
}
