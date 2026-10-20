// 텍스트 → 폴리라인 변환. 글꼴 파싱(opentype.js)과 분리해 어떤 글꼴 객체든 받을 수 있게 한다.
import { dist, flattenCubic, flattenQuad, Polyline, Vec } from './geometry';

/** opentype.js 경로 명령 (글꼴 단위가 아니라 getPath 에 준 크기·위치 기준) */
export type GlyphCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

/** 필요한 글꼴 기능만 추린 인터페이스 (opentype.js Font 와 호환) */
export interface GlyphFont {
  getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): {
    commands: GlyphCommand[];
  };
  getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): number;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextOptions {
  /** 글자 크기(em, mm) */
  size: number;
  /** 줄 간격 배수 (기본 1.2) */
  lineHeight?: number;
  /** 자간 (em 비율, 기본 0) */
  letterSpacing?: number;
  align?: TextAlign;
  /** 곡선 평탄화 허용 오차 mm */
  tol?: number;
}

/**
 * opentype 경로 명령 → 폴리라인 (Y 아래 방향 좌표 그대로).
 * closeAll: 글꼴 윤곽선은 항상 닫혀 있지만 opentype.js 2.x 는 일부 TrueType 글꼴에서 Z 를 생략하므로 강제로 닫는다.
 */
export function commandsToPolylines(cmds: GlyphCommand[], tol = 0.02, closeAll = false): Polyline[] {
  const out: Polyline[] = [];
  let cur: Vec[] = [];
  let start: Vec = { x: 0, y: 0 };
  let last: Vec = { x: 0, y: 0 };
  const flush = (closed: boolean) => {
    if (closed && cur.length > 1 && dist(cur[0], cur[cur.length - 1]) < 1e-9) cur.pop();
    if (cur.length >= 2) out.push({ pts: cur, closed: closed && cur.length > 2 });
    cur = [];
  };
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        flush(closeAll);
        start = last = { x: c.x, y: c.y };
        cur = [start];
        break;
      case 'L':
        last = { x: c.x, y: c.y };
        cur.push(last);
        break;
      case 'Q':
        cur.push(...flattenQuad(last, { x: c.x1, y: c.y1 }, { x: c.x, y: c.y }, tol));
        last = { x: c.x, y: c.y };
        break;
      case 'C':
        cur.push(...flattenCubic(last, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }, tol));
        last = { x: c.x, y: c.y };
        break;
      case 'Z':
        flush(true);
        last = start;
        break;
    }
  }
  flush(closeAll);
  return out;
}

/**
 * 여러 줄 텍스트를 폴리라인으로 변환한다.
 * 첫 줄 기준선(baseline)의 정렬 기준점이 (0,0) 이고 다음 줄은 +Y(아래)로 쌓인다.
 */
export function textToPolylines(font: GlyphFont, text: string, o: TextOptions): Polyline[] {
  const size = o.size;
  const lh = (o.lineHeight ?? 1.2) * size;
  const opts = { kerning: true, letterSpacing: o.letterSpacing ?? 0 };
  const out: Polyline[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const w = font.getAdvanceWidth(line, size, opts);
    const x = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
    out.push(...commandsToPolylines(font.getPath(line, x, i * lh, size, opts).commands, o.tol, true));
  });
  return out;
}
