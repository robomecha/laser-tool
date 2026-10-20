// AI(MCP) 용 스냅샷: 사용자 화면과 무관하게 작업대/도형을 PNG 로 그린다.
import { DeviceSettings, fromMachine } from '../core/device';
import { LaserDocument } from '../core/document';
import { BBox, isEmptyBBox } from '../core/geometry';
import { layerColor } from '../core/layers';
import { worldPaths } from '../core/shapes';
import { loadImageEl } from '../io/image-import';

export interface SnapshotResult {
  png: string;
  caption: string;
}

export async function renderSnapshot(doc: LaserDocument, dev: DeviceSettings, widthPx = 900, region: 'bed' | 'shapes' = 'bed'): Promise<SnapshotResult> {
  const all = doc.allBBox();
  let b: BBox = { minX: 0, minY: 0, maxX: dev.bedWidth, maxY: dev.bedHeight };
  if (region === 'shapes' && !isEmptyBBox(all)) {
    const m = Math.max(2, Math.max(all.maxX - all.minX, all.maxY - all.minY) * 0.05);
    b = { minX: all.minX - m, minY: all.minY - m, maxX: all.maxX + m, maxY: all.maxY + m };
  }
  const pad = 24;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const z = (widthPx - pad * 2) / bw;
  const c = document.createElement('canvas');
  c.width = widthPx;
  c.height = Math.round(bh * z + pad * 2);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(z, 0, 0, z, pad - b.minX * z, pad - b.minY * z);
  const px = 1 / z;

  // 작업대 + 10mm 그리드
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dev.bedWidth, dev.bedHeight);
  ctx.lineWidth = px;
  ctx.strokeStyle = '#e6e6e6';
  ctx.beginPath();
  for (let x = 0; x <= dev.bedWidth; x += 10) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, dev.bedHeight);
  }
  for (let y = 0; y <= dev.bedHeight; y += 10) {
    ctx.moveTo(0, y);
    ctx.lineTo(dev.bedWidth, y);
  }
  ctx.stroke();
  ctx.strokeStyle = '#999';
  ctx.strokeRect(0, 0, dev.bedWidth, dev.bedHeight);
  const o = fromMachine(dev, 0, 0);
  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.arc(o.x, o.y, 4 * px, 0, Math.PI * 2);
  ctx.fill();

  for (const s of doc.shapes) {
    const layer = doc.layer(s.layer);
    if (!layer.show) continue;
    const color = layerColor(s.layer);
    if (s.type === 'image') {
      try {
        const img = await loadImageEl(s.src);
        ctx.save();
        ctx.transform(...s.transform);
        ctx.drawImage(img, 0, 0, s.w, s.h);
        ctx.restore();
      } catch {
        /* 무시 */
      }
    }
    const paths = worldPaths(s).filter((l) => l.pts.length);
    const trace = (onlyClosed: boolean) => {
      ctx.beginPath();
      for (const l of paths) {
        if (onlyClosed && !l.closed) continue;
        ctx.moveTo(l.pts[0].x, l.pts[0].y);
        for (const p of l.pts.slice(1)) ctx.lineTo(p.x, p.y);
        if (l.closed) ctx.closePath();
      }
    };
    if (s.type === 'vector' && layer.mode === 'fill') {
      // 채우기 가공은 닫힌 도형만 대상이므로 미리보기도 닫힌 경로만 칠한다
      trace(true);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
    }
    trace(false);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * px;
    ctx.globalAlpha = layer.output ? 1 : 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const caption =
    `영역 X ${b.minX.toFixed(1)}~${b.maxX.toFixed(1)} mm, Y ${b.minY.toFixed(1)}~${b.maxY.toFixed(1)} mm (그리드 10mm, 빨간 점 = 기계 원점). ` +
    `도형 ${doc.shapes.length}개` +
    (isEmptyBBox(all) ? '' : `, 도형 범위 X ${all.minX.toFixed(1)}~${all.maxX.toFixed(1)}, Y ${all.minY.toFixed(1)}~${all.maxY.toFixed(1)}`) +
    '. 채우기(fill) 레이어는 반투명으로 칠해 표시.';
  return { png: c.toDataURL('image/png').split(',')[1], caption };
}
