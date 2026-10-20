#!/usr/bin/env node
// Claude Desktop 설정(claude_desktop_config.json)에 laser-tool MCP 서버를 등록한다.
//
// Claude Desktop 은 실행 중에 설정 파일을 다시 저장하면서 바깥에서 고친 mcpServers 를 덮어쓸 수 있다.
// 그래서 Claude Desktop 을 완전히 종료(트레이 아이콘 → Quit)한 상태에서 실행해야 한다.
//
// 사용법: npm run mcp:register   (Claude 를 끄지 않고 강제로: -- --force)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const force = process.argv.includes('--force');
const server = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs');
const { APPDATA = '', LOCALAPPDATA = '', HOME = '' } = process.env;

function candidates() {
  const out = [];
  // MSIX(스토어) 설치판: %LOCALAPPDATA%\Claude-Data\<패키지>\
  const dataRoot = join(LOCALAPPDATA, 'Claude-Data');
  if (existsSync(dataRoot)) for (const d of readdirSync(dataRoot)) out.push(join(dataRoot, d, 'claude_desktop_config.json'));
  out.push(join(APPDATA, 'Claude', 'claude_desktop_config.json')); // 일반 설치판 (Windows)
  out.push(join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')); // macOS
  return out.filter((p) => existsSync(p));
}

function claudeRunning() {
  if (process.platform !== 'win32') return false;
  try {
    return /^claude\.exe/im.test(execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH', { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

if (claudeRunning() && !force) {
  console.error('Claude Desktop 이 실행 중입니다. 트레이 아이콘에서 완전히 종료(Quit)한 뒤 다시 실행하세요.');
  console.error('(실행 중에 고치면 Claude 가 설정을 다시 저장하면서 등록이 지워질 수 있습니다. 그래도 하려면: npm run mcp:register -- --force)');
  process.exit(1);
}

const files = candidates();
if (!files.length) {
  console.error('claude_desktop_config.json 을 찾지 못했습니다. Claude Desktop 을 한 번 실행한 뒤 다시 시도하세요.');
  process.exit(1);
}

for (const file of files) {
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.mcpServers ??= {};
  const entry = { command: process.execPath, args: [server] };
  if (JSON.stringify(cfg.mcpServers['laser-tool']) === JSON.stringify(entry)) {
    console.log(`이미 등록됨: ${file}`);
    continue;
  }
  const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(file, backup);
  cfg.mcpServers['laser-tool'] = entry;
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  console.log(`등록 완료: ${file}\n  백업: ${backup}`);
}
console.log('\n이제 Claude Desktop 을 실행하고, 브라우저 Laser Tool 에서 [🤖 AI 연결] 을 누르세요.');
