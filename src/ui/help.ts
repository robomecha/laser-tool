// 도움말 대화상자 (F1). 내용은 언어별 HTML.
import { getLang, Lang } from './i18n';

interface Section {
  id: string;
  title: Record<Lang, string>;
  body: Record<Lang, string>;
}

const kbd = (k: string) => `<kbd>${k}</kbd>`;

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: { ko: '시작하기', en: 'Getting started' },
    body: {
      ko: `<ol>
<li><b>장비 설정</b>에서 작업 영역 크기와 원점 위치(GRBL 보통 왼쪽 아래, Ruida 보통 오른쪽 위)를 맞춥니다.</li>
<li>도형을 그리거나 SVG·DXF·이미지를 <b>가져오기</b>(또는 화면에 끌어다 놓기) 합니다.</li>
<li>아래 <b>색상 팔레트</b>로 도형의 레이어를 정하고, 오른쪽 <b>가공 레이어</b>에서 모드·속도·출력을 설정합니다.</li>
<li>${kbd('P')} <b>미리보기</b>로 경로와 예상 시간을 확인합니다.</li>
<li>레이저를 <b>연결</b>하고 <b>프레임</b>으로 위치를 확인한 뒤 <b>▶ 시작</b>.</li>
</ol>
<p class="warn">⚠ 레이저 작업 중에는 자리를 비우지 말고 보안경·환기·소화기를 준비하세요. 처음 쓰는 설정은 낮은 출력으로 시험하세요.</p>`,
      en: `<ol>
<li>In <b>Device settings</b>, set the work area size and the machine origin (GRBL is usually bottom-left, Ruida usually top-right).</li>
<li>Draw shapes or <b>Import</b> SVG, DXF or images (you can also drag files onto the canvas).</li>
<li>Pick a layer for the shapes with the <b>color palette</b> at the bottom, then set mode, speed and power in <b>Cuts / Layers</b> on the right.</li>
<li>Press ${kbd('P')} to <b>Preview</b> the toolpath and estimated time.</li>
<li><b>Connect</b> the laser, use <b>Frame</b> to check the position, then <b>▶ Start</b>.</li>
</ol>
<p class="warn">⚠ Never leave a running laser unattended. Wear laser goggles, ventilate, and keep an extinguisher nearby. Test new settings at low power first.</p>`,
    },
  },
  {
    id: 'draw',
    title: { ko: '그리기와 편집', en: 'Drawing and editing' },
    body: {
      ko: `<ul>
<li><b>도구</b> (왼쪽): 선택 ${kbd('S')}, 선/폴리라인 ${kbd('L')} (더블클릭·Enter·우클릭으로 완료, 첫 점 클릭 시 닫힘), 사각형 ${kbd('R')}, 타원 ${kbd('E')}, 텍스트 ${kbd('T')}, 화면 이동 ${kbd('H')}. ${kbd('Shift')} 를 누르면 정사각형/원, 45° 각도.</li>
<li><b>선택</b>: 클릭, ${kbd('Shift')}/${kbd('Ctrl')}+클릭으로 추가. 왼쪽→오른쪽 박스는 완전히 포함된 도형, 오른쪽→왼쪽 박스는 걸친 도형을 선택합니다.</li>
<li><b>변형</b>: 모서리 핸들(비율 유지, ${kbd('Shift')} 자유), 가장자리 핸들, 위쪽 초록 핸들로 회전(${kbd('Shift')} 15° 단위). 상단 X·Y·W·H·회전 칸에 숫자로도 입력합니다. 화살표 키로 1mm(${kbd('Shift')} 10mm) 이동.</li>
<li><b>편집</b>: 잘라내기·복사·붙여넣기·복제·삭제, 정렬, 반전, 90° 회전, 작업대 중앙.</li>
<li><b>배열</b>: ▦ 격자 배열(행·열, 간격 또는 중심 거리), ◌ 원형 배열(개수, 각도, 회전 중심, 복사본 회전).</li>
<li><b>오프셋 / 불리언</b>: 선택 도형의 바깥(+)·안쪽(−) 윤곽 만들기, 합치기·빼기(처음 선택한 도형에서 나머지를 뺌)·교집합.</li>
<li><b>스냅</b>: 상단 오른쪽에서 눈금 간격(1mm 단위), 스냅 켜기/끄기(${kbd('G')})와 간격, 점 스냅(꼭짓점·중심에 붙기)을 설정합니다.</li>
</ul>`,
      en: `<ul>
<li><b>Tools</b> (left): Select ${kbd('S')}, Line/polyline ${kbd('L')} (finish with double-click, Enter or right-click; click the first point to close), Rectangle ${kbd('R')}, Ellipse ${kbd('E')}, Text ${kbd('T')}, Pan ${kbd('H')}. Hold ${kbd('Shift')} for squares/circles and 45° angles.</li>
<li><b>Selecting</b>: click, ${kbd('Shift')}/${kbd('Ctrl')}+click to add. A left-to-right box selects shapes fully inside it; a right-to-left box selects anything it touches.</li>
<li><b>Transform</b>: corner handles keep proportions (${kbd('Shift')} for free), edge handles stretch, the green handle rotates (${kbd('Shift')} snaps to 15°). You can also type X, Y, W, H and rotation in the top bar. Arrow keys nudge 1mm (${kbd('Shift')} 10mm).</li>
<li><b>Edit</b>: cut, copy, paste, duplicate, delete, align, mirror, rotate 90°, center on bed.</li>
<li><b>Arrays</b>: ▦ grid array (rows and columns, gap or center pitch), ◌ circular array (count, angle, center, rotate copies).</li>
<li><b>Offset / Boolean</b>: make outward (+) or inward (−) outlines; union, subtract (removes the others from the first-selected shape) and intersect.</li>
<li><b>Snap</b>: at the top right set the grid spacing (1mm steps), snap on/off (${kbd('G')}) and step, and point snap (sticks to corners and centers).</li>
</ul>`,
    },
  },
  {
    id: 'text',
    title: { ko: '텍스트와 글꼴', en: 'Text and fonts' },
    body: {
      ko: `<ul>
<li>텍스트 도구 ${kbd('T')} 로 작업대를 클릭하고 입력합니다. ${kbd('Enter')} 확정, ${kbd('Shift')}+${kbd('Enter')} 줄바꿈, ${kbd('Esc')} 취소. 글자는 레이저용 윤곽선(경로)으로 바뀝니다.</li>
<li><b>글꼴</b>: 내장 나눔고딕, <b>🖥 PC 글꼴</b>(Windows 에 설치된 글꼴 – Chrome/Edge, 처음에 권한 허용), <b>글꼴 파일…</b>(TTF·OTF·WOFF·TTC).</li>
<li><b>굵게 / 기울임</b>: 같은 글꼴에 Bold·Italic 이 있으면 그것을 쓰고, 없으면 합성합니다. <b>외곽선 굵기</b>로 획을 더 두껍게(+)·가늘게(−).</li>
<li><b>곡선 따라 쓰기</b>: 선택 도구로 원·선·경로를 선택 → 텍스트 도구 막대의 <b>〰 곡선 따라 쓰기…</b>. 원은 위치 75% 가 위쪽, 아래쪽 글자는 "안쪽" + "반대 방향".</li>
<li><b>수정</b>: 텍스트를 <b>더블클릭</b>하거나, 선택하고 ${kbd('Enter')} 또는 <b>✎ 텍스트 수정</b>. 텍스트 도구로 기존 글자를 클릭해도 됩니다. 내용·글꼴·크기·스타일을 바꿔도 위치·회전은 유지됩니다.</li>
<li>채우기(각인)하려면 텍스트를 <b>채우기</b> 모드 레이어에 두세요.</li>
</ul>`,
      en: `<ul>
<li>With the Text tool ${kbd('T')}, click the bed and type. ${kbd('Enter')} confirms, ${kbd('Shift')}+${kbd('Enter')} adds a line, ${kbd('Esc')} cancels. Letters become laser outlines (paths).</li>
<li><b>Fonts</b>: built-in Nanum Gothic, <b>🖥 PC fonts</b> (fonts installed in Windows – Chrome/Edge, allow the permission the first time), <b>Font file…</b> (TTF, OTF, WOFF, TTC).</li>
<li><b>Bold / Italic</b>: uses the font's own Bold/Italic when it has one, otherwise synthesizes it. <b>Outline weight</b> makes strokes thicker (+) or thinner (−).</li>
<li><b>Text on a curve</b>: select a circle, line or path with the Select tool → <b>〰 Text on curve…</b> in the text bar. On a circle, position 75% is the top; for text at the bottom use "inside" + "reverse".</li>
<li><b>Editing</b>: <b>double-click</b> the text, or select it and press ${kbd('Enter')} or <b>✎ Edit text</b>. Clicking existing text with the Text tool works too. Changing content, font, size or style keeps its position and rotation.</li>
<li>To engrave (fill) text, put it on a layer in <b>Fill</b> mode.</li>
</ul>`,
    },
  },
  {
    id: 'layers',
    title: { ko: '레이어와 가공 설정', en: 'Layers and settings' },
    body: {
      ko: `<ul>
<li>도형의 <b>색 = 레이어</b>입니다. 도형을 선택하고 아래 팔레트 색을 누르면 그 레이어로 옮겨집니다.</li>
<li><b>라인(컷)</b>: 선을 따라 자르거나 긋기. 안쪽 도형부터 자릅니다.</li>
<li><b>채우기</b>: 닫힌 도형 안을 줄 간격(예: 0.1mm)으로 스캔해 각인. 각도·양방향·오버스캔 설정.</li>
<li><b>이미지</b>: 사진 각인. 디더링(Floyd-Steinberg, Atkinson, 임계값, 그레이스케일) 선택, 줄 간격으로 해상도(DPI) 결정.</li>
<li>출력 순서: 이미지 → 채우기 → 라인 (자른 조각이 움직이기 전에 각인).</li>
<li><b>가공</b> 체크를 끄면 출력하지 않고(가이드선), <b>보기</b>를 끄면 화면에서 숨깁니다.</li>
</ul>`,
      en: `<ul>
<li>A shape's <b>color is its layer</b>. Select shapes and click a palette color to move them to that layer.</li>
<li><b>Line (cut)</b>: cuts or scores along the path; inner shapes are cut first.</li>
<li><b>Fill</b>: scans the inside of closed shapes at the line interval (e.g. 0.1mm) to engrave. Set angle, bidirectional and overscan.</li>
<li><b>Image</b>: photo engraving. Choose dithering (Floyd-Steinberg, Atkinson, threshold, grayscale); the line interval sets the resolution (DPI).</li>
<li>Output order: image → fill → line (engrave before cut pieces can move).</li>
<li>Untick <b>Output</b> to skip a layer (guide lines); untick <b>Show</b> to hide it.</li>
</ul>`,
    },
  },
  {
    id: 'laser',
    title: { ko: '레이저 연결', en: 'Connecting the laser' },
    body: {
      ko: `<ul>
<li>USB 연결은 <b>Chrome 또는 Edge</b>에서 http://localhost:5173 을 열어야 합니다 (앱 내장 브라우저는 포트 선택 불가).</li>
<li><b>GRBL</b>: 장비 설정에서 컨트롤러 GRBL → [연결] → 포트 선택. 시작·일시정지·정지, 프레임, 원점 복귀, 원점 설정, 잠금 해제, 조그, 콘솔(G-code 직접 입력).</li>
<li><b>Ruida (RDWorks)</b>: 컨트롤러 Ruida, 원점 오른쪽 위 → <b>LightBurn·RDWorks 를 닫고</b> [연결 (Ruida USB)] → <b>USB Serial Port (COMx)</b>. 작업 전송·정지·프레임·조그·상태 표시 (실험적).</li>
<li><b>Ruida 이더넷</b>: [RD 파일] 로 내보낸 뒤 <code>npm run ruida:send -- 파일.rd 192.168.1.100</code>.</li>
<li>연결이 안 되면: 다른 프로그램이 포트를 쓰는지, 케이블·드라이버(CH340/FTDI), 통신 속도를 확인하세요.</li>
</ul>`,
      en: `<ul>
<li>USB needs <b>Chrome or Edge</b> at http://localhost:5173 (the in-app browser can't pick serial ports).</li>
<li><b>GRBL</b>: set the controller to GRBL in Device settings → [Connect] → choose the port. Start, pause, stop, frame, home, set origin, unlock, jog and a console for raw G-code.</li>
<li><b>Ruida (RDWorks)</b>: controller Ruida, origin top-right → <b>close LightBurn/RDWorks</b> → [Connect (Ruida USB)] → <b>USB Serial Port (COMx)</b>. Send job, stop, frame, jog and status (experimental).</li>
<li><b>Ruida over Ethernet</b>: export with [RD file], then <code>npm run ruida:send -- file.rd 192.168.1.100</code>.</li>
<li>If it won't connect: check that no other program holds the port, the cable and driver (CH340/FTDI), and the baud rate.</li>
</ul>`,
    },
  },
  {
    id: 'ai',
    title: { ko: 'AI 로 그리기', en: 'Drawing with AI' },
    body: {
      ko: `<ul>
<li><b>💬 AI 대화</b> ${kbd('C')}: 말로 요청하면 Claude 가 그리고 결과를 확인합니다. 프로젝트 폴더의 <code>.env.local</code> 에 <code>ANTHROPIC_API_KEY</code> 가 필요합니다 (API 사용량 요금).</li>
<li><b>키 없이</b>: Claude Desktop 채팅에서 “laser-tool 로 … 만들어 줘” 라고 요청하세요. 상단 <b>🤖 AI 연결</b> 이 켜져 있으면 이 화면에 바로 그려집니다.</li>
<li>AI 는 그리기·설정만 하고 레이저 시작은 하지 않습니다. 미리보기로 확인한 뒤 직접 시작하세요.</li>
</ul>`,
      en: `<ul>
<li><b>💬 AI chat</b> ${kbd('C')}: describe what you want and Claude draws it and checks the result. Needs <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> in the project folder (billed per API use).</li>
<li><b>Without a key</b>: ask in Claude Desktop, e.g. “use laser-tool to make …”. With <b>🤖 AI link</b> on, it draws straight onto this screen.</li>
<li>AI only draws and sets layers; it never starts the laser. Check the preview and start it yourself.</li>
</ul>`,
    },
  },
  {
    id: 'keys',
    title: { ko: '단축키', en: 'Shortcuts' },
    body: {
      ko: `<table class="keys">
<tr><td>${kbd('S')} ${kbd('L')} ${kbd('R')} ${kbd('E')} ${kbd('T')} ${kbd('H')}</td><td>선택 / 선 / 사각형 / 타원 / 텍스트 / 화면 이동</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('Z')} / ${kbd('Ctrl')}+${kbd('Y')}</td><td>실행 취소 / 다시 실행</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('X')} ${kbd('C')} ${kbd('V')} ${kbd('D')}</td><td>잘라내기 / 복사 / 붙여넣기 / 복제</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('A')} · ${kbd('Ctrl')}+${kbd('Shift')}+${kbd('A')}</td><td>모두 선택 · 격자 배열</td></tr>
<tr><td>${kbd('Del')}</td><td>삭제</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('S')} ${kbd('O')} ${kbd('I')}</td><td>저장 / 열기 / 가져오기</td></tr>
<tr><td>${kbd('P')} · ${kbd('F')} · ${kbd('G')} · ${kbd('C')}</td><td>미리보기 · 작업대 맞춤 · 스냅 켜기/끄기 · AI 대화</td></tr>
<tr><td>화살표 (+${kbd('Shift')})</td><td>1mm (10mm) 이동</td></tr>
<tr><td>${kbd('Space')} 또는 가운데 버튼 드래그 · 휠</td><td>화면 이동 · 확대/축소</td></tr>
<tr><td>${kbd('F1')}</td><td>도움말</td></tr>
</table>`,
      en: `<table class="keys">
<tr><td>${kbd('S')} ${kbd('L')} ${kbd('R')} ${kbd('E')} ${kbd('T')} ${kbd('H')}</td><td>Select / Line / Rectangle / Ellipse / Text / Pan</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('Z')} / ${kbd('Ctrl')}+${kbd('Y')}</td><td>Undo / Redo</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('X')} ${kbd('C')} ${kbd('V')} ${kbd('D')}</td><td>Cut / Copy / Paste / Duplicate</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('A')} · ${kbd('Ctrl')}+${kbd('Shift')}+${kbd('A')}</td><td>Select all · Grid array</td></tr>
<tr><td>${kbd('Del')}</td><td>Delete</td></tr>
<tr><td>${kbd('Ctrl')}+${kbd('S')} ${kbd('O')} ${kbd('I')}</td><td>Save / Open / Import</td></tr>
<tr><td>${kbd('P')} · ${kbd('F')} · ${kbd('G')} · ${kbd('C')}</td><td>Preview · Zoom to bed · Toggle snap · AI chat</td></tr>
<tr><td>Arrows (+${kbd('Shift')})</td><td>Nudge 1mm (10mm)</td></tr>
<tr><td>${kbd('Space')} or middle-button drag · wheel</td><td>Pan · Zoom</td></tr>
<tr><td>${kbd('F1')}</td><td>Help</td></tr>
</table>`,
    },
  },
  {
    id: 'files',
    title: { ko: '파일', en: 'Files' },
    body: {
      ko: `<ul>
<li><b>저장 / 열기</b>: 프로젝트 파일 <code>.ltp</code> (도형, 레이어 설정, 이미지 포함).</li>
<li><b>가져오기</b>: SVG(텍스트는 미리 '패스로 변환'), DXF(LINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE 근사), PNG·JPG·BMP·GIF·WebP.</li>
<li><b>내보내기</b>: GRBL G-code, Ruida <code>.rd</code> (실험적).</li>
</ul>
<p>문의: <a href="mailto:mk1017sh@naver.com">mk1017sh@naver.com</a></p>`,
      en: `<ul>
<li><b>Save / Open</b>: project files <code>.ltp</code> (shapes, layer settings and images).</li>
<li><b>Import</b>: SVG (convert text to paths first), DXF (LINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE, approximate SPLINE), PNG, JPG, BMP, GIF, WebP.</li>
<li><b>Export</b>: GRBL G-code, Ruida <code>.rd</code> (experimental).</li>
</ul>
<p>Contact: <a href="mailto:mk1017sh@naver.com">mk1017sh@naver.com</a></p>`,
    },
  },
];

export class HelpDialog {
  private dlg = document.getElementById('help-dialog') as HTMLDialogElement;
  private current = 'start';

  constructor() {
    this.dlg.querySelector<HTMLButtonElement>('.help-close')!.onclick = () => this.dlg.close();
    this.dlg.addEventListener('click', (e) => {
      if (e.target === this.dlg) this.dlg.close(); // 바깥 클릭으로 닫기
    });
  }

  open(section?: string): void {
    if (section) this.current = section;
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  render(): void {
    const lang = getLang();
    const nav = this.dlg.querySelector('.help-nav')!;
    const body = this.dlg.querySelector('.help-body')!;
    nav.replaceChildren(
      ...SECTIONS.map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = s.title[lang];
        b.className = s.id === this.current ? 'active' : '';
        b.dataset.noI18n = '';
        b.onclick = () => {
          this.current = s.id;
          this.render();
        };
        return b;
      }),
    );
    const sec = SECTIONS.find((s) => s.id === this.current) ?? SECTIONS[0];
    body.innerHTML = `<h3>${sec.title[lang]}</h3>${sec.body[lang]}`;
    this.dlg.querySelector('.help-title')!.textContent = lang === 'ko' ? '도움말' : 'Help';
  }
}
