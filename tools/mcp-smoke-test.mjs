#!/usr/bin/env node
// MCP 서버 동작 확인용 스크립트: 서버를 띄우고, 브라우저 Laser Tool 이 [AI 연결] 되면 도구들을 차례로 호출한다.
// 사용법: npm run mcp:test   (브라우저에서 http://localhost:5173 을 열고 [AI 연결] 을 눌러 둘 것)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';

const client = new Client({ name: 'laser-tool-smoke', version: '0.0.1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['tools/mcp-server.mjs'], stderr: 'inherit' }));

const { tools } = await client.listTools();
console.log('도구:', tools.map((t) => t.name).join(', '));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const txt = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(`${name}: ${txt}`);
  return { r, txt, json: (() => { try { return JSON.parse(txt); } catch { return null; } })() };
};

// 브라우저 연결 대기 (최대 30초)
let info;
for (let i = 0; i < 30; i++) {
  try {
    info = (await call('get_canvas_info')).json;
    break;
  } catch (e) {
    if (i === 0) console.log('브라우저 연결 대기 중…', e.message);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!info) {
  console.error('브라우저가 연결되지 않았습니다');
  process.exit(1);
}
console.log('작업대:', info.bed, '글꼴:', info.fonts.map((f) => f.name).join(', '));

await call('delete_shapes', { all: true });
const drawn = (await call('draw_shapes', {
  shapes: [
    { type: 'rect', x: 20, y: 20, width: 120, height: 70, radius: 8, layer: 2, name: '외곽 컷' },
    { type: 'circle', cx: 45, cy: 55, r: 15, layer: 1 },
    { type: 'polyline', points: [[70, 40], [80, 70], [90, 40]], closed: false, layer: 1 },
  ],
})).json;
console.log('draw_shapes:', drawn.created.map((c) => c.id).length, '개');

const t = (await call('add_text', { text: '레이저 AI', x: 80, y: 55, size: 12, anchor: 'center', layer: 1 })).json;
console.log('add_text bbox:', t.bbox);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L61 39 L97 39 L68 61 L79 95 L50 74 L21 95 L32 61 L3 39 L39 39 Z" stroke="#0000ff" fill="none"/></svg>`;
const star = (await call('import_svg', { svg, x: 160, y: 20, width: 60, layer: 1 })).json;
console.log('import_svg bbox:', star.bbox);

await call('set_layer', { layer: 1, mode: 'fill', speed: 150, power: 30, interval: 0.1 });
await call('set_layer', { layer: 2, mode: 'line', speed: 15, power: 70 });
const off = (await call('offset_shapes', { ids: [drawn.created[0].id], distance: 3 })).json;
console.log('offset:', off.created[0].bbox);
const mv = (await call('transform_shapes', { ids: star.created.map((c) => c.id), rotate: 15, centerAt: { x: 200, y: 60 } })).json;
console.log('transform:', mv.bbox);

const pv = (await call('preview_job')).json;
console.log('preview_job:', pv.estimatedTime, pv.blocks.map((b) => `${b.layer}:${b.kind}`).join(' '), pv.warnings);

const snap = await call('snapshot', { width: 900 });
const img = snap.r.content.find((c) => c.type === 'image');
const out = process.argv[2] || 'mcp-snapshot.png';
writeFileSync(out, Buffer.from(img.data, 'base64'));
console.log('snapshot 저장:', out, snap.txt);

const list = (await call('list_shapes')).json;
console.log('list_shapes:', list.length, '개');
await client.close();
console.log('완료');
