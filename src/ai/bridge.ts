// 브라우저 ↔ MCP 서버(tools/mcp-server.mjs) WebSocket 연결
import { AiContext, handlers } from './handlers';

export type BridgeState = 'off' | 'connecting' | 'connected';

export class AiBridge {
  private ws: WebSocket | null = null;
  private retry: number | null = null;
  private wanted = false;
  state: BridgeState = 'off';

  onState: (s: BridgeState) => void = () => {};
  /** 도구 호출 기록 (콘솔 표시용) */
  onCall: (method: string, ok: boolean, info: string) => void = () => {};
  /** 다른 탭/창이 AI 연결을 가져가 이 창의 연결이 해제됨 */
  onReplaced: () => void = () => {};

  constructor(
    private ctx: AiContext,
    private url = 'ws://127.0.0.1:47801',
  ) {}

  start(): void {
    this.wanted = true;
    this.open();
  }

  stop(): void {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.ws?.close();
    this.ws = null;
    this.set('off');
  }

  private set(s: BridgeState): void {
    this.state = s;
    this.onState(s);
  }

  private open(): void {
    if (!this.wanted) return;
    this.set('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    // 연결 자체가 아니라 서버의 인사 메시지를 받아야 연결된 것으로 본다 (같은 포트의 다른 서비스와 구분)
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.wanted) return;
      // 다른 탭/창이 연결을 가져갔다: 다시 붙으면 서로 밀어내기를 반복하므로 여기서 멈춘다
      if (ev.reason === 'replaced') {
        this.wanted = false;
        this.set('off');
        this.onReplaced();
        return;
      }
      // MCP 서버는 Claude 가 실행할 때만 떠 있으므로 계속 재시도한다
      this.set('connecting');
      this.retry = window.setTimeout(() => this.open(), 2000);
    };
    ws.onmessage = (ev) => void this.handle(ws, String(ev.data));
  }

  private async handle(ws: WebSocket, raw: string): Promise<void> {
    let msg: { id: number; method: string; params?: Record<string, unknown>; hello?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.hello === 'laser-tool-mcp') {
      this.set('connected');
      return;
    }
    const fn = handlers[msg.method];
    try {
      if (!fn) throw new Error(`알 수 없는 명령: ${msg.method}`);
      const result = await fn(this.ctx, msg.params ?? {});
      ws.send(JSON.stringify({ id: msg.id, result }));
      this.onCall(msg.method, true, '');
    } catch (e) {
      const err = (e as Error).message;
      ws.send(JSON.stringify({ id: msg.id, error: err }));
      this.onCall(msg.method, false, err);
    }
  }
}
