import { OBSTACLES, TREES } from './world-data.ts';
import type { Obstacle } from './movement.ts';

/** Trial parameters, not final balance or confirmed long-term design.
 * One farmer; FIFO among executable jobs; reserve before work, spend on
 * successful completion; no seed item, offline progress or resource respawn. */
export const ECONOMY_CONFIG = {
  initialInventory: { wood: 8, stone: 4, food: 0 },
  capacity: { wood: 120, stone: 120, food: 120 },
  workSeconds: { till: 3, sow: 3, harvest: 3, chop: 5, mine: 5, build: 8 },
  crops: {
    carrot: { name: '胡萝卜', growthSeconds: 25, yield: 8 },
    wheat: { name: '小麦', growthSeconds: 40, yield: 12 },
  },
  houseCost: { wood: 12, stone: 8, food: 0 },
  queueLimit: 24,
  retrySeconds: 3,
} as const;

export const FARM_PLOTS = Array.from({ length: 9 }, (_, i) => ({
  id: `plot-${i}`, x: 3.4 + i % 3 * 1.4, z: -3.4 + Math.floor(i / 3) * 1.4,
}));
export const RESOURCE_NODES = [
  ...TREES.map((tree, i) => ({ id: `tree-${i}`, kind: 'wood' as const, x: tree.x, z: tree.z, radius: .5 * tree.scale, yield: 16 })),
  { id: 'rock-0', kind: 'stone' as const, x: 8.1, z: 3.8, radius: .65, yield: 12 },
  { id: 'rock-1', kind: 'stone' as const, x: -3.5, z: -9, radius: .65, yield: 12 },
];
export const BUILD_SITES = [
  { id: 'site-0', x: -5.3, z: -7.7, width: 3, depth: 2.8, height: 2.5 },
  { id: 'site-1', x: 5.4, z: -8.4, width: 3, depth: 2.8, height: 2.5 },
];

export function economyObstacles(depleted: readonly string[]): Obstacle[] {
  return [
    ...OBSTACLES.filter(o => !TREES.some(t => t.x === o.x && t.z === o.z)),
    ...RESOURCE_NODES.filter(n => !depleted.includes(n.id)).map((n): Obstacle => ({ kind: 'circle', x: n.x, z: n.z, radius: n.radius })),
    ...BUILD_SITES.map((s): Obstacle => ({ kind: 'box', x: s.x, z: s.z, halfWidth: s.width / 2 + .12, halfDepth: s.depth / 2 + .12 })),
  ];
}
