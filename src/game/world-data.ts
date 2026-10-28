import type { Bounds, Obstacle, Point } from './movement.ts';

export const WORLD_BOUNDS: Bounds = { minX: -12, maxX: 12, minZ: -13, maxZ: 13 };
export const SPAWN: Point = { x: 0, z: -5.5 };
export const WALK_SPEED = 3.7;
export const PLAYER_RADIUS = 0.28;

export const BUILDINGS = [
  { id: 'cottage', x: -4.8, z: 4.5, width: 4.2, depth: 3.6, height: 2.65, roof: 'terracotta' },
  { id: 'shed', x: 6.8, z: 7, width: 3.0, depth: 2.8, height: 2.1, roof: 'sage' },
] as const;

export const TREES: readonly (Point & { scale: number; tone: number })[] = [
  { x: -10, z: 10, scale: 1.15, tone: 0 }, { x: -6.7, z: 11, scale: 0.9, tone: 1 },
  { x: -2.7, z: 11.5, scale: 1.2, tone: 0 }, { x: 2, z: 11, scale: 0.9, tone: 2 },
  { x: 9.9, z: 10, scale: 1.1, tone: 1 }, { x: 10.5, z: 4, scale: 0.85, tone: 0 },
  { x: -10.4, z: 3, scale: 1.0, tone: 2 }, { x: -10.1, z: -8, scale: 1.0, tone: 0 },
  { x: -6, z: -10, scale: 0.8, tone: 1 }, { x: 8.8, z: -7, scale: 1.0, tone: 1 },
  { x: 9.3, z: -11, scale: 0.75, tone: 0 }, { x: 4, z: -11, scale: 0.85, tone: 2 },
];

export const FENCES: readonly Point[] = [
  { x: -8.5, z: 8.1 }, { x: -6.5, z: 8.1 }, { x: -4.5, z: 8.1 }, { x: -2.5, z: 8.1 },
  { x: 4.2, z: -5.2 }, { x: 6.2, z: -5.2 },
];

export interface Landmark {
  id: string; name: string; label: string; description: string;
  x: number; z: number; range: number;
}

export const LANDMARKS: readonly Landmark[] = [
  { id: 'cottage', name: '暖阳小屋', label: '一扇朝向阳光的窗', description: '奶油色的墙、陶土屋顶和门前的花。一个小小的家，就是这趟旅程的起点。', x: -4.8, z: 1.6, range: 2.2 },
  { id: 'garden', name: '青青菜园', label: '泥土里的小小生机', description: '沿着田埂走一走。嫩叶和金黄的作物，为这片土地添上了最初的颜色。', x: 4.7, z: -3.9, range: 2.4 },
  { id: 'well', name: '石砌水井', label: '听一听水的声音', description: '木架下的老水井静静守着小路。沿着路再走一段，看看这个家园的其他角落。', x: 1.5, z: 6, range: 2.1 },
];

export const OBSTACLES: readonly Obstacle[] = [
  ...BUILDINGS.map((b): Obstacle => ({ kind: 'box', x: b.x, z: b.z, halfWidth: b.width / 2 + 0.08, halfDepth: b.depth / 2 + 0.08 })),
  ...TREES.map((t): Obstacle => ({ kind: 'circle', x: t.x, z: t.z, radius: 0.25 * t.scale })),
  ...FENCES.map((f): Obstacle => ({ kind: 'box', x: f.x + 0.86, z: f.z, halfWidth: 1.0, halfDepth: 0.09 })),
  { kind: 'circle', x: 1.5, z: 7.2, radius: 0.95 },
  { kind: 'circle', x: -7.2, z: -3.7, radius: 2.15 },
];

export type LandType = 'grass' | 'path' | 'garden' | 'water' | 'building';
export interface LandCell extends Point { type: LandType }

/** Integer coordinates are land metadata, not constraints on character motion. */
export function createLandGrid(): LandCell[] {
  const cells: LandCell[] = [];
  for (let z = -13; z < 13; z++) {
    for (let x = -12; x < 12; x++) {
      const cx = x + 0.5, cz = z + 0.5;
      let type: LandType = Math.abs(cx) < 1.4 || (Math.abs(cz - 1) < 1.1 && cx > -7 && cx < 8) ? 'path' : 'grass';
      if (cx > 2.7 && cx < 7 && cz > -4.1 && cz < -0.1) type = 'garden';
      if (Math.hypot(cx + 7.2, cz + 3.7) < 2.15) type = 'water';
      if (BUILDINGS.some((b) => Math.abs(cx - b.x) < b.width / 2 && Math.abs(cz - b.z) < b.depth / 2)) type = 'building';
      cells.push({ x, z, type });
    }
  }
  return cells;
}
