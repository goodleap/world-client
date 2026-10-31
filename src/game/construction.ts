import type { Point, Obstacle } from './movement.ts';
import { isBlocked } from './movement.ts';
import { BUILDINGS, GRID_SIZE, WORLD_BOUNDS } from './world-data.ts';
import { FARM_PLOTS, economyObstacles } from './economy-config.ts';

export const BUILDING_TYPES = { house: { name: '民房', columns: 2, rows: 2, height: 2.5 } } as const;
export type BuildingKind = keyof typeof BUILDING_TYPES;
export interface BuildingSite extends Point { id: string; kind: BuildingKind; width: number; depth: number; height: number }
export function buildingAt(kind: BuildingKind, point: Point, id = ''): BuildingSite {
  const type = BUILDING_TYPES[kind], width = type.columns * GRID_SIZE, depth = type.rows * GRID_SIZE;
  // Align footprint edges with the same grid as the farm cells, including odd sizes.
  const snap = (n: number, size: number) => Math.round((n - size / 2) / GRID_SIZE) * GRID_SIZE + size / 2;
  return { id, kind, x: snap(point.x, width), z: snap(point.z, depth), width, depth, height: type.height };
}
export const buildingDoor = (site: Pick<BuildingSite, 'x' | 'z' | 'depth'>): Point => ({ x: site.x, z: site.z - site.depth / 2 - .75 });
export function placementReason(site: BuildingSite, state: { depleted: string[]; sites: BuildingSite[]; goods: (Point & { state: string })[] }, occupants: readonly Obstacle[] = []): string {
  if (!Number.isFinite(site.x) || !Number.isFinite(site.z) || site.x - site.width / 2 < WORLD_BOUNDS.minX + 1
    || site.x + site.width / 2 > WORLD_BOUNDS.maxX - 1 || site.z - site.depth / 2 < WORLD_BOUNDS.minZ + 1 || site.z + site.depth / 2 > WORLD_BOUNDS.maxZ - 1) return '请放在地图范围内';
  const footprint: Obstacle = { kind: 'box', x: site.x, z: site.z, halfWidth: site.width / 2 + .35, halfDepth: site.depth / 2 + .35 };
  const overlaps = (o: Obstacle) => o.kind === 'circle' ? isBlocked(o, o.radius, [footprint])
    : Math.abs(site.x - o.x) < footprint.halfWidth + o.halfWidth && Math.abs(site.z - o.z) < footprint.halfDepth + o.halfDepth;
  const obstacles = economyObstacles(state.depleted, state.sites);
  if (obstacles.some(overlaps)) return '此处有建筑、资源或水域';
  if (FARM_PLOTS.some(p => overlaps({ ...p, kind: 'box', halfWidth: GRID_SIZE / 2, halfDepth: GRID_SIZE / 2 }))) return '请保留农田和作业空间';
  if (state.goods.some(g => g.state === 'ground' && overlaps({ ...g, kind: 'circle', radius: .4 }))) return '请先搬走地面的资源';
  if (occupants.some(overlaps)) return '请避开人物和动物';
  if ([...BUILDINGS, ...state.sites].some(b => isBlocked(buildingDoor(b), .5, [footprint]))) return '请留出建筑入口';
  if (isBlocked(buildingDoor(site), .5, obstacles)) return '门前需要留出通行空间';
  return '';
}
