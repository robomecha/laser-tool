// GRBL 컨트롤러 USB 시리얼 연결 (Web Serial API – Chrome/Edge 에서 동작)
//
// 스트리밍은 GRBL 의 문자 수 계산(character-counting) 방식: 수신 버퍼(기본 128바이트)를
// 넘지 않는 범위에서 미리 보내고, 'ok'/'error' 응답마다 해당 줄 길이만큼 여유를 회수한다.

// Web Serial 최소 타입 선언 (lib.dom 에 없음)
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

export type MachineState = 'Disconnected' | 'Idle' | 'Run' | 'Hold' | 'Jog' | 'Alarm' | 'Door' | 'Check' | 'Home' | 'Sleep' | string;

export interface GrblStatus {
  state: MachineState;
  /** 작업 좌표 (WPos) */
  x: number;
  y: number;
}

export interface StreamProgress {
  sent: number;
  acked: number;
  total: number;
}

const RX_BUFFER = 127;

export class GrblConnection {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reading = false;
  private statusTimer: number | null = null;
  private enc = new TextEncoder();

  private queue: string[] = [];
  private inFlight: number[] = [];
  private total = 0;
  private sent = 0;
  private acked = 0;
  private streaming = false;
  private wco = { x: 0, y: 0 };
  private streamDone: (() => void) | null = null;

  status: GrblStatus = { state: 'Disconnected', x: 0, y: 0 };

  onLine: (line: string, dir: 'in' | 'out') => void = () => {};
  onStatus: (s: GrblStatus) => void = () => {};
  onProgress: (p: StreamProgress) => void = () => {};

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  get connected(): boolean {
    return !!this.port;
  }

  get busy(): boolean {
    return this.streaming;
  }

  async connect(baudRate: number): Promise<void> {
    const serial = (navigator as unknown as { serial: SerialLike }).serial;
    const port = await serial.requestPort();
    await port.open({ baudRate });
    this.port = port;
    this.writer = port.writable!.getWriter();
    this.readLoop();
    this.statusTimer = window.setInterval(() => void this.realtime('?'), 250);
    // 연결 시 소프트 리셋 없이 상태만 확인
    await this.writeRaw('\n');
  }

  async disconnect(): Promise<void> {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.reading = false;
    this.abortStream();
    try {
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* 무시 */
    }
    this.port = null;
    this.writer = null;
    this.status = { state: 'Disconnected', x: 0, y: 0 };
    this.onStatus(this.status);
  }

  private async writeRaw(s: string): Promise<void> {
    if (!this.writer) throw new Error('연결되지 않았습니다');
    await this.writer.write(this.enc.encode(s));
  }

  /** 실시간 명령: '?', '!', '~', '\x18' (버퍼를 거치지 않음) */
  async realtime(ch: string): Promise<void> {
    if (this.writer) await this.writeRaw(ch);
  }

  /** 한 줄 명령 전송 (스트리밍 중이 아닐 때) */
  async send(line: string): Promise<void> {
    if (this.streaming) throw new Error('작업 실행 중입니다');
    this.queue.push(line);
    this.total = this.sent = this.acked = 0;
    await this.pump();
  }

  private async readLoop(): Promise<void> {
    const reader = this.port!.readable!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    this.reading = true;
    try {
      while (this.reading) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.handleLine(line);
        }
      }
    } catch (e) {
      this.onLine(`[읽기 오류] ${(e as Error).message}`, 'in');
    } finally {
      reader.releaseLock();
    }
  }

  private handleLine(line: string): void {
    if (line.startsWith('<')) {
      this.parseStatus(line);
      return;
    }
    if (line === 'ok' || line.startsWith('error')) {
      const n = this.inFlight.shift();
      if (n !== undefined) this.acked++;
      if (line.startsWith('error')) this.onLine(line, 'in');
      if (this.streaming) this.onProgress({ sent: this.sent, acked: this.acked, total: this.total });
      void this.pump();
      return;
    }
    if (line.startsWith('ALARM')) this.abortStream();
    this.onLine(line, 'in');
  }

  private parseStatus(line: string): void {
    const body = line.slice(1, -1).split('|');
    const state = body[0].split(':')[0];
    let mpos: number[] | null = null;
    let wpos: number[] | null = null;
    for (const f of body.slice(1)) {
      const [k, v] = f.split(':');
      const nums = v?.split(',').map(Number);
      if (k === 'MPos') mpos = nums;
      else if (k === 'WPos') wpos = nums;
      else if (k === 'WCO') this.wco = { x: nums[0], y: nums[1] };
    }
    const pos = wpos ? { x: wpos[0], y: wpos[1] } : mpos ? { x: mpos[0] - this.wco.x, y: mpos[1] - this.wco.y } : this.status;
    this.status = { state, x: pos.x, y: pos.y };
    this.onStatus(this.status);
  }

  private async pump(): Promise<void> {
    while (this.queue.length) {
      const line = this.queue[0];
      const len = line.length + 1;
      const used = this.inFlight.reduce((a, b) => a + b, 0);
      if (used + len > RX_BUFFER && this.inFlight.length) return;
      this.queue.shift();
      this.inFlight.push(len);
      this.sent++;
      if (!this.streaming) this.onLine(line, 'out');
      await this.writeRaw(line + '\n');
    }
    if (this.streaming && !this.inFlight.length) {
      this.streaming = false;
      this.onProgress({ sent: this.sent, acked: this.acked, total: this.total });
      this.streamDone?.();
      this.streamDone = null;
    }
  }

  /** G-code 프로그램 전체 스트리밍. 완료 시 resolve */
  stream(gcode: string): Promise<void> {
    if (this.streaming) return Promise.reject(new Error('이미 실행 중입니다'));
    const lines = gcode
      .split('\n')
      .map((l) => l.replace(/;.*$/, '').trim())
      .filter(Boolean);
    this.queue = lines;
    this.inFlight = [];
    this.total = lines.length;
    this.sent = this.acked = 0;
    this.streaming = true;
    return new Promise((res) => {
      this.streamDone = res;
      void this.pump();
    });
  }

  pause(): Promise<void> {
    return this.realtime('!');
  }
  resume(): Promise<void> {
    return this.realtime('~');
  }

  private abortStream(): void {
    this.queue = [];
    this.inFlight = [];
    if (this.streaming) {
      this.streaming = false;
      this.streamDone?.();
      this.streamDone = null;
    }
  }

  /** 정지: 큐 비우고 피드 홀드 후 소프트 리셋 (레이저 즉시 꺼짐) */
  async stop(): Promise<void> {
    this.abortStream();
    await this.realtime('!');
    await new Promise((r) => setTimeout(r, 100));
    await this.realtime('\x18');
  }

  async jog(dx: number, dy: number, feedMmMin: number): Promise<void> {
    await this.send(`$J=G91 G21 X${dx.toFixed(3)} Y${dy.toFixed(3)} F${Math.round(feedMmMin)}`);
  }
}
