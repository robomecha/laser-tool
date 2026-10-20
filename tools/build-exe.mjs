#!/usr/bin/env node
// LaserTool.exe 만들기 (Windows): 앱 빌드 → 서버 묶기 → Node 단일 실행 파일(SEA) 에 주입
//
//   npm run build:exe   →  release/LaserTool.exe (+ laser-tool.env.example, 사용법.txt)
//
// 1. vite build              → dist/
// 2. esbuild                 → build/launcher.cjs  (server/standalone.ts 와 의존성 전부)
// 3. node --experimental-sea-config → build/sea-prep.blob  (dist 파일을 asset 으로 포함)
// 4. node.exe 복사 + postject 로 blob 주입, 콘솔 창이 뜨지 않게 GUI 프로그램으로 표시
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'build');
const release = join(root, 'release');
const exe = join(release, 'LaserTool.exe');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
const step = (s) => console.log(`\n▶ ${s}`);

if (process.platform !== 'win32') console.warn('경고: Windows 가 아닌 곳에서는 그 OS 용 실행 파일이 만들어집니다.');

step('앱 빌드 (vite)');
run('npx', ['vite', 'build']);

step('서버 묶기 (esbuild)');
rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
run('npx', [
  'esbuild', 'server/standalone.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  `--outfile=${join(build, 'launcher.cjs')}`, '--log-level=warning',
]);

step('실행 파일 데이터 만들기 (SEA)');
const dist = join(root, 'dist');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(relative(dist, full).replace(/\\/g, '/'));
  }
};
walk(dist);
writeFileSync(join(build, 'manifest.json'), JSON.stringify(files));
const assets = { 'manifest.json': join(build, 'manifest.json') };
for (const f of files) assets[`dist/${f}`] = join(dist, f);
writeFileSync(
  join(build, 'sea-config.json'),
  JSON.stringify({ main: join(build, 'launcher.cjs'), output: join(build, 'sea-prep.blob'), disableExperimentalSEAWarning: true, useCodeCache: false, assets }, null, 2),
);
run(process.execPath, ['--experimental-sea-config', join(build, 'sea-config.json')], { shell: false });

step('LaserTool.exe 만들기');
mkdirSync(release, { recursive: true });
if (existsSync(exe)) rmSync(exe);
copyFileSync(process.execPath, exe);
run('npx', [
  'postject', exe, 'NODE_SEA_BLOB', join(build, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite',
]);

// PE 헤더의 Subsystem 을 WINDOWS_GUI(2) 로: 실행할 때 검은 콘솔 창이 뜨지 않는다
const buf = readFileSync(exe);
const pe = buf.readUInt32LE(0x3c);
if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('PE 헤더를 찾을 수 없습니다');
const subsystemOffset = pe + 4 + 20 + 68;
buf.writeUInt16LE(2, subsystemOffset);
writeFileSync(exe, buf);

writeFileSync(
  join(release, 'laser-tool.env.example'),
  '# 앱 안 AI 대화창을 쓰려면 이 파일 이름을 laser-tool.env 로 바꾸고 키를 넣으세요 (선택).\n# 키 없이도 프로그램은 모두 동작합니다.\nANTHROPIC_API_KEY=\n',
);
writeFileSync(
  join(release, 'README.txt'),
  [
    'Laser Tool – 레이저 커팅·각인 소프트웨어',
    '',
    '실행: LaserTool.exe 를 더블클릭하세요. Chrome 또는 Edge 앱 창으로 열립니다.',
    '      창을 모두 닫으면 프로그램도 종료됩니다.',
    '',
    '처음 실행 시 Windows 가 "PC 보호" 경고를 띄우면 [추가 정보] → [실행] 을 누르세요',
    '(코드 서명이 없는 프로그램이라 나오는 경고입니다).',
    '',
    'AI 대화창(선택): laser-tool.env.example 을 laser-tool.env 로 이름을 바꾸고',
    '                 ANTHROPIC_API_KEY=키 를 넣은 뒤 다시 실행하세요.',
    '',
    '설정·로그 위치: %LOCALAPPDATA%\\LaserTool',
    '문의: mk1017sh@naver.com',
    '',
  ].join('\r\n'),
);

const mb = (statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ 완료: ${relative(root, exe)} (${mb} MB)`);
