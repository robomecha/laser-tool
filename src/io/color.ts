import { PALETTE } from '../core/layers';

export function parseColor(c: string | null | undefined): [number, number, number] | null {
  if (!c) return null;
  c = c.trim().toLowerCase();
  if (c === 'none' || c === 'transparent') return null;
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(([^)]*)\)/.exec(c);
  if (m) {
    const p = m[1].split(/[\s,]+/).map((x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x)));
    return [p[0], p[1], p[2]];
  }
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], lime: [0, 255, 0],
    yellow: [255, 255, 0], orange: [255, 165, 0], cyan: [0, 255, 255], magenta: [255, 0, 255],
    gray: [128, 128, 128], grey: [128, 128, 128], white: [255, 255, 255], purple: [128, 0, 128],
  };
  return named[c] ?? null;
}

export function nearestPaletteIndex(rgb: [number, number, number] | null, fallback = 0): number {
  if (!rgb) return fallback;
  let best = fallback;
  let bd = Infinity;
  PALETTE.forEach((hex, i) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
