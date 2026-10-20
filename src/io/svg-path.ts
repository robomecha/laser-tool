// SVG path 데이터(d 속성) 파서 → 폴리라인. DOM 에 의존하지 않아 테스트 가능하다.
import { flattenCubic, flattenQuad, Polyline, svgArcToPoints, Vec } from '../core/geometry';

const CMD_RE = /[MmLlHhVvCcSsQqTtAaZz]/;

/** 명령 문자와 숫자 문자열 토큰. 아크 플래그 분해를 위해 숫자도 원문 문자열로 보관한다. */
function tokenize(d: string): string[] {
  const out: string[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? m[2]);
  return out;
}

const isCmd = (t: string | undefined) => t !== undefined && t.length === 1 && CMD_RE.test(t);

/**
 * tol: 곡선 평탄화 허용 오차 (경로 좌표 단위). 호출자가 단위 변환 비율을 고려해 넘긴다.
 */
export function parsePathData(d: string, tol = 0.02): Polyline[] {
  const toks = tokenize(d);
  const paths: Polyline[] = [];
  let cur: Polyline | null = null;
  let p: Vec = { x: 0, y: 0 };
  let start: Vec = { x: 0, y: 0 };
  let lastCtrl: Vec | null = null;
  let lastCmd = '';
  let i = 0;
  let cmd = '';

  const num = (): number => {
    const t = toks[i++];
    if (t === undefined || isCmd(t)) throw new Error('SVG path: 숫자가 필요합니다');
    return parseFloat(t);
  };
  // 아크 플래그는 "1010" 처럼 다음 숫자와 붙어 나올 수 있다 → 첫 글자만 소비
  const flag = (): boolean => {
    const t = toks[i];
    if (t === undefined || (t[0] !== '0' && t[0] !== '1')) throw new Error('SVG path: 아크 플래그 오류');
    if (t.length === 1) i++;
    else toks[i] = t.slice(1);
    return t[0] === '1';
  };

  const ensure = () => {
    if (!cur) {
      cur = { pts: [{ ...p }], closed: false };
      paths.push(cur);
    }
    return cur;
  };

  while (i < toks.length) {
    const t = toks[i];
    if (isCmd(t)) {
      cmd = t;
      i++;
    } else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? p.x : 0;
    const oy = rel ? p.y : 0;

    switch (C) {
      case 'M': {
        p = { x: ox + num(), y: oy + num() };
        start = { ...p };
        cur = { pts: [{ ...p }], closed: false };
        paths.push(cur);
        // M 뒤의 추가 좌표쌍은 L 로 취급
        cmd = rel ? 'l' : 'L';
        lastCtrl = null;
        break;
      }
      case 'L':
        p = { x: ox + num(), y: oy + num() };
        ensure().pts.push({ ...p });
        lastCtrl = null;
        break;
      case 'H':
        p = { x: ox + num(), y: p.y };
        ensure().pts.push({ ...p });
        lastCtrl = null;
        break;
      case 'V':
        p = { x: p.x, y: oy + num() };
        ensure().pts.push({ ...p });
        lastCtrl = null;
        break;
      case 'C': {
        const c1 = { x: ox + num(), y: oy + num() };
        const c2 = { x: ox + num(), y: oy + num() };
        const e = { x: ox + num(), y: oy + num() };
        ensure().pts.push(...flattenCubic(p, c1, c2, e, tol));
        lastCtrl = c2;
        p = e;
        break;
      }
      case 'S': {
        const c1: Vec = lastCtrl && /[CS]/i.test(lastCmd) ? { x: 2 * p.x - lastCtrl.x, y: 2 * p.y - lastCtrl.y } : { ...p };
        const c2 = { x: ox + num(), y: oy + num() };
        const e = { x: ox + num(), y: oy + num() };
        ensure().pts.push(...flattenCubic(p, c1, c2, e, tol));
        lastCtrl = c2;
        p = e;
        break;
      }
      case 'Q': {
        const c = { x: ox + num(), y: oy + num() };
        const e = { x: ox + num(), y: oy + num() };
        ensure().pts.push(...flattenQuad(p, c, e, tol));
        lastCtrl = c;
        p = e;
        break;
      }
      case 'T': {
        const c: Vec = lastCtrl && /[QT]/i.test(lastCmd) ? { x: 2 * p.x - lastCtrl.x, y: 2 * p.y - lastCtrl.y } : { ...p };
        const e = { x: ox + num(), y: oy + num() };
        ensure().pts.push(...flattenQuad(p, c, e, tol));
        lastCtrl = c;
        p = e;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const e = { x: ox + num(), y: oy + num() };
        ensure().pts.push(...svgArcToPoints(p, rx, ry, rot, large, sweep, e, tol));
        p = e;
        lastCtrl = null;
        break;
      }
      case 'Z': {
        if (cur) {
          const c: Polyline = cur;
          const last = c.pts[c.pts.length - 1];
          if (c.pts.length > 1 && Math.hypot(last.x - start.x, last.y - start.y) < 1e-9) c.pts.pop();
          c.closed = true;
        }
        p = { ...start };
        cur = null;
        lastCtrl = null;
        // Z 다음에 명령 없이 숫자가 오면 안 되므로 cmd 초기화
        cmd = '';
        break;
      }
    }
    lastCmd = C;
  }
  return paths.filter((l) => l.pts.length > 1);
}
