// 글꼴 파일(.ttf / .otf / .woff) 읽기. WOFF2 는 opentype.js 가 지원하지 않는다.
import { Font, parse } from 'opentype.js';

export type { Font };

export function parseFont(buffer: ArrayBuffer): Font {
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (String.fromCharCode(...head) === 'wOF2') throw new Error('WOFF2 글꼴은 지원하지 않습니다 (TTF/OTF 를 사용하세요)');
  return parse(buffer);
}

/** 사용자에게 보여줄 글꼴 이름 */
export function fontDisplayName(f: Font): string {
  const pick = (r?: Record<string, string>) => r && (r.ko || r.en || Object.values(r)[0]);
  return pick(f.names.fullName) || pick(f.names.fontFamily) || '글꼴';
}
