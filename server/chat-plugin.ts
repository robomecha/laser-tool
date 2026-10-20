// Vite 개발 서버 플러그인: 앱 내장 대화창의 Claude API 호출을 대신한다 (POST /api/chat).
// API 키는 브라우저로 보내지 않고 이 Node 프로세스에서만 쓴다. 도구 실행은 브라우저가 한다.
//
// 키 설정: 프로젝트 폴더의 .env.local 에 ANTHROPIC_API_KEY=... (git 에 올라가지 않음)
import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { apiTools, INSTRUCTIONS } from '../src/ai/tool-defs';

const MODEL = 'claude-opus-5-5';
const MAX_BODY = 40 * 1024 * 1024;

const SYSTEM = [
  '너는 Laser Tool 앱 안의 AI 조수다. 사용자가 대화창에 쓴 요청대로 도구를 써서 작업대에 그림을 그리고 가공 설정을 한다.',
  ...INSTRUCTIONS,
  '사용자에게는 한국어로 짧고 분명하게 답한다. 그림을 그린 뒤에는 snapshot 으로 결과를 확인하고, 무엇을 만들었고 어떤 레이어가 절단/각인인지 알려준다.',
  '요청이 모호해도 합리적인 크기와 위치(작업대 안)를 정해 먼저 그리고, 바꿀 수 있다고 말한다.',
].join('\n');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('요청이 너무 큽니다'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function chatPlugin(): Plugin {
  let client: Anthropic | null = null;
  const tools = apiTools() as Anthropic.Beta.BetaTool[];
  const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

  return {
    name: 'laser-tool-chat',
    configResolved(config) {
      // .env / .env.local 의 ANTHROPIC_* 값을 서버 프로세스 환경에만 넣는다 (VITE_ 접두사가 아니므로 브라우저로 안 감)
      const env = loadEnv(config.mode, config.root, 'ANTHROPIC_');
      for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
    },
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method === 'GET') return json(res, 200, { configured: hasKey(), model: MODEL });
        if (req.method !== 'POST') return json(res, 405, { error: 'POST 만 지원합니다' });
        if (!hasKey()) {
          return json(res, 503, {
            error: 'Claude API 키가 설정되지 않았습니다. 프로젝트 폴더에 .env.local 파일을 만들고 ANTHROPIC_API_KEY=키 를 넣은 뒤 npm run dev 를 다시 실행하세요.',
          });
        }
        let messages: Anthropic.Beta.BetaMessageParam[];
        try {
          messages = JSON.parse(await readBody(req)).messages;
          if (!Array.isArray(messages) || !messages.length) throw new Error('messages 가 비어 있습니다');
        } catch (e) {
          return json(res, 400, { error: (e as Error).message });
        }
        client ??= new Anthropic();
        try {
          const r = await client.beta.messages.create({
            model: MODEL,
            max_tokens: 16000,
            // 안전 분류기가 거절하면 서버가 알맞은 다른 모델로 다시 시도한다
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium' },
            cache_control: { type: 'ephemeral' },
            system: SYSTEM,
            tools,
            messages,
          });
          json(res, 200, { content: r.content, stop_reason: r.stop_reason, stop_details: r.stop_details ?? null, model: r.model });
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) return json(res, 401, { error: 'API 키가 올바르지 않습니다 (.env.local 의 ANTHROPIC_API_KEY 확인)' });
          if (e instanceof Anthropic.PermissionDeniedError) return json(res, 403, { error: `권한이 없습니다: ${e.message}` });
          if (e instanceof Anthropic.RateLimitError) return json(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' });
          if (e instanceof Anthropic.BadRequestError) return json(res, 400, { error: `요청 오류: ${e.message}` });
          if (e instanceof Anthropic.APIError) return json(res, e.status ?? 502, { error: `Claude API 오류 (${e.status}): ${e.message}` });
          return json(res, 502, { error: `Claude API 에 연결할 수 없습니다: ${(e as Error).message}` });
        }
      });
    },
  };
}
