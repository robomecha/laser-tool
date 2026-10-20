import { describe, expect, it } from 'vitest';
import { EN } from '../src/ui/i18n-en';
import { getLang, setLang, tr } from '../src/ui/i18n';

setLang('en');

describe('i18n', () => {
  it('switches language', () => {
    expect(getLang()).toBe('en');
  });

  it('translates exact strings and keeps surrounding whitespace', () => {
    expect(tr('저장')).toBe('Save');
    expect(tr('  취소 ')).toBe('  Cancel ');
    expect(tr('Already English')).toBe('Already English');
  });

  it('fills placeholders and translates exact sub-strings', () => {
    expect(tr('도형 3개를 복사했습니다 (Ctrl+V 로 붙여넣기)')).toBe('Copied 3 shapes (Ctrl+V to paste)');
    expect(tr('스냅 꺼짐 (1 mm)')).toBe('Snap off (1 mm)');
    expect(tr('오프셋 바깥 2 mm: 도형 1개 생성')).toBe('Offset outward 2 mm: 1 shapes created');
  });

  it('every translation keeps the same placeholders as its source', () => {
    for (const [ko, en] of Object.entries(EN)) {
      const ph = (s: string) => [...s.matchAll(/\{(\d)\}/g)].map((m) => m[1]).sort().join(',');
      expect(ph(en), ko).toBe(ph(ko));
      expect(/[가-힣]/.test(en), `${ko} → ${en}`).toBe(false);
    }
  });
});
