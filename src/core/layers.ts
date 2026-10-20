// 색상 기반 레이어(LightBurn "Cuts / Layers", RDWorks "Layer" 패널과 같은 개념).
// 도형은 색상 인덱스 하나에 속하고, 그 색상 레이어의 가공 설정으로 출력된다.

/** 가공 모드. RDWorks 의 Cut / Scan / (Image) 에 해당 */
export type LayerMode = 'line' | 'fill' | 'image';

export type DitherMode = 'threshold' | 'floyd' | 'atkinson' | 'grayscale';

export interface LayerSettings {
  index: number;
  name: string;
  mode: LayerMode;
  /** mm/s */
  speed: number;
  /** 최대 출력 % (0~100) */
  power: number;
  /** 최소 출력 % (코너 감속 시 / 그레이스케일 하한) */
  minPower: number;
  passes: number;
  /** 채우기/이미지 라인 간격 mm */
  interval: number;
  /** 채우기 각도 (deg) */
  angle: number;
  bidirectional: boolean;
  /** 채우기/이미지 라인 끝 가속 여유 거리 mm */
  overscan: number;
  dither: DitherMode;
  /** 이미지 반전 */
  negative: boolean;
  airAssist: boolean;
  output: boolean;
  show: boolean;
}

/** LightBurn 기본 팔레트와 유사한 30색 */
export const PALETTE: string[] = [
  '#000000', '#0000ff', '#ff0000', '#00e000', '#d0d000', '#ff8000', '#00e0e0', '#ff00ff',
  '#b4b4b4', '#0000a0', '#a00000', '#00a000', '#a0a000', '#c08000', '#00a0ff', '#a000a0',
  '#808080', '#7d87b9', '#bb7784', '#4a6fe3', '#d33f6a', '#8cd78c', '#f0b98d', '#f6c4e1',
  '#fa9ed4', '#500a78', '#b45a00', '#004754', '#86fa88', '#ffdb66',
];

export function layerColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

export function defaultLayer(index: number): LayerSettings {
  return {
    index,
    name: `C${String(index).padStart(2, '0')}`,
    mode: 'line',
    speed: 20,
    power: 50,
    minPower: 10,
    passes: 1,
    interval: 0.1,
    angle: 0,
    bidirectional: true,
    overscan: 2.5,
    dither: 'floyd',
    negative: false,
    airAssist: true,
    output: true,
    show: true,
  };
}
