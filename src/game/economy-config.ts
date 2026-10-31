import { OBSTACLES, TREES, gridPoint } from './world-data.ts';
import type { Obstacle } from './movement.ts';
import type { BuildingSite } from './construction.ts';

/** Trial parameters, not final balance or confirmed long-term design.
 * FIFO among executable jobs; reserve before work, spend on
 * successful completion; produced goods must be delivered; no seed item, offline progress or resource respawn. */
export const ECONOMY_CONFIG = {
  initialInventory: { wood: 8, stone: 4, food: 0 },
  capacity: { wood: 2000, stone: 2000, food: 4000 },
  workSeconds: { till: 3, sow: 3, harvest: 3, chop: 5, mine: 5, build: 8, haul: .25 },
  crops: {
    carrot: { name: '胡萝卜', growthSeconds: 25, yield: 8 },
    wheat: { name: '小麦', growthSeconds: 40, yield: 12 },
  },
  houseCost: { wood: 12, stone: 8, food: 0 },
  queueLimit: 24,
  retrySeconds: 3,
} as const;

export const FARM_PLOTS = Array.from({ length: 12 }, (_, i) => ({
  id: `plot-${i}`, ...gridPoint(51.5 + i % 4, 52.5 + Math.floor(i / 4)),
}));
export const RESOURCE_NODES = [
  ...TREES.map((tree, i) => ({ id: `tree-${i}`, kind: 'wood' as const, x: tree.x, z: tree.z, radius: .5 * tree.scale, yield: 16 })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `rock-${i}`, kind: 'stone' as const,
    ...gridPoint(i < 2 ? 59 + i * 2 : 72 + i % 5 * 4, i < 2 ? 44 : 10 + Math.floor(i / 5) * 5), radius: .65, yield: 12 })),
];
export function economyObstacles(depleted: readonly string[], sites: readonly BuildingSite[] = []): Obstacle[] {
  return [
    ...OBSTACLES.filter(o => !TREES.some(t => t.x === o.x && t.z === o.z)),
    ...RESOURCE_NODES.filter(n => !depleted.includes(n.id)).map((n): Obstacle => ({ kind: 'circle', x: n.x, z: n.z, radius: n.radius })),
    ...sites.map((s): Obstacle => ({ kind: 'box', x: s.x, z: s.z, halfWidth: s.width / 2 + .12, halfDepth: s.depth / 2 + .12 })),
  ];
}
