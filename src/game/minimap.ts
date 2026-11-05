import { LANDSCAPE, MAP_WIDTH, MAP_DEPTH, WORLD_BOUNDS, GRID_SIZE } from './world-data.ts';
import { BIOME_COLORS } from './biomes.ts';
import { ROAD_PATHS } from './road-layout.ts';
import type { Point } from './movement.ts';
import type { PolygonArea } from './polygon.ts';

export interface MinimapFrame {
  units: (Point & { id: string; enemy: boolean; selected?: boolean })[];
  buildings: (Point & { width?: number; depth?: number; radius: number; site?: boolean })[];
  plots: Point[];
  view: Point[];
}

/** Native Canvas 2D schematic: cached terrain/buildings, live markers at 5 Hz.
 * The camera footprint follows each rendered frame, independently of markers.
 * No second Babylon camera, render pass, picking, or autonomous animation loop. */
export function createMinimap(canvas: HTMLCanvasElement) {
  let width = 320, height = Math.round(width * MAP_DEPTH / MAP_WIDTH);
  const pad = 0;
  let background: HTMLCanvasElement | undefined, map: HTMLCanvasElement | undefined, markers: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let visible = false, nextAt = 0, draws = 0, terrainBuilds = 0, markerDraws = 0, mapBuilds = 0, mapKey = '';
  let totalMs=0,maxMs=0;
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
    ctx.fillStyle = '#667b55'; ctx.fillRect(0,0,width,height);
    ctx.fillStyle = '#91ac64'; area(ctx,LANDSCAPE.geography.outline);
    ctx.save();ctx.beginPath();line(ctx,LANDSCAPE.geography.outline.points,true);ctx.clip();
    for(const r of LANDSCAPE.regions){ctx.fillStyle=BIOME_COLORS[r.biome];area(ctx,r.area);}
    for(const f of LANDSCAPE.geography.forms){ctx.fillStyle=f.kind==='ridge'?'#9d9d82':f.kind==='basin'?'#aa9e80':'#9eb16b';area(ctx,f.area);ctx.beginPath();line(ctx,f.area.points,true);ctx.strokeStyle='#797d66';ctx.lineWidth=(f.kind==='ridge'?1.8:1.2)*width/320;ctx.stroke();}
    for(const f of LANDSCAPE.geography.forests){ctx.fillStyle=f.species==='pine'?'#49654d':f.species==='blossom'?'#a0a36d':'#617f42';area(ctx,f.area);}
    ctx.restore();
    ctx.strokeStyle = '#e3cf99'; ctx.lineWidth = 2.8 / MAP_WIDTH * (width - pad * 2); ctx.lineCap = ctx.lineJoin = 'round';
    for (const path of ROAD_PATHS) { ctx.beginPath(); line(ctx, path); ctx.stroke(); }
    ctx.fillStyle = '#62a8aa'; for(const a of LANDSCAPE.waterAreas)area(ctx,a);
    ctx.fillStyle='#bd9059';for(const bridge of LANDSCAPE.bridges)area(ctx,bridge.area);
    terrainBuilds++;
    map = document.createElement('canvas'); map.width = width; map.height = height;
    markers = document.createElement('canvas'); markers.width = width; markers.height = height;
  }
  return {
    update(time: number, open: boolean, read: () => Omit<MinimapFrame,'view'>, readView: () => Point[],full=false) {
      const resolution=full?768:320;
      if(width!==resolution){
        for(const layer of [background,map,markers])if(layer)layer.width=layer.height=0;
        width=resolution;height=Math.round(width*MAP_DEPTH/MAP_WIDTH);background=map=markers=undefined;context=null;mapKey='';visible=false;
      }
      if (!open) { visible = false; return; }
      const started=performance.now();
      const refresh = !visible || time >= nextAt;
      visible = true;
      if (!background) prepare();
      if (!context || !background || !map || !markers) return;
      const view = readView();
      if (!refresh && last?.view.length === view.length && view.every((p,i)=>Math.abs(p.x-last!.view[i].x)<1e-6 && Math.abs(p.z-last!.view[i].z)<1e-6)) return;
      if (refresh) {
        nextAt = time + 200;
        const state = read(), key = JSON.stringify([state.plots.map(p=>[p.x,p.z]),state.buildings]);
        if (key !== mapKey) {
          const ctx = map.getContext('2d')!;
          ctx.drawImage(background,0,0); ctx.fillStyle = '#b87943';
          const plotSize = GRID_SIZE / MAP_WIDTH * (width - pad * 2);
          for (const p of state.plots) { const q = point(p); ctx.fillRect(q.x - plotSize / 2, q.y - plotSize / 2, plotSize, plotSize); }
          for (const b of state.buildings) {
            const q = point(b), w = Math.max(3, (b.width ?? b.radius * 2) / MAP_WIDTH * (width - pad * 2));
            const h = Math.max(3, (b.depth ?? b.radius * 2) / MAP_DEPTH * (height - pad * 2));
            ctx.fillStyle = b.site ? '#d4c9a3' : '#f5db9c'; ctx.strokeStyle = '#6d503a'; ctx.lineWidth = 1;
            ctx.fillRect(q.x - w / 2, q.y - h / 2, w, h); ctx.strokeRect(q.x - w / 2, q.y - h / 2, w, h);
          }
          mapKey = key; mapBuilds++;
        }
        const ctx = markers.getContext('2d')!; ctx.clearRect(0,0,width,height);
        for (const unit of state.units) {
          const q = point(unit); ctx.beginPath(); ctx.arc(q.x, q.y, (unit.selected ? 3.8 : 2.3)*width/320, 0, Math.PI * 2);
          ctx.fillStyle = unit.enemy ? '#e46b51' : '#63def0'; ctx.fill();
          ctx.strokeStyle = unit.selected ? '#ffffff' : '#344c3c'; ctx.lineWidth = unit.selected ? 1.8 : .65; ctx.stroke();
        }
        markerDraws++; last = { units: state.units.length, buildings: state.buildings.length, view };
      }
      const ctx = context;
      ctx.drawImage(map,0,0);
      if (view.length === 4) {
        ctx.beginPath(); line(ctx, view, true); ctx.fillStyle = '#fffbe723'; ctx.fill();
        ctx.strokeStyle = '#fffbe7'; ctx.lineWidth = 1.8; ctx.stroke();
      }
      ctx.drawImage(markers,0,0); draws++;
      if(last)last.view=view;
      const elapsed=performance.now()-started;totalMs+=elapsed;maxMs=Math.max(maxMs,elapsed);
    },
    snapshot: () => ({ visible, draws, markerDraws, mapBuilds, terrainBuilds, totalMs, maxMs, ...last }),
    dispose() { visible = false; for(const layer of [background,map,markers,canvas])if(layer)layer.width=layer.height=0; background = map = markers = undefined; context = null; },
  };
}
