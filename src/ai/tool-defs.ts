// AI 도구 정의 – MCP 서버(tools/mcp-server.mjs)와 앱 내장 대화창(vite 서버 /api/chat)이 함께 쓴다.
// Node 가 이 파일을 직접 불러오므로(타입 제거 실행) 지울 수 있는 TypeScript 문법만 쓴다.
import { z } from 'zod';

export const INSTRUCTIONS = [
  'Laser Tool(레이저 커팅/각인 편집기)을 조작한다. 좌표 단위는 mm, 작업대 왼쪽 위가 (0,0)이고 Y 는 아래로 증가한다.',
  '도형은 색상 레이어(0~29)에 속하고 레이어마다 가공 모드가 있다: line=선 따라 절단, fill=닫힌 도형 내부 스캔 각인, image=비트맵 각인.',
  '작업 순서: get_canvas_info 로 작업대 크기 확인 → draw_shapes / add_text / import_svg 로 그리기 → set_layer 로 가공 설정 → snapshot 으로 결과 확인 후 수정.',
  '복잡한 그림(일러스트, 패턴, 로고)은 SVG 를 작성해 import_svg 로 넣는 것이 편하다. 각인할 면은 닫힌 도형으로 만들고 fill 레이어에 둔다.',
  '레이저 가공 시작은 사용자가 앱에서 직접 한다. 끝나면 사용자에게 미리보기(P)로 확인 후 시작하라고 안내한다.',
];

const layer = z.number().int().min(0).max(29).optional().describe('색상 레이어 0~29 (생략 시 현재 레이어)');
const pt = z.tuple([z.number(), z.number()]);
const common = { layer, name: z.string().optional() };
const shapeSpec = z.discriminatedUnion('type', [
  z.object({ type: z.literal('line'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), ...common }),
  z.object({ type: z.literal('polyline'), points: z.array(pt).min(2), closed: z.boolean().optional(), ...common }),
  z.object({ type: z.literal('rect'), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), radius: z.number().min(0).optional().describe('모서리 둥글기 mm'), ...common }),
  z.object({ type: z.literal('circle'), cx: z.number(), cy: z.number(), r: z.number().positive(), ...common }),
  z.object({ type: z.literal('ellipse'), cx: z.number(), cy: z.number(), rx: z.number().positive(), ry: z.number().positive(), ...common }),
  z.object({ type: z.literal('path'), d: z.string().describe('SVG path 데이터, mm 단위 문서 좌표'), ...common }),
]);
const ids = z.array(z.string()).min(1).describe('도형 id 목록 (list_shapes / draw 결과에서 얻음)');

export interface ToolDef {
  name: string;
  description: string;
  shape: Record<string, z.ZodType>;
  /** 결과가 이미지(PNG base64 + 설명)인 도구 */
  image?: boolean;
}

export const TOOL_DEFS: ToolDef[] = [
  { name: 'get_canvas_info', description: '작업대 크기, 원점, 사용 중 레이어와 설정, 도형 수, 팔레트 색, 사용 가능한 글꼴을 돌려준다.', shape: {} },
  {
    name: 'draw_shapes',
    description: '도형을 그린다 (선, 폴리라인/다각형, 사각형, 원, 타원, SVG path). 만든 도형 id 를 돌려준다.',
    shape: { shapes: z.array(shapeSpec).min(1) },
  },
  {
    name: 'add_text',
    description: '텍스트를 글꼴 윤곽선 경로로 변환해 추가한다 (한글 지원 나눔고딕 기본).',
    shape: {
      text: z.string().min(1).describe('줄바꿈은 \\n'),
      x: z.number(),
      y: z.number(),
      size: z.number().positive().describe('글자 크기 mm (em 높이)'),
      anchor: z.enum(['top-left', 'center', 'baseline-left']).optional().describe('x,y 기준점 (기본 top-left: 글자 영역 왼쪽 위)'),
      align: z.enum(['left', 'center', 'right']).optional(),
      letterSpacing: z.number().optional().describe('자간 (em 비율)'),
      lineHeight: z.number().positive().optional(),
      font: z.number().int().min(0).optional().describe('get_canvas_info 의 fonts 인덱스'),
      layer,
    },
  },
  {
    name: 'import_svg',
    description: 'SVG 문서를 가져온다. 선 색은 가장 가까운 팔레트 레이어로 배정되며 layer 를 주면 모두 그 레이어로. x/y/width/height 를 주면 그 영역에 비율 유지로 맞춘다.',
    shape: {
      svg: z.string().min(10).describe('완전한 <svg ...>...</svg> 문서. width/height 에 mm 단위를 쓰면 실제 크기가 된다'),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      layer,
    },
  },
  { name: 'list_shapes', description: '모든 도형의 id, 이름, 종류, 레이어, 범위(bbox mm)를 돌려준다.', shape: {} },
  {
    name: 'transform_shapes',
    description: '도형을 이동/크기 변경/회전/반전한다. 여러 옵션을 주면 scale → rotate → mirror → 이동 순으로 선택 영역 중심 기준 적용.',
    shape: {
      ids,
      dx: z.number().optional(),
      dy: z.number().optional(),
      scale: z.number().positive().optional().describe('균일 배율'),
      width: z.number().positive().optional().describe('선택 영역 폭을 이 값(mm)으로 (비율 유지, height 와 함께 주면 각각)'),
      height: z.number().positive().optional(),
      rotate: z.number().optional().describe('시계 방향 각도(deg)'),
      mirror: z.enum(['horizontal', 'vertical']).optional(),
      moveTo: z.object({ x: z.number(), y: z.number() }).optional().describe('선택 영역 왼쪽 위를 이 위치로'),
      centerAt: z.object({ x: z.number(), y: z.number() }).optional().describe('선택 영역 중심을 이 위치로'),
    },
  },
  { name: 'delete_shapes', description: '도형을 삭제한다. all=true 면 전부 삭제.', shape: { ids: z.array(z.string()).optional(), all: z.boolean().optional() } },
  { name: 'set_shape_layer', description: '도형을 다른 색상 레이어로 옮긴다.', shape: { ids, layer: z.number().int().min(0).max(29) } },
  {
    name: 'set_layer',
    description: '레이어 가공 설정을 바꾼다.',
    shape: {
      layer: z.number().int().min(0).max(29),
      name: z.string().optional(),
      mode: z.enum(['line', 'fill', 'image']).optional().describe('line=절단(선), fill=내부 스캔 각인, image=비트맵 각인'),
      speed: z.number().positive().optional().describe('mm/s'),
      power: z.number().min(0).max(100).optional().describe('최대 출력 %'),
      minPower: z.number().min(0).max(100).optional(),
      passes: z.number().int().min(1).max(50).optional(),
      interval: z.number().positive().optional().describe('fill/image 라인 간격 mm'),
      angle: z.number().optional().describe('fill 스캔 각도 deg'),
      dither: z.enum(['floyd', 'atkinson', 'threshold', 'grayscale']).optional(),
      output: z.boolean().optional().describe('false 면 출력 안 함 (가이드선 등)'),
    },
  },
  {
    name: 'offset_shapes',
    description: '도형의 오프셋(평행 윤곽)을 새 도형으로 만든다. 양수=바깥, 음수=안쪽.',
    shape: { ids, distance: z.number(), join: z.enum(['round', 'miter', 'square']).optional() },
  },
  {
    name: 'boolean_shapes',
    description: '닫힌 도형들을 합치기/빼기/교집합/배타적합 하여 하나로 바꾼다. difference 는 ids[0] 에서 나머지를 뺀다.',
    shape: { ids: z.array(z.string()).min(2), op: z.enum(['union', 'difference', 'intersection', 'xor']) },
  },
  {
    name: 'array_shapes',
    description:
      '도형을 배열 복사한다. grid: 행·열로 (spacing=gap 이면 도형 사이 간격, pitch 면 중심 거리). circular: 중심점 둘레로 count 개(원본 포함), totalAngle 360 이면 한 바퀴 등분. 만든 복사본 id 를 돌려준다.',
    shape: {
      ids,
      kind: z.enum(['grid', 'circular']),
      columns: z.number().int().min(1).max(100).optional().describe('grid: 열 개수'),
      rows: z.number().int().min(1).max(100).optional().describe('grid: 행 개수'),
      spacingX: z.number().optional().describe('grid: 가로 간격 mm'),
      spacingY: z.number().optional().describe('grid: 세로 간격 mm'),
      spacing: z.enum(['gap', 'pitch']).optional().describe('grid: 간격 방식 (기본 gap)'),
      count: z.number().int().min(2).max(360).optional().describe('circular: 원본 포함 개수'),
      centerX: z.number().optional().describe('circular: 회전 중심 X mm'),
      centerY: z.number().optional().describe('circular: 회전 중심 Y mm'),
      totalAngle: z.number().min(-360).max(360).optional().describe('circular: 펼칠 각도 deg (기본 360)'),
      rotateCopies: z.boolean().optional().describe('circular: 복사본도 회전 (기본 true)'),
    },
  },
  { name: 'preview_job', description: '가공 경로를 계산해 예상 시간, 가공/공이동 거리, 경고를 돌려준다 (레이저는 움직이지 않음).', shape: {} },
  { name: 'undo', description: '마지막 편집을 실행 취소한다.', shape: {} },
  {
    name: 'snapshot',
    description: '현재 작업대와 도형을 PNG 이미지로 돌려준다. 그린 결과를 눈으로 확인할 때 사용.',
    shape: {
      width: z.number().int().min(200).max(2000).optional().describe('이미지 폭 px (기본 900)'),
      region: z.enum(['bed', 'shapes']).optional().describe('bed=작업대 전체(기본), shapes=도형 영역 확대'),
    },
    image: true,
  },
];

/** Claude Messages API 용 JSON Schema 도구 목록 */
export function apiTools(): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  return TOOL_DEFS.map((t) => {
    const schema = z.toJSONSchema(z.object(t.shape)) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema };
  });
}
