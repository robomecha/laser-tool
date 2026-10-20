// Vite 개발 서버 플러그인: /api/chat 을 chat-handler 로 연결한다.
// 키 설정: 프로젝트 폴더의 .env.local 에 ANTHROPIC_API_KEY=... (git 에 올라가지 않음)
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { handleChat } from './chat-handler';

const MISSING_KEY =
  'Claude API 키가 설정되지 않았습니다. 키 없이 쓰려면 Claude Desktop 채팅에서 "laser-tool 로 ... 만들어 줘" 라고 요청하세요. 키를 쓰려면 프로젝트 폴더의 .env.local 에 ANTHROPIC_API_KEY=키 를 넣고 npm run dev 를 다시 실행하세요.';

export function chatPlugin(): Plugin {
  return {
    name: 'laser-tool-chat',
    configResolved(config) {
      // .env / .env.local 의 ANTHROPIC_* 값을 서버 프로세스 환경에만 넣는다 (VITE_ 접두사가 아니므로 브라우저로 안 감)
      const env = loadEnv(config.mode, config.root, 'ANTHROPIC_');
      for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
    },
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res) => void handleChat(req, res, MISSING_KEY));
    },
  };
}
