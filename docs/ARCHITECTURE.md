# 설계 문서

## 1. 목표

LightBurn 의 편집·레이어 중심 작업 흐름과 RDWorks V8 의 Ruida 컨트롤러 지원을 참고한
크로스플랫폼 레이저 소프트웨어. 1단계는 브라우저 앱(Chrome/Edge)이며, 핵심 로직(`core`, `cam`, `io`, `output`)은
DOM 에 의존하지 않도록 분리해 추후 Electron/Tauri 데스크톱 앱이나 Node CLI 로 재사용한다.

## 2. 데이터 흐름

```
 SVG / DXF / 이미지 ──▶ io/*-import ──▶ Shape[] ─┐
                                                 ▼
 사용자 편집 (ui/canvas-view) ──────────▶ LaserDocument (도형 + 색상 레이어 + 실행 취소)
                                                 │
                                    cam/planner  ▼  레이어 모드별 경로 생성
                                  ┌──────────────┼──────────────┐
                            vector.ts        fill.ts        raster.ts
                                  └──────────────┼──────────────┘
                                                 ▼
                                        Job (컨트롤러 독립 중간 표현)
                         ┌───────────────────────┼───────────────────────┐
                 output/gcode.ts          output/ruida.ts           ui 미리보기 / 시간 추정
                         │                       │
            device/grbl-serial.ts       tools/ruida-send.mjs (UDP 50200)
```

### 좌표계
* 문서 좌표: mm, 작업대 왼쪽 위가 (0,0), **Y 는 아래로 증가** (화면·SVG 와 동일).
* 기계 좌표: 장비 설정의 원점 위치(`origin`)에 따라 `core/device.ts` 의 `toMachine()` 이 변환.
  GRBL 은 보통 왼쪽 아래, Ruida 는 보통 오른쪽 위.

### 도형 모델 (`core/shapes.ts`)
* `VectorShape`: 폴리라인 목록 + 아핀 변환. 곡선은 가져올 때 0.02mm 오차로 평탄화.
* `ImageShape`: data URL + 로컬 크기(mm) + 아핀 변환. 픽셀 데이터는 `io/image-import.ts` 에서 캐시.
* 모든 도형은 **색상 레이어 인덱스 하나**에 속한다 (LightBurn 과 동일한 방식).

### 텍스트 (`core/text.ts`)
* `opentype.js` 가 만든 경로 명령(M/L/Q/C/Z)을 0.02mm 오차로 평탄화한다. 글꼴 윤곽선은 항상 닫힌 것으로 처리한다
  (opentype.js 2.x 는 일부 TrueType 글꼴에서 Z 를 생략).
* 첫 줄 기준선의 정렬 기준점이 로컬 (0,0), 다음 줄은 +Y. 클릭 위치는 도형 `transform` 의 이동으로 들어간다.
* 기본 글꼴은 `@expo-google-fonts/nanum-gothic` 의 TTF (빌드 시 asset 으로 복사, 처음 쓸 때 내려받음). WOFF2 는 미지원.

### 오프셋 / 불리언 (`core/clip.ts`)
* Clipper 1 (`clipper-lib`) 사용, mm×1000 정수 좌표. (`clipper2-js` 는 결과 경로가 깨져 사용하지 않음)
* 각 도형의 닫힌 경로를 먼저 짝홀 규칙으로 정규화한 뒤 도형끼리는 NonZero 로 연산 → 도형 내부 구멍이 보존된다.
* 빼기는 **처음 선택한 도형**에서 나머지를 뺀다. 열린 경로는 불리언에서 무시, 오프셋(바깥)에서는 양쪽으로 두께를 준 외곽선이 된다.

### Job (`cam/job.ts`)
블록(레이어·패스 단위) 안에 `{x, y, p}` 이동 목록. `p<0` 급속 이동, `p=0` 레이저 끈 가공 속도 이동(오버스캔), `p>0` 출력 %.
출력기는 이 표현만 알면 되므로 새 컨트롤러(예: Marlin, Smoothieware, EZCAD 갈바노)를 추가하기 쉽다.

## 3. LightBurn / RDWorks 기능 대응

| LightBurn | RDWorks V8 | 이 프로젝트 | 상태 |
| --- | --- | --- | --- |
| Cuts / Layers 창 | Layer 패널 | `ui/layer-panel.ts` | ✅ |
| Line / Fill / Image 모드 | Cut / Scan / (Image) | `cam/vector.ts`, `fill.ts`, `raster.ts` | ✅ |
| Fill: Scan angle, Bi-directional, Overscan | Scan: 간격, 양방향 | 레이어 설정 | ✅ |
| Image: Dither 모드 | Bitmap 처리 | Floyd / Atkinson / Threshold / Grayscale | ✅ (Jarvis, Stucki 등 추가 예정) |
| Inner shapes first, Optimization | 가공 순서 | 안쪽 먼저 + 최근접 | ✅ (2-opt, 방향 최적화 예정) |
| Preview 창 | Simulate | 미리보기 바 | ✅ |
| Frame | Frame (Box) | 프레임 버튼 | ✅ |
| Move 창 (Jog) | Move / Origin | 조그 패널 | ✅ |
| Console | – | 콘솔 | ✅ |
| Device Settings | Vendor / User Settings | 장비 설정 대화상자 | ✅ (기본 항목) |
| GRBL 연결 | – | Web Serial | ✅ |
| Ruida 연결 | USB / Ethernet | .rd 내보내기 + UDP 도구 | 🧪 실험적 |
| Text 도구 | Text | `core/text.ts`, `io/font.ts`, `ui/text-tool.ts` | ✅ (생성 시 경로로 변환, 재편집 불가) |
| Offset, Boolean (Weld/Union/Subtract) | Offset | `core/clip.ts` (clipper-lib) | ✅ (오프셋, 합치기/빼기/교집합) |
| Node 편집 | Edit Nodes | – | ⏳ |
| Array / Grid copy | Array | – | ⏳ |
| Tabs/Bridges | – | – | ⏳ |
| Material Library | Layer 파라미터 저장 | – | ⏳ |
| Camera 정렬 | – | – | ⏳ |
| Rotary | Rotary | – | ⏳ |
| 시작 위치: Absolute / Current / User origin | 원점 | 절대 좌표만 | ⏳ |

## 4. 출력 형식

### GRBL G-code (`output/gcode.ts`)
* `M4`(동적 출력, 기본) 또는 `M3`, `S` 는 `0..$30`, `F` 는 mm/min.
* `G0` 는 레이저 모드에서 자동으로 꺼짐. 변경된 S/F 만 출력해 파일 크기를 줄인다.
* 스트리밍은 128바이트 수신 버퍼 기준 문자 수 계산 방식 (`device/grbl-serial.ts`).

### Ruida .rd (`output/ruida.ts`)
* 바이트 swizzle (bit0↔bit7, XOR 0x88, +1), 좌표 5바이트 7비트 인코딩(µm), 출력 14비트.
* 헤더(작업 범위), 레이어별 속도/출력/색상, 본문(`88` 이동, `A8` 가공), `D7` 종료.
* `disassembleRuida()` 로 생성 파일을 사람이 읽을 수 있는 형태로 확인 가능 (테스트에서 사용).
* 실제 RDWorks 가 생성하는 파일보다 단순한 부분집합이므로 컨트롤러 모델·펌웨어에 따라 동작이 다를 수 있다.

## 5. 로드맵

1. **편집 강화**: 텍스트 재편집(텍스트 도형 타입), 원/경로 위 텍스트, 노드 편집, 배열 복사, 그룹, 스냅(그리드·객체), 레이어 순서 변경
2. **CAM 강화**: 경로 2-opt 최적화, 방향 지정, 리드인/아웃, 탭, 코너 감속, 채우기 "도형별" 모드, 크로스해치
3. **장비**: 시작 위치 옵션(현재 위치/사용자 원점), 작업 재개, 재료 라이브러리, Ruida 실시간 제어(조그/프레임), Marlin/Smoothie
4. **데스크톱 패키징**: Electron 또는 Tauri (USB·UDP 네이티브 접근, 파일 연동)
5. **카메라**: 작업대 오버레이·정렬

## 6. 테스트

`npm test` – 기하/파서/경로/출력기 단위 테스트 (vitest). DOM 이 필요한 부분(SVG DOM 순회, 캔버스, Web Serial)은 브라우저에서 수동 확인.
