// 글꼴 파일(.ttf / .otf / .woff / .ttc) 읽기. WOFF2 는 opentype.js 가 지원하지 않는다.
import { Font, parse } from 'opentype.js';

export type { Font };

const tag = (buf: ArrayBuffer, off = 0) => String.fromCharCode(...new Uint8Array(buf, off, Math.min(4, buf.byteLength - off)));

/**
 * TrueType Collection(.ttc, 예: Windows 의 굴림·바탕) 에서 index 번째 글꼴을 단독 글꼴로 꺼낸다.
 * 테이블 오프셋은 파일 기준 절대값이므로 파일 앞부분에 해당 글꼴의 테이블 목록만 덮어쓰면 된다.
 */
function extractFromCollection(buf: ArrayBuffer, index: number): ArrayBuffer {
  const v = new DataView(buf);
  const num = v.getUint32(8);
  if (index >= num) throw new Error(`글꼴 묶음에 ${index + 1}번째 글꼴이 없습니다`);
  const off = v.getUint32(12 + index * 4);
  const numTables = v.getUint16(off + 4);
  const dirSize = 12 + numTables * 16;
  let minTable = Infinity;
  for (let i = 0; i < numTables; i++) minTable = Math.min(minTable, v.getUint32(off + 12 + i * 16 + 8));
  if (minTable < dirSize) throw new Error('지원하지 않는 글꼴 묶음 형식입니다');
  const out = buf.slice(0);
  new Uint8Array(out).set(new Uint8Array(buf, off, dirSize), 0);
  return out;
}

/** 테이블 목록에서 지정 테이블의 이름을 바꿔 opentype.js 가 무시하게 한다 (복사본 반환) */
function hideTables(buf: ArrayBuffer, tags: string[]): ArrayBuffer {
  const out = buf.slice(0);
  const v = new DataView(out);
  const numTables = v.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    if (tags.includes(tag(out, p))) v.setUint8(p, 'x'.charCodeAt(0)); // 'GSUB' → 'xSUB'
  }
  return out;
}

/**
 * opentype.js 가 일부 오래된 글꼴(굴림 등)의 GSUB/GPOS/kern 표를 해석하지 못하면 전체가 실패한다.
 * 윤곽선만 있으면 되므로 그 표들을 숨기고 다시 읽는다 (합자·커닝만 빠짐).
 */
function parseTolerant(buf: ArrayBuffer): Font {
  try {
    return parse(buf);
  } catch (e) {
    try {
      return parse(hideTables(buf, ['GSUB', 'GPOS', 'GDEF', 'kern', 'meta', 'CPAL', 'COLR']));
    } catch {
      throw e;
    }
  }
}

export function collectionSize(buf: ArrayBuffer): number {
  return tag(buf) === 'ttcf' ? new DataView(buf).getUint32(8) : 1;
}

/** postScriptName 을 주면 글꼴 묶음(.ttc) 안에서 그 이름의 글꼴을 고른다 */
export function parseFont(buffer: ArrayBuffer, postScriptName?: string): Font {
  const head = tag(buffer);
  if (head === 'wOF2') throw new Error('WOFF2 글꼴은 지원하지 않습니다 (TTF/OTF 를 사용하세요)');
  if (head !== 'ttcf') return parseTolerant(buffer);
  const n = collectionSize(buffer);
  let first: Font | null = null;
  for (let i = 0; i < n; i++) {
    const f = parseTolerant(extractFromCollection(buffer, i));
    first ??= f;
    if (!postScriptName || fontName(f, 'postScriptName', 'en') === postScriptName) return f;
  }
  return first!;
}

type NameTable = Record<string, Record<string, string> | undefined>;

/** 이름 레코드: opentype.js 2.x 는 windows / macintosh / unicode 아래에, 1.x 는 바로 아래에 둔다 */
export function fontName(f: Font, key: string, lang: 'ko' | 'en' = 'ko'): string | undefined {
  const n = f.names as unknown as Record<string, NameTable | Record<string, string> | undefined>;
  const rec =
    (n.windows as NameTable | undefined)?.[key] ??
    (n.macintosh as NameTable | undefined)?.[key] ??
    (n.unicode as NameTable | undefined)?.[key] ??
    (n[key] as Record<string, string> | undefined);
  if (!rec) return undefined;
  return (lang === 'ko' ? rec.ko || rec.en : rec.en || rec.ko) || Object.values(rec)[0];
}

/** 사용자에게 보여줄 글꼴 이름 */
export function fontDisplayName(f: Font): string {
  return fontName(f, 'fullName') || fontName(f, 'fontFamily') || '글꼴';
}

/** 글꼴 가족 이름과 스타일 이름 */
export function fontFamilyStyle(f: Font): { family: string; style: string } {
  return {
    family: fontName(f, 'preferredFamily') || fontName(f, 'fontFamily') || '글꼴',
    style: fontName(f, 'preferredSubfamily') || fontName(f, 'fontSubfamily') || 'Regular',
  };
}
