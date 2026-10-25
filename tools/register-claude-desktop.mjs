#!/usr/bin/env node
// Claude Desktop 설정에 laser-tool MCP 서버(node tools/mcp-server.mjs)를 등록한다 (개발용).
// exe 사용자는 connect-claude.bat (LaserTool.exe --register-mcp).
// 사용법: Claude Desktop 을 완전히 종료한 뒤 npm run mcp:register   (강제: -- --force)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMcp } from '../server/register.ts';

const server = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs');
const r = registerMcp({ command: process.execPath, args: [server] }, process.argv.includes('--force'));
console.log(r.message);
process.exit(r.ok ? 0 : 1);
