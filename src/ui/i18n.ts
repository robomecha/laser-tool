// 화면 언어 전환 (한국어 / English).
//
// 원문은 한국어로 쓰고, 화면의 글자(텍스트 노드와 title·placeholder 속성)를 사전으로 바꾼다.
// MutationObserver 로 나중에 생기는 글자(상태 표시줄, 레이어 목록, 대화상자 등)도 자동으로 바꾸며,
// 사전 키에 {0} {1} … 자리표시를 쓰면 숫자·이름이 들어간 문구도 맞춘다.
import { EN } from './i18n-en';

export type Lang = 'ko' | 'en';

const KEY = 'laser-tool.lang';
let lang: Lang = 'ko';
try {
  const saved = localStorage.getItem(KEY);
  if (saved === 'ko' || saved === 'en') lang = saved;
  else if (!navigator.language.toLowerCase().startsWith('ko')) lang = 'en';
} catch {
  /* 무시 */
}

export const getLang = (): Lang => lang;

// ---- 사전 ----

const exact = new Map<string, string>();
const patterns: { re: RegExp; out: string }[] = [];
for (const [rawKo, en] of Object.entries(EN)) {
  const ko = rawKo.replace(/\s+/g, ' ').trim();
  if (/\{\d\}/.test(ko)) {
    const src = ko.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d)\}/g, '(.+?)');
    patterns.push({ re: new RegExp(`^${src}$`, 's'), out: en });
  } else exact.set(ko, en);
}
const HANGUL = /[가-힣]/;

/** 한국어 원문 → 현재 언어 */
export function tr(ko: string): string {
  if (lang === 'ko' || !HANGUL.test(ko)) return ko;
  const lead = ko.match(/^\s*/)![0];
  const tail = ko.match(/\s*$/)![0];
  const core = ko.trim().replace(/\s+/g, ' ');
  const hit = exact.get(core);
  if (hit !== undefined) return lead + hit + tail;
  for (const p of patterns) {
    const m = p.re.exec(core);
    // 자리에 들어간 조각(예: '켜짐', '합치기')은 정확히 일치하는 항목만 바꾼다 (패턴 재귀 방지)
    if (m) return lead + p.out.replace(/\{(\d)\}/g, (_, i) => {
        const g = m[Number(i) + 1] ?? '';
        return exact.get(g.trim()) ?? g;
      }) + tail;
  }
  return ko;
}

/** 코드에서 쓰는 번역 함수 (confirm 문구 등 DOM 밖 문자열) */
export const t = (ko: string): string => tr(ko);

// ---- DOM ----

const ATTRS = ['title', 'placeholder', 'aria-label', 'label'] as const;
/** 노드별 원문과 마지막으로 넣은 번역 */
const textOrig = new WeakMap<Text, { ko: string; out: string }>();
const attrOrig = new WeakMap<Element, Record<string, { ko: string; out: string }>>();

function skip(el: Element | null): boolean {
  // 사용자 입력·AI 대화 내용·도움말 본문 등은 그대로 둔다
  return !!el?.closest('[data-no-i18n], script, style, textarea, .chat-log .msg.user, .chat-log .msg.assistant');
}

function doText(n: Text): void {
  if (skip(n.parentElement)) return;
  const rec = textOrig.get(n);
  if (rec && n.data === rec.out) {
    // 언어만 바뀐 경우 원문에서 다시 번역
    const out = tr(rec.ko);
    if (out !== n.data) {
      rec.out = out;
      n.data = out;
    }
    return;
  }
  if (!HANGUL.test(n.data) && !rec) return;
  const ko = n.data;
  const out = tr(ko);
  textOrig.set(n, { ko, out });
  if (out !== ko) n.data = out;
}

function doAttrs(el: Element): void {
  // 입력 상자 안의 글자는 그대로 두되 placeholder·title 은 번역한다
  if (el.closest('[data-no-i18n]')) return;
  let recs = attrOrig.get(el);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    const r = recs?.[a];
    if (r && v === r.out) {
      const out = tr(r.ko);
      if (out !== v) {
        r.out = out;
        el.setAttribute(a, out);
      }
      continue;
    }
    if (!HANGUL.test(v)) continue;
    const out = tr(v);
    recs ??= {};
    recs[a] = { ko: v, out };
    attrOrig.set(el, recs);
    if (out !== v) el.setAttribute(a, out);
  }
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  doAttrs(el);
  const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = it.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

let observer: MutationObserver | null = null;
const listeners: ((l: Lang) => void)[] = [];

export function onLangChange(fn: (l: Lang) => void): void {
  listeners.push(fn);
}

export function startI18n(): void {
  document.documentElement.lang = lang;
  walk(document.body);
  document.title = 'Laser Tool';
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* 무시 */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l;
    walk(document.body);
  }
  for (const fn of listeners) fn(l);
}
