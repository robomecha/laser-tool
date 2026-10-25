// Claude Desktop 설정(claude_desktop_config.json)에 laser-tool MCP 서버를 등록한다.
// LaserTool.exe --register-mcp (connect-claude.bat) 와 tools/register-claude-desktop.mjs 가 쓴다.
//
// Claude Desktop 은 실행 중에 설정 파일을 다시 저장하면서 바깥에서 고친 mcpServers 를 덮어쓸 수 있으므로,
// Claude Desktop 이 꺼져 있을 때만 등록한다.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface McpEntry {
  command: string;
  args: string[];
}

export function claudeConfigFiles(): string[] {
  const { APPDATA = '', LOCALAPPDATA = '', HOME = '' } = process.env;
  const out: string[] = [];
  // MSIX(스토어) 설치판: %LOCALAPPDATA%\Claude-Data\<패키지>\
  const dataRoot = join(LOCALAPPDATA, 'Claude-Data');
  if (existsSync(dataRoot)) for (const d of readdirSync(dataRoot)) out.push(join(dataRoot, d, 'claude_desktop_config.json'));
  out.push(join(APPDATA, 'Claude', 'claude_desktop_config.json')); // 일반 설치판 (Windows)
  out.push(join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')); // macOS
  return out.filter((p) => existsSync(p));
}

export function claudeRunning(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    return /^claude\.exe/im.test(execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH', { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

/** 등록 결과 안내 문구 (사용자에게 보여줌) */
export function registerMcp(entry: McpEntry, force = false): { ok: boolean; message: string } {
  if (claudeRunning() && !force) {
    return {
      ok: false,
      message: 'Claude Desktop 이 실행 중입니다.\n트레이 아이콘에서 Claude 를 완전히 종료(Quit)한 뒤 다시 실행하세요.\n(실행 중에 고치면 Claude 가 설정을 다시 저장하면서 등록이 지워질 수 있습니다)',
    };
  }
  let files = claudeConfigFiles();
  if (!files.length) {
    // 설정 파일이 아직 없으면 일반 설치판 위치에 만든다
    const p = join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
    if (!process.env.APPDATA) return { ok: false, message: 'Claude Desktop 설정 위치를 찾지 못했습니다. Claude Desktop 을 한 번 실행한 뒤 다시 시도하세요.' };
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '{}');
    files = [p];
  }
  const done: string[] = [];
  for (const file of files) {
    const cfg = JSON.parse(readFileSync(file, 'utf8') || '{}') as { mcpServers?: Record<string, McpEntry> };
    cfg.mcpServers ??= {};
    if (JSON.stringify(cfg.mcpServers['laser-tool']) !== JSON.stringify(entry)) {
      copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      cfg.mcpServers['laser-tool'] = entry;
      writeFileSync(file, JSON.stringify(cfg, null, 2));
    }
    done.push(file);
  }
  return {
    ok: true,
    message: `Claude Desktop 에 Laser Tool 을 연결했습니다.\n\nClaude Desktop 을 실행하고 채팅에서\n"laser-tool 로 원형 코스터 만들어 줘" 처럼 요청하세요.\n\n설정 파일:\n${done.join('\n')}`,
  };
}
