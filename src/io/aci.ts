// AutoCAD Color Index(ACI) 기본 색 → 팔레트 레이어
import { nearestPaletteIndex } from './color';

const ACI_BASIC: Record<number, [number, number, number]> = {
  1: [255, 0, 0],
  2: [255, 255, 0],
  3: [0, 255, 0],
  4: [0, 255, 255],
  5: [0, 0, 255],
  6: [255, 0, 255],
  7: [0, 0, 0],
  8: [128, 128, 128],
  9: [192, 192, 192],
};

export function nearestPaletteIndexFromAci(aci: number): number {
  return nearestPaletteIndex(ACI_BASIC[aci] ?? [0, 0, 0]);
}
