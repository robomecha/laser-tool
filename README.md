# Laser Tool

LightBurn / RDWorks V8 스타일의 레이저 커팅·각인 소프트웨어 (TypeScript, 브라우저 기반).

벡터 도면과 이미지를 배치하고, **색상 레이어마다 가공 방식(라인/채우기/이미지)과 속도·출력을 지정**한 뒤
경로를 미리보기하고 **GRBL 레이저로 바로 전송**하거나 **G-code / Ruida(.rd) 파일로 내보냅니다.**

## 실행

```bash
npm install
npm run dev        # http://localhost:5173  (Chrome / Edge 권장 – Web Serial 필요)
npm test           # 단위 테스트
npm run build      # 타입 검사 + 배포용 빌드 (dist/)
```

## 주요 기능 (v0.1)

| 분류 | 기능 |
| --- | --- |
| 편집 | 선/폴리라인, 사각형, 타원 그리기 · 선택(클릭, 박스: 왼→오 포함 / 오→왼 걸침) · 이동/크기/회전 핸들 · 수치 입력(X/Y/W/H/회전) · 정렬 · 반전 · 90° 회전 · 작업대 중앙 · 복제/복사/붙여넣기 · 실행 취소/다시 실행 |
| 가져오기 | SVG(path/rect/circle/ellipse/line/polyline/polygon/내장 image, transform·단위·viewBox), DXF(LINE, LWPOLYLINE+bulge, POLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE 근사), PNG/JPG/BMP/GIF/WebP · 드래그 앤 드롭 |
| 레이어 | 30색 팔레트 (LightBurn 동일 개념) · 모드: 라인(컷) / 채우기(스캔) / 이미지 · 속도, 최대/최소 출력, 반복, 라인 간격, 각도, 양방향, 오버스캔, 디더링(Floyd-Steinberg, Atkinson, 임계값, 그레이스케일), 반전, 에어 어시스트, 출력/표시 토글 |
| 경로 생성 | 안쪽 도형 먼저 자르기 + 최근접 순서 최적화 · 짝홀 규칙 해칭(구멍 인식) · 이미지 리샘플→디더링→가변 출력 래스터 · 각인 → 절단 순서 |
| 미리보기 | 경로/공이동 표시, 진행 슬라이더·재생, 예상 시간·가공 거리 |
| 장비 | GRBL: Web Serial 연결, 스트리밍(문자 수 계산 방식), 일시정지/재개/정지, 프레임, 원점 복귀, 원점 설정, 조그, 콘솔 · Ruida: .rd 내보내기 + UDP 전송 도구 (실험적) |
| 파일 | 프로젝트 저장/열기 (`.ltp`, JSON) · G-code · RD |

## 단축키

| 키 | 동작 | 키 | 동작 |
| --- | --- | --- | --- |
| S / L / R / E / H | 선택 / 선 / 사각형 / 타원 / 화면 이동 | P | 미리보기 |
| Ctrl+Z / Ctrl+Y | 실행 취소 / 다시 실행 | F | 작업대 맞춤 |
| Ctrl+C / V / X / D | 복사 / 붙여넣기 / 잘라내기 / 복제 | Del | 삭제 |
| Ctrl+S / O / I | 저장 / 열기 / 가져오기 | 화살표 (+Shift) | 1mm (10mm) 이동 |
| Shift + 드래그 | 비율 해제·축 고정·15° 스냅 | Space/가운데 버튼 드래그 | 화면 이동 |
| Enter / 더블클릭 / 우클릭 | 폴리라인 완료 | Esc | 취소 |

## Ruida(RDWorks 컨트롤러) 사용

브라우저는 UDP 를 쓸 수 없으므로 `.rd` 파일을 내보낸 뒤 Node 도구로 전송합니다.

```bash
npm run ruida:send -- project.rd 192.168.1.100
```

> ⚠️ Ruida 프로토콜은 비공개라 공개 역공학 자료를 바탕으로 구현했습니다. 실제 장비에서는 **반드시 저출력으로 먼저 시험**하세요.
> GRBL 출력 역시 실제 기계에서 처음 사용할 때는 출력과 작업 영역을 확인하세요.

## 구조

자세한 설계와 LightBurn / RDWorks 기능 대응표, 로드맵은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 를 참고하세요.

```
src/
  core/    기하, 도형, 색상 레이어, 문서(실행 취소), 장비 설정
  io/      SVG / DXF / 이미지 가져오기, 프로젝트 파일
  cam/     경로 생성 (라인, 채우기, 래스터), Job, 시간 추정
  output/  G-code(GRBL), Ruida .rd
  device/  GRBL Web Serial 연결
  ui/      캔버스 편집기, 레이어 패널, 스타일
tools/     ruida-send.mjs (UDP 전송)
tests/     vitest 단위 테스트
```
