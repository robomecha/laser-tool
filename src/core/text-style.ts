// 텍스트 꾸미기: 겹친 획 정리, 기울임(합성), 외곽선 굵기, 곡선 따라 쓰기
import { unionNonZero, offsetPolylines } from './clip';
import { apply, dist, Mat, mul, Polyline, rotate, translate, Vec } from './geometry';
import { commandsToPolylines, GlyphFont } from './text';

export interface TextStyle {
  /** 기울임 각도 (deg, 양수 = 오른쪽으로 기울어짐). 0 이면 없음 */
  slant?: number;
  /** 외곽선 굵기 mm: 양수 = 두껍게, 음수 = 가늘게 */
  weight?: number;
}

/** 합성 굵게: 글자 크기 대비 두께 */
export const SYNTH_BOLD_RATIO = 0.035;
/** 합성 기울임 각도 */
export const SYNTH_ITALIC_DEG = 12;

/**
 * 글꼴 윤곽선에 스타일 적용. 기준선(y=0) 기준으로 기울이고, 겹친 획을 합친 뒤 두께를 준다.
 * 결과는 겹침 없는 닫힌 윤곽이므로 레이저 채우기(짝홀)에도 안전하다.
 */
export function styleTextPaths(paths: Polyline[], s: TextStyle = {}): Polyline[] {
  let out = paths;
  if (s.slant) {
    const k = Math.tan((s.slant * Math.PI) / 180);
    // Y 가 아래로 증가하므로 위쪽(음수 y) 이 오른쪽으로 가도록 x - y*k
    out = out.map((l) => ({ closed: l.closed, pts: l.pts.map((p) => ({ x: p.x - p.y * k, y: p.y })) }));
  }
  out = unionNonZero(out);
  if (s.weight && Math.abs(s.weight) > 1e-4) {
    const w = offsetPolylines(out, s.weight, { join: 'round' });
    // 가늘게 했다가 글자가 사라지면 원래 모양 유지
    if (w.length) out = w;
  }
  return out;
}

export interface TextOnPathOptions {
  size: number;
  /** 자간 (em 비율) */
  letterSpacing?: number;
  /** 글자 묶음의 가운데가 놓일 위치: 경로 길이의 % (0~100) */
  position?: number;
  /** 경로 바깥쪽(위) / 안쪽(아래) */
  side?: 'above' | 'below';
  /** 경로 진행 방향 반대로 */
  reverse?: boolean;
  /** 경로에서 글자 기준선까지 띄울 거리 mm */
  offset?: number;
  /** 글자별 기울임 (deg) */
  slant?: number;
  tol?: number;
}

interface PathSampler {
  length: number;
  at(s: number): { p: Vec; angle: number };
}

function sampler(path: Polyline, reverse: boolean): PathSampler {
  let pts = [...path.pts];
  if (path.closed && pts.length > 1) pts.push(pts[0]);
  if (reverse) pts.reverse();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const length = cum[cum.length - 1];
  return {
    length,
    at(s: number) {
      if (path.closed) s = ((s % length) + length) % length;
      s = Math.max(0, Math.min(length, s));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1];
      const b = pts[i];
      const seg = cum[i] - cum[i - 1] || 1e-9;
      const t = (s - cum[i - 1]) / seg;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    },
  };
}

/** 글자를 하나씩 경로를 따라 배치한다 (경로 길이를 넘는 글자는 열린 경로에서 생략) */
export function textOnPath(font: GlyphFont, text: string, path: Polyline, o: TextOnPathOptions): Polyline[] {
  const chars = [...text.replace(/\r?\n/g, ' ')];
  if (!chars.length || path.pts.length < 2) return [];
  const size = o.size;
  const spacing = (o.letterSpacing ?? 0) * size;
  const adv = chars.map((c) => font.getAdvanceWidth(c, size) + spacing);
  const total = adv.reduce((a, b) => a + b, 0) - spacing;
  const sp = sampler(path, o.reverse ?? false);
  const center = ((o.position ?? 50) / 100) * sp.length;
  // 아래쪽: 글자 윗부분이 경로에 닿도록 기준선을 글자 높이만큼 내린다
  const baseShift = (o.side === 'below' ? size * 0.75 : 0) + (o.side === 'below' ? 1 : -1) * (o.offset ?? 0);
  const out: Polyline[] = [];
  let s = center - total / 2;
  chars.forEach((c, i) => {
    const mid = s + adv[i] / 2 - spacing / 2;
    s += adv[i];
    if (!path.closed && (mid < 0 || mid > sp.length)) return;
    if (!c.trim()) return;
    const { p, angle } = sp.at(mid);
    const w = adv[i] - spacing;
    let glyph = commandsToPolylines(font.getPath(c, -w / 2, baseShift, size).commands, o.tol, true);
    if (o.slant) {
      const k = Math.tan((o.slant * Math.PI) / 180);
      glyph = glyph.map((l) => ({ closed: l.closed, pts: l.pts.map((q) => ({ x: q.x - (q.y - baseShift) * k, y: q.y })) }));
    }
    const m: Mat = mul(translate(p.x, p.y), rotate(angle));
    for (const l of glyph) out.push({ closed: l.closed, pts: l.pts.map((q) => apply(m, q)) });
  });
  return out;
}
