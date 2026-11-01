import type { Point, Obstacle } from './movement.ts';
import { isBlocked } from './movement.ts';
import { BUILDINGS, GRID_SIZE, WORLD_BOUNDS } from './world-data.ts';
import { economyObstacles } from './economy-config.ts';
import { nearRoad } from './road-layout.ts';
import { insidePolygon, sweepHitsPolygon } from './polygon.ts';

export const BUILDING_TYPES = {
  farm: { name: '耕地', columns: 1, rows: 1, height: .1 },
  warehouse: { name: '仓库', columns: 3, rows: 2, height: 2.9 },
  house: { name: '民房', columns: 2, rows: 2, height: 2.5 },
} as const;
export type BuildingKind = keyof typeof BUILDING_TYPES;
export interface BuildingSite extends Point { id: string; kind: BuildingKind; width: number; depth: number; height: number }
export function buildingAt(kind: BuildingKind, point: Point, id = ''): BuildingSite {
  const type = BUILDING_TYPES[kind], width = type.columns * GRID_SIZE, depth = type.rows * GRID_SIZE;
  // Align footprint edges with the same grid as the farm cells, including odd sizes.
  const snap = (n: number, size: number) => Math.round((n - size / 2) / GRID_SIZE) * GRID_SIZE + size / 2;
  return { id, kind, x: snap(point.x, width), z: snap(point.z, depth), width, depth, height: type.height };
}
export const buildingDoor = (site: Pick<BuildingSite, 'x' | 'z' | 'depth'>): Point => ({ x: site.x, z: site.z - site.depth / 2 - .75 });
export function placementReason(site: BuildingSite, state: { depleted: string[]; sites: BuildingSite[]; plots: Point[]; goods: (Point & { state: string })[] }, occupants: readonly Obstacle[] = []): string {
  if (!Number.isFinite(site.x) || !Number.isFinite(site.z) || site.x - site.width / 2 < WORLD_BOUNDS.minX + 1
    || site.x + site.width / 2 > WORLD_BOUNDS.maxX - 1 || site.z - site.depth / 2 < WORLD_BOUNDS.minZ + 1 || site.z + site.depth / 2 > WORLD_BOUNDS.maxZ - 1) return '请放在地图范围内';
  const footprint: Obstacle = { kind: 'box', x: site.x, z: site.z, halfWidth: site.width / 2 + .35, halfDepth: site.depth / 2 + .35 };
  const overlaps = (o: Obstacle) => {
    if (o.kind === 'circle') return isBlocked(o, o.radius, [footprint]);
    if (o.kind === 'polygon') {
      const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, z]) => ({ x: site.x + x * footprint.halfWidth, z: site.z + z * footprint.halfDepth }));
      return insidePolygon(site, o) || o.points.some(p => Math.abs(p.x - site.x) <= footprint.halfWidth && Math.abs(p.z - site.z) <= footprint.halfDepth)
        || corners.some((a, i) => sweepHitsPolygon(a, corners[(i + 1) % 4], 0, o));
    }
    return Math.abs(site.x - o.x) < footprint.halfWidth + o.halfWidth && Math.abs(site.z - o.z) < footprint.halfDepth + o.halfDepth;
  };
  const obstacles = economyObstacles(state.depleted, state.sites);
  if (obstacles.some(overlaps)) return '此处有建筑、资源或水域';
  if (site.kind === 'farm' && nearRoad(site, Math.hypot(site.width, site.depth) / 2)) return '请在道路旁的空地开垦';
  // Farmland may share cell edges so players can extend an existing field.
  const fieldMargin = site.kind === 'farm' ? -1e-6 : .35;
  if (state.plots.some(p => Math.abs(site.x - p.x) < (site.width + GRID_SIZE) / 2 + fieldMargin
    && Math.abs(site.z - p.z) < (site.depth + GRID_SIZE) / 2 + fieldMargin)) return '此处已有耕地';
  if (state.goods.some(g => g.state === 'ground' && overlaps({ ...g, kind: 'circle', radius: .4 }))) return '请先搬走地面的资源';
  if (occupants.some(overlaps)) return '请避开人物和动物';
  if ([...BUILDINGS, ...state.sites].some(b => isBlocked(buildingDoor(b), .5, [footprint]))) return '请留出建筑入口';
  if (site.kind !== 'farm' && isBlocked(buildingDoor(site), .5, obstacles)) return '门前需要留出通行空间';
  return '';
}
