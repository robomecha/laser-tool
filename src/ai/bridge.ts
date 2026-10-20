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

  constructor(
    private ctx: AiContext,
    private url = 'ws://127.0.0.1:5174',
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
    ws.onopen = () => this.set('connected');
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.wanted) return;
      // MCP 서버는 Claude 가 실행할 때만 떠 있으므로 계속 재시도한다
      this.set('connecting');
      this.retry = window.setTimeout(() => this.open(), 2000);
    };
    ws.onmessage = (ev) => void this.handle(ws, String(ev.data));
  }

  private async handle(ws: WebSocket, raw: string): Promise<void> {
    let msg: { id: number; method: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
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
