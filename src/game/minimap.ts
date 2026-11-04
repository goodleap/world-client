import { LANDSCAPE, MAP_WIDTH, MAP_DEPTH, WORLD_BOUNDS, GRID_SIZE } from './world-data.ts';
import { ROAD_PATHS } from './road-layout.ts';
import type { Point } from './movement.ts';
import type { PolygonArea } from './polygon.ts';

export interface MinimapFrame {
  units: (Point & { id: string; enemy: boolean; selected?: boolean })[];
  buildings: (Point & { width?: number; depth?: number; radius: number; site?: boolean })[];
  plots: Point[];
  view: Point[];
}

/** Native Canvas 2D schematic: static terrain cached once, live markers at 5 Hz.
 * No second Babylon camera, render pass, picking, or autonomous animation loop. */
export function createMinimap(canvas: HTMLCanvasElement) {
  const width = 320, height = Math.round(width * MAP_DEPTH / MAP_WIDTH), pad = 0;
  let background: HTMLCanvasElement | undefined, context: CanvasRenderingContext2D | null = null;
  let visible = false, nextAt = 0, draws = 0, terrainBuilds = 0;
  let last: { units: number; buildings: number; view: Point[] } | undefined;
  const point = (p: Point) => ({ x: pad + (p.x - WORLD_BOUNDS.minX) / MAP_WIDTH * (width - pad * 2),
    y: pad + (WORLD_BOUNDS.maxZ - p.z) / MAP_DEPTH * (height - pad * 2) });
  const line = (ctx: CanvasRenderingContext2D, points: readonly Point[], closed = false) => {
    for (const [i, p] of points.entries()) { const q = point(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
    if (closed) ctx.closePath();
  };
  const area = (ctx: CanvasRenderingContext2D, a: PolygonArea) => {
    ctx.beginPath(); line(ctx, a.points, true);
    for (const hole of a.holes ?? []) line(ctx, hole.points, true);
    ctx.fill('evenodd');
  };
  function prepare() {
    canvas.width = width; canvas.height = height;
    context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    background = document.createElement('canvas'); background.width = width; background.height = height;
    const ctx = background.getContext('2d', { alpha: false });
    if (!ctx) { background = undefined; return; }
    ctx.fillStyle = '#455e42'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#a5b879'; for (const a of LANDSCAPE.playable) area(ctx, a);
    ctx.strokeStyle = '#e3cf99'; ctx.lineWidth = 2.8 / MAP_WIDTH * (width - pad * 2); ctx.lineCap = ctx.lineJoin = 'round';
    for (const path of ROAD_PATHS) { ctx.beginPath(); line(ctx, path); ctx.stroke(); }
    ctx.fillStyle = '#6faeb0'; area(ctx, LANDSCAPE.lake);
    terrainBuilds++;
  }
  return {
    update(time: number, open: boolean, read: () => MinimapFrame) {
      if (!open) { visible = false; return; }
      if (visible && time < nextAt) return;
      visible = true; nextAt = time + 200;
      if (!background) prepare();
      if (!context || !background) return;
      const ctx = context, state = read();
      ctx.drawImage(background, 0, 0);
      ctx.fillStyle = '#b87943';
      const plotSize = GRID_SIZE / MAP_WIDTH * (width - pad * 2);
      for (const p of state.plots) { const q = point(p); ctx.fillRect(q.x - plotSize / 2, q.y - plotSize / 2, plotSize, plotSize); }
      for (const b of state.buildings) {
        const q = point(b), w = Math.max(3, (b.width ?? b.radius * 2) / MAP_WIDTH * (width - pad * 2));
        const h = Math.max(3, (b.depth ?? b.radius * 2) / MAP_DEPTH * (height - pad * 2));
        ctx.fillStyle = b.site ? '#d4c9a3' : '#f5db9c'; ctx.strokeStyle = '#6d503a'; ctx.lineWidth = 1;
        ctx.fillRect(q.x - w / 2, q.y - h / 2, w, h); ctx.strokeRect(q.x - w / 2, q.y - h / 2, w, h);
      }
      ctx.save(); ctx.beginPath(); ctx.rect(pad, pad, width - pad * 2, height - pad * 2); ctx.clip();
      if (state.view.length === 4) {
        ctx.beginPath(); line(ctx, state.view, true); ctx.fillStyle = '#fffbe723'; ctx.fill();
        ctx.strokeStyle = '#fffbe7'; ctx.lineWidth = 1.8; ctx.stroke();
      }
      for (const unit of state.units) {
        const q = point(unit); ctx.beginPath(); ctx.arc(q.x, q.y, unit.selected ? 3.8 : 2.3, 0, Math.PI * 2);
        ctx.fillStyle = unit.enemy ? '#e46b51' : '#63def0'; ctx.fill();
        ctx.strokeStyle = unit.selected ? '#ffffff' : '#344c3c'; ctx.lineWidth = unit.selected ? 1.8 : .65; ctx.stroke();
      }
      ctx.restore(); draws++;
      last = { units: state.units.length, buildings: state.buildings.length, view: state.view };
    },
    snapshot: () => ({ visible, draws, terrainBuilds, ...last }),
    dispose() { visible = false; background = undefined; context = null; canvas.width = canvas.height = 0; },
  };
}
