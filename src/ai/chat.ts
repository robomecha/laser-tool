// 앱 내장 AI 대화창: 사용자의 말을 Claude 에 보내고(/api/chat), Claude 가 부른 도구를 이 브라우저에서 실행한다.
import type Anthropic from '@anthropic-ai/sdk';
import { getLang } from '../ui/i18n';
import { AiContext, handlers } from './handlers';

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlock;

const MAX_STEPS = 30;

const TOOL_LABEL: Record<string, string> = {
  get_canvas_info: '작업대 확인',
  draw_shapes: '도형 그리기',
  add_text: '텍스트 추가',
  text_on_path: '곡선 따라 쓰기',
  import_svg: 'SVG 가져오기',
  list_shapes: '도형 목록',
  transform_shapes: '도형 변형',
  delete_shapes: '도형 삭제',
  set_shape_layer: '레이어 이동',
  set_layer: '레이어 설정',
  offset_shapes: '오프셋',
  boolean_shapes: '불리언',
  array_shapes: '배열 복사',
  preview_job: '가공 미리 계산',
  undo: '실행 취소',
  snapshot: '결과 확인',
};

export class ChatPanel {
  private messages: Msg[] = [];
  private busy = false;
  private abort: AbortController | null = null;
  private log: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;

  constructor(
    private ctx: AiContext,
    private root: HTMLElement,
  ) {
    this.log = root.querySelector('.chat-log')!;
    this.input = root.querySelector('textarea')!;
    this.sendBtn = root.querySelector('.chat-send')!;
    this.sendBtn.onclick = () => (this.busy ? this.stop() : void this.send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!this.busy) void this.send();
      }
      e.stopPropagation(); // 캔버스 단축키와 겹치지 않게
    });
    root.querySelector<HTMLButtonElement>('.chat-clear')!.onclick = () => this.clear();
    root.querySelector<HTMLButtonElement>('.chat-close')!.onclick = () => this.toggle(false);
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-example]')) {
      b.onclick = () => {
        this.input.value = (getLang() === 'en' && b.dataset.exampleEn) || b.dataset.example!;
        this.input.focus();
      };
    }
  }

  toggle(show = this.root.hidden): void {
    this.root.hidden = !show;
    if (show) {
      this.input.focus();
      void this.checkConfig();
    }
  }

  private async checkConfig(): Promise<void> {
    try {
      const r = await fetch('/api/chat');
      const j = await r.json();
      const note = this.root.querySelector<HTMLElement>('.chat-note')!;
      note.hidden = j.configured;
    } catch {
      /* 정적 배포(dist) 등 서버가 없는 경우 – 보낼 때 오류로 안내 */
    }
  }

  private clear(): void {
    if (this.busy) return;
    this.messages = [];
    this.log.querySelectorAll('.msg').forEach((m) => m.remove());
  }

  private stop(): void {
    this.abort?.abort();
  }

  private add(cls: string, text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.textContent = text;
    this.log.append(el);
    this.log.scrollTop = this.log.scrollHeight;
    return el;
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.sendBtn.textContent = b ? '■ 중지' : '보내기';
    this.sendBtn.classList.toggle('danger', b);
    this.input.disabled = b;
  }

  async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.add('user', text);
    this.messages.push({ role: 'user', content: text });
    this.setBusy(true);
    this.abort = new AbortController();
    const thinking = this.add('status', '생각 중…');
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: this.messages }),
          signal: this.abort.signal,
        });
        const j = await res.json().catch(() => ({ error: `서버 응답 오류 (${res.status})` }));
        if (!res.ok || j.error) throw new Error(j.error ?? `서버 오류 (${res.status})`);
        const content = j.content as Block[];
        // 생각(thinking) 블록 등 응답 전체를 그대로 다음 요청에 돌려줘야 한다
        this.messages.push({ role: 'assistant', content: content as Anthropic.Beta.BetaContentBlockParam[] });
        for (const b of content) if (b.type === 'text' && b.text.trim()) this.log.insertBefore(this.make('assistant', b.text), thinking);

        if (j.stop_reason === 'refusal') {
          this.log.insertBefore(this.make('error', `요청을 처리할 수 없습니다${j.stop_details?.explanation ? `: ${j.stop_details.explanation}` : ''}`), thinking);
          this.messages.pop(); // 거절된 응답은 다음 대화에 남기지 않는다
          break;
        }
        if (j.stop_reason === 'max_tokens') {
          this.log.insertBefore(this.make('error', '응답이 너무 길어 중간에 끊겼습니다. 나눠서 요청해 보세요.'), thinking);
          this.trimDangling();
          break;
        }
        const uses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (j.stop_reason !== 'tool_use' || !uses.length) break;

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const u of uses) {
          const line = this.make('tool', `🔧 ${TOOL_LABEL[u.name] ?? u.name}…`);
          this.log.insertBefore(line, thinking);
          results.push(await this.runTool(u, line));
          this.log.scrollTop = this.log.scrollHeight;
        }
        // 여러 도구 결과는 한 user 메시지에 모아서 보낸다
        this.messages.push({ role: 'user', content: results });
        thinking.textContent = '이어서 작업 중…';
      }
    } catch (e) {
      const err = e as Error;
      this.log.insertBefore(this.make('error', err.name === 'AbortError' ? '중지했습니다.' : err.message), thinking);
      // 마지막 요청이 실패했으면 대화가 이어지도록 끝의 미완성 차례를 정리
      this.trimDangling();
    } finally {
      thinking.remove();
      this.setBusy(false);
      this.abort = null;
      this.log.scrollTop = this.log.scrollHeight;
      this.input.focus();
    }
  }

  private make(cls: string, text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.textContent = text;
    return el;
  }

  private async runTool(u: Anthropic.Beta.BetaToolUseBlock, line: HTMLElement): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    const label = TOOL_LABEL[u.name] ?? u.name;
    try {
      const fn = handlers[u.name];
      if (!fn) throw new Error(`알 수 없는 도구: ${u.name}`);
      const r = await fn(this.ctx, (u.input ?? {}) as Record<string, unknown>);
      line.textContent = `🔧 ${label} ✓`;
      if (u.name === 'snapshot') {
        const s = r as { png: string; caption: string };
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: s.png } },
            { type: 'text', text: s.caption },
          ],
        };
      }
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r ?? null) };
    } catch (e) {
      line.textContent = `🔧 ${label} ✗ ${(e as Error).message}`;
      line.classList.add('error');
      return { type: 'tool_result', tool_use_id: u.id, content: `오류: ${(e as Error).message}`, is_error: true };
    }
  }

  /** 끝이 assistant(tool_use) 이거나 user 로 끝나 응답을 못 받은 상태면, 마지막 사용자 발화 전까지 되돌린다 */
  private trimDangling(): void {
    const last = this.messages[this.messages.length - 1];
    if (!last) return;
    const endsWithToolUse =
      last.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => (b as { type: string }).type === 'tool_use');
    if (last.role === 'user' || endsWithToolUse) {
      // 마지막 '텍스트' user 메시지(사람이 쓴 말)를 찾아 그 앞까지 남긴다
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        if (m.role === 'user' && typeof m.content === 'string') {
          this.messages = this.messages.slice(0, i);
          return;
        }
      }
      this.messages = [];
    }
  }
}
