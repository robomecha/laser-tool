/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { textToPolylines } from '../src/core/text';
import { collectionSize, fontFamilyStyle, fontName, parseFont } from '../src/io/font';

// Windows 에 기본으로 있는 글꼴 묶음 (.ttc). 다른 OS 에서는 건너뛴다.
const TTC = 'C:/Windows/Fonts/gulim.ttc';
const load = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe.skipIf(!existsSync(TTC))('TrueType collection (.ttc)', () => {
  it('extracts each font in the collection and renders Hangul', () => {
    const buf = load(TTC);
    const n = collectionSize(buf);
    expect(n).toBeGreaterThan(1);
    const f = parseFont(buf);
    expect(fontFamilyStyle(f).family.length).toBeGreaterThan(0);
    expect(textToPolylines(f, '가나다', { size: 10 }).length).toBeGreaterThan(3);
    expect(fontName(parseFont(buf, 'Dotum'), 'postScriptName', 'en')).toBe('Dotum');
    expect(fontFamilyStyle(parseFont(buf, 'Dotum')).family).toBe('돋움');
  });
});
