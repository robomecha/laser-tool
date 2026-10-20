// 장비(레이저 기계) 설정. LightBurn 의 Device Settings / RDWorks 의 Vendor Settings 일부에 해당.

export type OriginCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type ControllerKind = 'grbl' | 'ruida';

export interface DeviceSettings {
  name: string;
  controller: ControllerKind;
  /** 작업 영역 mm */
  bedWidth: number;
  bedHeight: number;
  /** 기계 원점 위치 */
  origin: OriginCorner;
  /** GRBL $30 (최대 S 값) */
  sMax: number;
  /** 공이동 속도 mm/s */
  travelSpeed: number;
  /** GRBL: M4 (가변 출력 레이저 모드) 사용 */
  dynamicPower: boolean;
  /** 프레이밍 시 저출력 레이저 켜기 (%) – 0 이면 끔 */
  framePower: number;
  baudRate: number;
  /** Ruida 컨트롤러 IP (tools/ruida-send.mjs 에서 사용) */
  ruidaHost: string;
  /** Ruida swizzle magic: 대부분 0x88(136), 634XG 는 0x11(17) */
  ruidaMagic: number;
}

export function defaultDevice(): DeviceSettings {
  return {
    name: 'My Laser',
    controller: 'grbl',
    bedWidth: 400,
    bedHeight: 300,
    origin: 'bottom-left',
    sMax: 1000,
    travelSpeed: 100,
    dynamicPower: true,
    framePower: 0,
    baudRate: 115200,
    ruidaHost: '192.168.1.100',
    ruidaMagic: 0x88,
  };
}

const KEY = 'laser-tool.device';

export function loadDevice(): DeviceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultDevice(), ...JSON.parse(raw) };
  } catch {
    /* 저장소 사용 불가 – 기본값 사용 */
  }
  return defaultDevice();
}

export function saveDevice(d: DeviceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* 무시 */
  }
}

/** 문서 좌표(mm, 좌상단 원점, Y 아래) → 기계 좌표 */
export function toMachine(d: DeviceSettings, x: number, y: number): { x: number; y: number } {
  switch (d.origin) {
    case 'top-left':
      return { x, y };
    case 'top-right':
      return { x: d.bedWidth - x, y };
    case 'bottom-left':
      return { x, y: d.bedHeight - y };
    case 'bottom-right':
      return { x: d.bedWidth - x, y: d.bedHeight - y };
  }
}

/** 기계 좌표 → 문서 좌표 (toMachine 의 역변환. 각 축이 자기 자신의 역함수) */
export function fromMachine(d: DeviceSettings, x: number, y: number): { x: number; y: number } {
  return toMachine(d, x, y);
}
