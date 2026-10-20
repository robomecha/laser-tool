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

## 실행 파일 (Windows exe)

```bash
npm run build:exe
```

`release/` 폴더에 다음이 만들어집니다. 이 폴더를 통째로 복사해 다른 PC 에서도 설치 없이 실행할 수 있습니다.

| 파일 | 설명 |
| --- | --- |
| `LaserTool.exe` | 더블클릭하면 Chrome(없으면 Edge) 앱 창으로 열립니다. 창을 모두 닫으면 종료됩니다. |
| `laser-tool.env.example` | AI 대화창용 API 키 (선택) – `laser-tool.env` 로 이름을 바꾸고 키 입력 |
| `사용법.txt` | 간단한 안내 |

* Node 단일 실행 파일(SEA) 에 앱 파일과 서버(`server/standalone.ts`)를 넣은 구조라 Node 설치가 필요 없습니다.
* 앱 창은 전용 프로필(`%LOCALAPPDATA%\LaserToolrowser`)을 써서 USB·글꼴 권한과 설정이 일반 브라우저와 섞이지 않습니다. 로그: `%LOCALAPPDATA%\LaserTool\log.txt`.
* 코드 서명이 없어 처음 실행 시 Windows SmartScreen 경고가 나오면 [추가 정보] → [실행].

## 주요 기능 (v0.1)

| 분류 | 기능 |
| --- | --- |
| 편집 | 선/폴리라인, 사각형, 타원, 정다각형·별, 텍스트(내장 나눔고딕 · PC 설치 글꼴 · TTF/OTF/WOFF/TTC 파일 → 경로 변환, 굵게·기울임·외곽선 굵기, 곡선 따라 쓰기) 그리기 · 오프셋(바깥/안쪽, 둥글게/뾰족하게/각지게) · 불리언(합치기/빼기/교집합) · 선택(클릭, 박스: 왼→오 포함 / 오→왼 걸침) · 이동/크기/회전 핸들 · 수치 입력(X/Y/W/H/회전) · 정렬 · 반전 · 90° 회전 · 작업대 중앙 · 잘라내기/복사/붙여넣기/복제 버튼 · 격자 배열·원형 배열 · 그리드 스냅(간격 입력, 켜기/끄기)·점 스냅(꼭짓점·중심) · 눈금 간격 1mm 단위 조정 · 실행 취소/다시 실행 |
| 가져오기 | SVG(path/rect/circle/ellipse/line/polyline/polygon/내장 image, transform·단위·viewBox), DXF(LINE, LWPOLYLINE+bulge, POLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE 근사), PNG/JPG/BMP/GIF/WebP · 드래그 앤 드롭 |
| 레이어 | 30색 팔레트 (LightBurn 동일 개념) · 모드: 라인(컷) / 채우기(스캔) / 이미지 · 속도, 최대/최소 출력, 반복, 라인 간격, 각도, 양방향, 오버스캔, 디더링(Floyd-Steinberg, Atkinson, 임계값, 그레이스케일), 반전, 에어 어시스트, 출력/표시 토글 |
| 경로 생성 | 안쪽 도형 먼저 자르기 + 최근접 순서 최적화 · 짝홀 규칙 해칭(구멍 인식) · 이미지 리샘플→디더링→가변 출력 래스터 · 각인 → 절단 순서 |
| 미리보기 | 경로/공이동 표시, 진행 슬라이더·재생, 예상 시간·가공 거리 |
| 장비 | GRBL: Web Serial 연결, 스트리밍(문자 수 계산 방식), 일시정지/재개/정지, 프레임, 원점 복귀, 원점 설정, 조그, 콘솔 · Ruida: USB 직접 연결(작업 전송·정지·프레임·조그·상태), .rd 내보내기 + UDP 전송 도구 (실험적) |
| 파일 | 프로젝트 저장/열기 (`.ltp`, JSON) · G-code · RD |
| 화면 | 한국어 / English 전환 (메뉴바 오른쪽 🌐) · 도움말 (F1) |

## 단축키

| 키 | 동작 | 키 | 동작 |
| --- | --- | --- | --- |
| S / L / R / E / N / T / H | 선택 / 선 / 사각형 / 타원 / 정다각형 / 텍스트 / 화면 이동 | P | 미리보기 |
| O | 선택 도형 오프셋 | Enter / Shift+Enter (텍스트) | 확정 / 줄바꿈 |
| Ctrl+Z / Ctrl+Y | 실행 취소 / 다시 실행 | F | 작업대 맞춤 |
| Ctrl+C / V / X / D | 복사 / 붙여넣기 / 잘라내기 / 복제 | Del | 삭제 |
| Ctrl+S / O / I | 저장 / 열기 / 가져오기 | 화살표 (+Shift) | 1mm (10mm) 이동 |
| Shift + 드래그 | 비율 해제·축 고정·15° 스냅 | Space/가운데 버튼 드래그 | 화면 이동 |
| G | 스냅 켜기/끄기 | Ctrl+Shift+A | 격자 배열 |
| C | AI 대화창 | F1 / ? | 도움말 |
| Enter / 더블클릭 / 우클릭 | 폴리라인 완료 | Esc | 취소 |

## Ruida(RDWorks 컨트롤러) 사용

### USB 연결 (실험적)

1. **Chrome 또는 Edge** 에서 http://localhost:5173 을 엽니다 (앱 내장 브라우저는 USB 포트 선택 불가).
2. [장비 설정] → 컨트롤러 **Ruida / RDWorks**, 원점 **오른쪽 위**(일반적인 Ruida 장비), 작업 영역 크기를 맞춥니다.
3. LightBurn / RDWorks 를 닫아 포트를 비운 뒤 [연결 (Ruida USB)] → **USB Serial Port (COMx)** 선택.
4. 상태·위치가 표시되면 [프레임] 으로 위치를 확인하고 [▶ 시작].

지원: 작업 전송·시작, 일시정지/재개, 정지, XY 원점 복귀, 프레임, 조그, 상태/위치 표시.
원점 설정은 컨트롤러 패널에서 합니다. 634XG 등 일부 모델은 swizzle magic 이 다릅니다 (장비 설정에서 변경, 634XG = 17).

### 네트워크(이더넷) 전송

브라우저는 UDP 를 쓸 수 없으므로 `.rd` 파일을 내보낸 뒤 Node 도구로 전송합니다.

```bash
npm run ruida:send -- project.rd 192.168.1.100
```

> ⚠️ Ruida 프로토콜은 비공개라 공개 역공학 자료를 바탕으로 구현했습니다. 실제 장비에서는 **반드시 저출력으로 먼저 시험**하세요.
> GRBL 출력 역시 실제 기계에서 처음 사용할 때는 출력과 작업 영역을 확인하세요.

## 앱 안에서 AI 와 대화하기

상단 **[💬 AI 대화]** (단축키 C) 를 누르면 대화창이 열립니다. 말로 요청하면 Claude 가 도형·텍스트를 그리고 레이어를 설정한 뒤 결과 이미지를 확인합니다.

1. [Claude Console](https://console.anthropic.com) 에서 API 키를 만듭니다 (사용량만큼 요금이 듭니다).
2. 프로젝트 폴더에 `.env.local` 파일을 만들고 한 줄을 넣습니다 (이 파일은 git 에 올라가지 않습니다):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. `npm run dev` 를 다시 실행하고 대화창에서 요청합니다.

* 키는 개발 서버(Node, `server/chat-plugin.ts`)에서만 쓰이고 브라우저로 보내지지 않습니다. 도구 실행은 브라우저에서 합니다.
* 모델: Claude Opus 5.5 (`claude-opus-5-5`), 안전 분류기가 거절하면 서버 측 fallback 으로 다른 모델이 이어받습니다.
* 대화창은 `npm run dev` 로 띄운 앱에서만 동작합니다 (`dist/` 정적 배포에는 서버가 없음).
* 도구 정의는 `src/ai/tool-defs.ts` 하나로 MCP 서버와 함께 씁니다.

## AI 로 그리기 (MCP)

Claude 같은 AI 가 MCP 도구로 작업대에 직접 도형·텍스트·SVG 를 그리고 레이어를 설정할 수 있습니다.

```
Claude ──MCP(stdio)──▶ tools/mcp-server.mjs ──WebSocket(127.0.0.1:47801)──▶ 브라우저 Laser Tool
```

1. `npm run dev` 로 앱을 열고 상단 **[🤖 AI 연결]** 을 누릅니다 (MCP 서버가 뜰 때까지 "대기 중"으로 자동 재시도).
2. MCP 클라이언트에 서버를 등록합니다.
   * **Claude Code**: 이 폴더에서 실행하면 `.mcp.json` 의 `laser-tool` 서버를 자동으로 제안합니다 (처음 한 번 승인).
   * **Claude Desktop**: Claude Desktop 을 **완전히 종료**(트레이 → Quit)한 뒤 `npm run mcp:register` 실행 → Claude 다시 시작.
     (실행 중에 설정 파일을 고치면 Claude 가 다시 저장하면서 지워질 수 있습니다.) 직접 넣으려면 `claude_desktop_config.json` 에:
     ```json
     { "mcpServers": { "laser-tool": { "command": "node", "args": ["C:/.../laser_tool/tools/mcp-server.mjs"] } } }
     ```
3. Claude 에게 요청합니다. 예: *"지름 60mm 원형 코스터를 만들어 줘. 가운데에 '커피' 를 새기고 바깥 원은 잘라."*

| 도구 | 설명 |
| --- | --- |
| `get_canvas_info` | 작업대 크기, 원점, 레이어 설정, 팔레트, 글꼴 |
| `draw_shapes` | 선, 폴리라인/다각형, (둥근) 사각형, 원, 타원, SVG path |
| `add_text` | 텍스트 → 경로 (나눔고딕 기본, 한글 지원) |
| `import_svg` | SVG 문서를 지정 위치·크기로 가져오기 |
| `list_shapes` / `transform_shapes` / `delete_shapes` / `set_shape_layer` | 도형 확인·이동·크기·회전·반전·삭제·레이어 변경 |
| `set_layer` | 모드(line/fill/image), 속도, 출력, 간격, 각도, 디더링 |
| `offset_shapes` / `boolean_shapes` | 오프셋, 합치기/빼기/교집합 |
| `preview_job` | 예상 시간·거리·경고 (레이저는 움직이지 않음) |
| `snapshot` | 작업대 PNG 이미지 (AI 가 결과를 보고 수정) |
| `undo` | 실행 취소 |

> 안전: 레이저 시작·프레임·조그는 MCP 로 제공하지 않습니다. AI 가 그린 뒤 사람이 미리보기(P)로 확인하고 직접 시작하세요.
> Claude Desktop 과 Claude Code 를 함께 써서 서버가 여러 개 떠도 괜찮습니다: 처음 뜬 서버가 브라우저와 연결하고, 나머지는 그 서버를 통해 중계합니다.
> WebSocket 은 127.0.0.1 에서만 열리고 localhost 페이지의 연결만 받습니다. 포트는 `LASER_MCP_PORT` 로 바꿀 수 있습니다 (앱 쪽 주소도 함께 변경 필요).

동작 확인: 앱에서 [AI 연결] 을 누른 뒤 `npm run mcp:test` (서버를 띄워 모든 도구를 호출하고 `mcp-snapshot.png` 저장).

## 구조

자세한 설계와 LightBurn / RDWorks 기능 대응표, 로드맵은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 를 참고하세요.

```
src/
  core/    기하, 도형, 색상 레이어, 문서(실행 취소), 장비 설정, 텍스트→경로, 오프셋/불리언(clip.ts)
  io/      SVG / DXF / 이미지 가져오기, 글꼴 읽기, 프로젝트 파일
  cam/     경로 생성 (라인, 채우기, 래스터), Job, 시간 추정
  output/  G-code(GRBL), Ruida .rd
  device/  GRBL / Ruida USB (Web Serial) 연결
  ui/      캔버스 편집기, 레이어 패널, 스타일
tools/     ruida-send.mjs (UDP 전송), mcp-server.mjs (AI 용 MCP 서버), mcp-smoke-test.mjs
  ai/      (src/ai) MCP 요청 처리기, 브라우저 WebSocket 연결
tests/     vitest 단위 테스트
```
