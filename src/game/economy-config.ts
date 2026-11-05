import { OBSTACLES, TREES, LANDSCAPE, gridPoint, MAP_CELLS, MAP_ROWS } from './world-data.ts';
import type { Obstacle } from './movement.ts';
import type { BuildingSite } from './construction.ts';
import { CAMPFIRE_SHAPE } from './campfire-shape.ts';
import { TREE_COLLISION_RADIUS } from './landscape-layout.ts';
import { MAP_DEVELOPMENT } from './opening-profile.ts';

/** Trial parameters, not final balance or confirmed long-term design.
 * FIFO among executable jobs; reserve before work, spend on
 * successful completion; produced goods must be delivered; no seed item or offline progress. Renewable nodes use saved active-time deadlines. */
export const ECONOMY_CONFIG = {
  initialInventory: { wood: 8, stone: 4, food: 24, iron: 4 },
  capacity: { wood: 2000, stone: 2000, food: 4000, iron: 800 },
  workSeconds: { till: 3, sow: 3, harvest: 3, chop: 5, mine: 5, build: 8, repair:8, demolish:4, haul: .25, supply: .25, gather: 3, tools: 12, arms: 16 },
  crops: {
    carrot: { name: '胡萝卜', growthSeconds: 75, yield: 8 },
    wheat: { name: '小麦', growthSeconds: 120, yield: 12 },
  },
  houseCost: { wood: 12, stone: 8, food: 0, iron: 0 },
  warehouseCost: { wood: 24, stone: 16, food: 0, iron: 0 },
  toolsCost: { wood: 4, stone: 0, food: 0, iron: 8 },
  armsCost: { wood: 6, stone: 0, food: 0, iron: 12 },
  upgradeLimit: 3,
  queueLimit: 24,
  retrySeconds: 3,
} as const;

export const FARM_PLOTS = Array.from({ length: MAP_DEVELOPMENT?0:12 }, (_, i) => ({
  id: `plot-${i}`, ...gridPoint(MAP_CELLS / 2 + 1.5 + i % 4, MAP_ROWS / 2 + 2.5 + Math.floor(i / 4)),
}));
export const RESOURCE_NODES = [
  ...TREES.map((tree, i) => ({ id: `tree-${i}`, kind: 'wood' as const, scale: tree.scale, rotation: tree.rotation, x: tree.x, z: tree.z, radius: TREE_COLLISION_RADIUS * tree.scale, yield: 16, renew: 240 })),
  ...LANDSCAPE.rocks.map((rock, i) => ({ ...rock, id: `rock-${i}`, kind: 'stone' as const, radius: .85 * rock.scale, yield: 12, renew: 360 })),
  ...LANDSCAPE.iron.map((node, i) => ({ ...node, id: `iron-${i}`, kind: 'iron' as const, radius: .85 * node.scale, yield: 6, renew: 180 })),
  ...LANDSCAPE.forage.map((node, i) => ({ ...node, id: `forage-${i}`, kind: 'food' as const, radius: .65, yield: 6, renew: 90 })),
];
export function economyObstacles(depleted: readonly string[], sites: readonly BuildingSite[] = [], built: readonly string[] = sites.map(s => s.id)): Obstacle[] {
  return [
    ...OBSTACLES.filter(o => !TREES.some(t => t.x === o.x && t.z === o.z)),
    ...RESOURCE_NODES.filter(n => !depleted.includes(n.id)).map((n): Obstacle => ({ kind: 'circle', x: n.x, z: n.z, radius: n.radius })),
    ...sites.map((s): Obstacle => s.kind === 'campfire' && built.includes(s.id)
      ? { kind: 'circle', x: s.x, z: s.z, radius: CAMPFIRE_SHAPE.radius }
      : { kind: 'box', x: s.x, z: s.z, halfWidth: s.width / 2 + .12, halfDepth: s.depth / 2 + .12 }),
  ];
}
