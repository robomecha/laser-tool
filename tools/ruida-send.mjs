#!/usr/bin/env node
// Ruida 컨트롤러로 .rd 파일 전송 (UDP 50200) – 실험적
//
// 사용법: node tools/ruida-send.mjs <file.rd> <controller-ip> [--start]
//
// 프로토콜 (공개 역공학 자료 기준):
//  - 패킷 = [체크섬 2바이트, big-endian] + [swizzle 된 데이터 최대 1000바이트]
//    체크섬은 swizzle 된 데이터 바이트의 합 & 0xFFFF
//  - 컨트롤러는 UDP 50200 에서 수신하고 송신측 40200 포트로 ACK(0xCC) / NAK(0xCF) 를 보낸다 (응답도 swizzle 됨).
//  - .rd 파일 내용은 이미 swizzle 되어 있으므로 그대로 잘라 보낸다.
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';

const [, , file, host, ...rest] = process.argv;
if (!file || !host) {
  console.error('사용법: node tools/ruida-send.mjs <file.rd> <controller-ip>');
  process.exit(1);
}

const MAGIC = 0x88;
const unswizzle = (b) => {
  b = (b - 1) & 0xff;
  b ^= MAGIC;
  b ^= (b >> 7) & 0xff;
  b ^= (b << 7) & 0xff;
  b ^= (b >> 7) & 0xff;
  return b;
};

const data = readFileSync(file);
const CHUNK = 1000;
const sock = dgram.createSocket('udp4');
let offset = 0;
let retries = 0;
let timer = null;

function packet(chunk) {
  let sum = 0;
  for (const b of chunk) sum += b;
  const buf = Buffer.alloc(chunk.length + 2);
  buf.writeUInt16BE(sum & 0xffff, 0);
  chunk.copy(buf, 2);
  return buf;
}

function sendNext() {
  if (offset >= data.length) {
    console.log(`전송 완료: ${data.length} bytes`);
    if (rest.includes('--start')) console.log('(참고: 작업 시작은 컨트롤러 패널에서 하세요)');
    sock.close();
    return;
  }
  const chunk = data.subarray(offset, offset + CHUNK);
  sock.send(packet(chunk), 50200, host);
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (++retries > 5) {
      console.error('응답 없음 – IP 와 네트워크 설정을 확인하세요');
      sock.close();
      process.exit(2);
    }
    console.warn(`재전송 (${retries})`);
    sendNext();
  }, 3000);
}

sock.on('message', (msg) => {
  const b = msg[0];
  const ack = unswizzle(b) === 0xcc;
  const nak = unswizzle(b) === 0xcf;
  if (ack) {
    retries = 0;
    offset += CHUNK;
    process.stdout.write(`\r${Math.min(100, Math.round((offset / data.length) * 100))}%`);
    sendNext();
  } else if (nak) {
    console.warn('\nNAK – 재전송');
    sendNext();
  }
});

sock.on('error', (e) => {
  console.error(e.message);
  process.exit(3);
});

sock.bind(40200, () => {
  console.log(`${file} → ${host}:50200 (${data.length} bytes)`);
  sendNext();
});
