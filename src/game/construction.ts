import type { Point, Obstacle } from './movement.ts';
import { isBlocked } from './movement.ts';
import { BUILDINGS, GRID_SIZE, WORLD_BOUNDS, LANDSCAPE, WATER_OBSTACLE } from './world-data.ts';
import { economyObstacles } from './economy-config.ts';
import { insidePolygon, sweepHitsPolygon } from './polygon.ts';
import { TOWER_SHAPE } from './tower-shape.ts';

export const BUILDING_TYPES = {
  farm: { name: '耕地', columns: 1, rows: 1, height: .1 },
  warehouse: { name: '仓库', columns: 3, rows: 2, height: 2.9 },
  house: { name: '民房', columns: 2, rows: 2, height: 2.5 },
  tower: { name:'哨塔', columns:TOWER_SHAPE.cells, rows:TOWER_SHAPE.cells, height:TOWER_SHAPE.height },
  campfire: { name: '火堆', columns: 2, rows: 2, height: 1.2 },
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
  if (!Number.isFinite(site.x) || !Number.isFinite(site.z) || site.x - site.width / 2 < WORLD_BOUNDS.minX
    || site.x + site.width / 2 > WORLD_BOUNDS.maxX || site.z - site.depth / 2 < WORLD_BOUNDS.minZ || site.z + site.depth / 2 > WORLD_BOUNDS.maxZ) return '请放在地图范围内';
  // Check the real footprint against terrain/solids, including all edges.
  // Clearing labels and connectivity are planning advice, not physical limits.
  const footprint: Obstacle = { kind: 'box', x: site.x, z: site.z, halfWidth: site.width / 2, halfDepth: site.depth / 2 };
  const overlaps = (o: Obstacle) => {
    if (o.kind === 'circle') return isBlocked(o, o.radius, [footprint]);
    if (o.kind === 'polygon') {
      const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, z]) => ({ x: site.x + x * footprint.halfWidth, z: site.z + z * footprint.halfDepth }));
      return insidePolygon(site, o) || o.points.some(p => Math.abs(p.x - site.x) <= footprint.halfWidth && Math.abs(p.z - site.z) <= footprint.halfDepth)
        || corners.some((a, i) => sweepHitsPolygon(a, corners[(i + 1) % 4], 0, o));
    }
    return Math.abs(site.x - o.x) < footprint.halfWidth + o.halfWidth && Math.abs(site.z - o.z) < footprint.halfDepth + o.halfDepth;
  };
  // Placement reserves grid footprints, independently of built-model collision.
  const obstacles = economyObstacles(state.depleted, state.sites, []);
  if (overlaps(WATER_OBSTACLE)) return '建筑占地不能进入水域';
  if (obstacles.some(o => o.kind === 'polygon' && overlaps(o))) return '建筑占地超出可建设地面';
  if (obstacles.some(o => o.kind !== 'polygon' && overlaps(o))) return '此处有建筑或资源';
  // Farmland may share cell edges so players can extend an existing field.
  const fieldMargin = -1e-6;
  if (state.plots.some(p => Math.abs(site.x - p.x) < (site.width + GRID_SIZE) / 2 + fieldMargin
    && Math.abs(site.z - p.z) < (site.depth + GRID_SIZE) / 2 + fieldMargin)) return '此处已有耕地';
  if (state.goods.some(g => g.state === 'ground' && overlaps({ ...g, kind: 'circle', radius: .4 }))) return '请先搬走地面的资源';
  if (occupants.some(overlaps)) return '请避开人物和动物';
  return '';
}

/** Cheap placement advice; never gates a command or runs pathfinding per frame. */
export function placementWarning(site: BuildingSite, state: { depleted: string[]; sites: BuildingSite[] }) {
  const footprint: Obstacle = { kind: 'box', x: site.x, z: site.z, halfWidth: site.width / 2, halfDepth: site.depth / 2 };
  if ([...BUILDINGS, ...state.sites].some(b => (!('kind' in b) || b.kind !== 'campfire') && isBlocked(buildingDoor(b), .5, [footprint]))
    || site.kind !== 'farm' && site.kind !== 'campfire' && isBlocked(buildingDoor(site), .5, economyObstacles(state.depleted, state.sites, []))) {
    return '可能影响建筑出入，仍可建造';
  }
  const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, z]) => ({ x: site.x + x * site.width / 2, z: site.z + z * site.depth / 2 }));
  return LANDSCAPE.regions.some(r => corners.every(p => insidePolygon(p, r.area))) ? '' : '此处可能影响通行，仍可建造';
}
