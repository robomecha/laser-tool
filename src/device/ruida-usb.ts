// Ruida 컨트롤러 USB 연결 (Web Serial – Chrome/Edge). 실험적 기능.
//
// Ruida 의 USB 포트는 FTDI(FT245R) 칩으로 PC 에 COM 포트로 잡힌다. MeerK40t 구현 기준:
//  - 보내는 바이트는 모두 swizzle, UDP 와 달리 체크섬과 패킷별 ACK 가 없다.
//  - 설정값 읽기: DA 00 <주소 2바이트> → 응답 DA 01 <주소 2바이트> <값 5바이트> (응답도 swizzle 됨)
//  - 주소 04 00 = 기계 상태(bit0 작업 중, 0x01000000 이동 중), 04 21 / 04 31 = 현재 X / Y (µm)
//  - 작업 제어: D8 00 시작, D8 01 정지, D8 02 일시정지, D8 03 재개, D8 2A XY 원점 복귀
//  - 빠른 이동: D9 10 <옵션> <X 5바이트> <Y 5바이트>
import type { SerialLike, SerialPortLike } from './grbl-serial';
import { decodeNumber, encodeNumber, RUIDA_MAGIC, swizzleByte, unswizzleByte } from '../output/ruida';

const MEM_STATUS = [0x04, 0x00];
const MEM_X = [0x04, 0x21];
const MEM_Y = [0x04, 0x31];
const STATUS_RUNNING = 0x00000001;
const STATUS_MOVING = 0x01000000;
const CHUNK = 1000;

export interface RuidaStatus {
  state: 'Disconnected' | 'Idle' | 'Run' | 'Move' | 'Hold';
  /** 기계 좌표 mm */
  x: number;
  y: number;
}

export class RuidaUsbConnection {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reading = false;
  private pollTimer: number | null = null;
  private rx: number[] = [];
  private magic = RUIDA_MAGIC;
  private uploading = false;
  private paused = false;
  private raw = 0;
  private replyWaiters: (() => void)[] = [];

  status: RuidaStatus = { state: 'Disconnected', x: 0, y: 0 };
  onStatus: (s: RuidaStatus) => void = () => {};
  onLine: (line: string, dir: 'in' | 'out') => void = () => {};
  onProgress: (p: { sent: number; total: number }) => void = () => {};

  get connected(): boolean {
    return !!this.port;
  }
  get busy(): boolean {
    return this.uploading || (this.raw & STATUS_RUNNING) !== 0;
  }

  async connect(baudRate: number, magic = RUIDA_MAGIC): Promise<void> {
    this.magic = magic;
    const serial = (navigator as unknown as { serial: SerialLike }).serial;
    const port = await serial.requestPort();
    // FT245R 은 FIFO 방식이라 baud 값은 실제 속도에 영향이 없다.
    await port.open({ baudRate, flowControl: 'none' });
    this.port = port;
    this.writer = port.writable!.getWriter();
    void this.readLoop();
    // 연결 확인: 상태 읽기에 응답하는지 확인
    await this.write([0xda, 0x00, ...MEM_STATUS]);
    const ok = await this.waitReply(1500);
    if (!ok) {
      await this.disconnect();
      throw new Error('컨트롤러 응답이 없습니다. 포트가 맞는지, LightBurn/RDWorks 가 포트를 쓰고 있지 않은지 확인하세요.');
    }
    this.onLine('Ruida 컨트롤러 응답 확인', 'in');
    this.pollTimer = window.setInterval(() => void this.poll(), 400);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.reading = false;
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

  private async write(plain: number[] | Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('연결되지 않았습니다');
    const out = Uint8Array.from(plain, (b) => swizzleByte(b, this.magic));
    await this.writer.write(out);
  }

  private async readLoop(): Promise<void> {
    const reader = this.port!.readable!.getReader();
    this.reading = true;
    try {
      while (this.reading) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const b of value) this.rx.push(unswizzleByte(b, this.magic));
        this.parse();
      }
    } catch (e) {
      this.onLine(`[읽기 오류] ${(e as Error).message}`, 'in');
    } finally {
      reader.releaseLock();
    }
  }

  /** 수신 버퍼에서 DA 01 응답(9바이트)을 찾아 해석 */
  private parse(): void {
    while (this.rx.length >= 2) {
      if (this.rx[0] !== 0xda || this.rx[1] !== 0x01) {
        this.rx.shift();
        continue;
      }
      if (this.rx.length < 9) return;
      const msg = this.rx.splice(0, 9);
      const addr = (msg[2] << 8) | msg[3];
      const value = decodeNumber(msg, 4);
      if (addr === 0x0400) this.raw = value;
      else if (addr === 0x0421) this.status.x = value / 1000;
      else if (addr === 0x0431) this.status.y = value / 1000;
      this.status.state = this.paused ? 'Hold' : this.raw & STATUS_RUNNING ? 'Run' : this.raw & STATUS_MOVING ? 'Move' : 'Idle';
      if (addr === 0x0431 || addr === 0x0400) this.onStatus({ ...this.status });
      const w = this.replyWaiters.splice(0);
      for (const fn of w) fn();
    }
  }

  private waitReply(ms: number): Promise<boolean> {
    return new Promise((res) => {
      const t = setTimeout(() => res(false), ms);
      this.replyWaiters.push(() => {
        clearTimeout(t);
        res(true);
      });
    });
  }

  private async poll(): Promise<void> {
    // 작업 데이터 전송 중에는 명령이 섞이지 않도록 폴링을 멈춘다
    if (this.uploading || !this.writer) return;
    try {
      await this.write([0xda, 0x00, ...MEM_STATUS, 0xda, 0x00, ...MEM_X, 0xda, 0x00, ...MEM_Y]);
    } catch {
      /* 연결 끊김은 readLoop 에서 보고 */
    }
  }

  /** swizzle 전 평문 RD 데이터(D8 00 포함)를 전송. 전송이 끝나면 컨트롤러가 작업을 시작한다 */
  async sendJob(plain: Uint8Array): Promise<void> {
    if (this.busy) throw new Error('컨트롤러가 작업 중입니다');
    this.uploading = true;
    this.paused = false;
    try {
      for (let i = 0; i < plain.length; i += CHUNK) {
        await this.write(plain.subarray(i, i + CHUNK));
        this.onProgress({ sent: Math.min(plain.length, i + CHUNK), total: plain.length });
      }
    } finally {
      this.uploading = false;
    }
    this.onLine(`작업 데이터 전송 완료 (${plain.length} bytes)`, 'in');
  }

  /** 작업이 끝날 때까지 대기 (작업 시작 감지 후 RUNNING 비트가 꺼지면 완료) */
  async waitJobDone(startTimeoutMs = 10000): Promise<void> {
    const t0 = Date.now();
    while (!(this.raw & STATUS_RUNNING)) {
      if (Date.now() - t0 > startTimeoutMs || !this.connected) return;
      await sleep(300);
    }
    while (this.connected && this.raw & STATUS_RUNNING) await sleep(500);
  }

  async waitIdle(timeoutMs = 60000): Promise<void> {
    const t0 = Date.now();
    await sleep(500);
    while (this.connected && this.raw & STATUS_MOVING && Date.now() - t0 < timeoutMs) await sleep(250);
  }

  async pause(): Promise<void> {
    this.paused = true;
    await this.write([0xd8, 0x02]);
  }
  async resume(): Promise<void> {
    this.paused = false;
    await this.write([0xd8, 0x03]);
  }
  async stop(): Promise<void> {
    this.paused = false;
    await this.write([0xd8, 0x01]);
  }
  async home(): Promise<void> {
    await this.write([0xd8, 0x2a]);
  }

  /** 기계 좌표 (mm) 로 빠른 이동 (레이저 끔) */
  async moveTo(x: number, y: number): Promise<void> {
    await this.write([0xd9, 0x10, 0x02, ...encodeNumber(x * 1000), ...encodeNumber(y * 1000)]);
  }

  async jog(dx: number, dy: number): Promise<void> {
    await this.moveTo(this.status.x + dx, this.status.y + dy);
  }

  /** 사각 프레임: 모서리를 차례로 이동 (각 이동이 끝날 때까지 대기) */
  async frame(corners: { x: number; y: number }[]): Promise<void> {
    for (const c of [...corners, corners[0]]) {
      await this.moveTo(c.x, c.y);
      await this.waitIdle(20000);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
