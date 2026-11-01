import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { polygonArea, polygonDistance } from './polygon.ts';
import type { Point } from './movement.ts';

import { MAP_CONFIG, ROUTE_LAYOUT, createRegions, pathDistanceSquared } from './map-regions.ts';

export const LANDSCAPE_SEED = MAP_CONFIG.seed;
export function seededRandom(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

export function createCurvedRoadPaths(roads: readonly Point[][], gridSize: number, spacing = gridSize) {
  return roads.map(road => {
    const point = (p: Point) => new Vector3(p.x, 0, p.z);
    const points = [point(road[0])];
    for (let i = 1; i < road.length; i++) {
      const control = point(road[i - 1]), end = Vector3.Center(control, point(road[i]));
      const start = points.at(-1)!;
      const samples = Math.max(4, Math.ceil((Vector3.Distance(start, control) + Vector3.Distance(control, end)) / spacing));
      points.push(...Curve3.CreateQuadraticBezier(start, control, end, samples).getPoints().slice(1));
    }
    points.push(point(road.at(-1)!));
    return points;
  });
}

/** Region graph authored from the user's clearing/corridor reference. */
export function createLandscapeLayout(gridPoint: (x: number, z: number) => Point, gridSize: number, seed: number = LANDSCAPE_SEED) {
  const random = seededRandom(seed), local = (x: number, z: number) => ({ x: x * gridSize, z: z * gridSize });
  const roadControls = ROUTE_LAYOUT.map(route => route.map(([x, z]) => local(x, z)));
  const paths = createCurvedRoadPaths(roadControls, gridSize, gridSize * 1.5);
  const terrain = createRegions(gridSize, paths);
  const controls = [[12, 21], [15, 30], [24, 29], [33, 25], [34, 16], [29, 8], [21, 7], [14, 12]];
  const shoreline = Curve3.CreateCatmullRomSpline(controls.map(([x, z]) => new Vector3(x * gridSize, 0, z * gridSize)), 8, true).getPoints();
  shoreline.pop();
  const lake = polygonArea(shoreline.map(({ x, z }) => ({ x, z })));
  type Tree = Point & { scale: number; tone: number; rotation: number };
  type Rock = Point & { scale: number; rotation: number };
  const trees: Tree[] = [{ ...gridPoint(MAP_CONFIG.columns / 2 - 6, MAP_CONFIG.rows / 2 - 1), scale: 1, tone: 0, rotation: .7 }, { ...gridPoint(MAP_CONFIG.columns / 2 - 7, MAP_CONFIG.rows / 2 + 3), scale: 1.1, tone: 1, rotation: 2.3 }];
  const rocks: Rock[] = [{ ...gridPoint(MAP_CONFIG.columns / 2 + 9, MAP_CONFIG.rows / 2 - 6), scale: 1, rotation: .5 }, { ...gridPoint(MAP_CONFIG.columns / 2 - 10, MAP_CONFIG.rows / 2 - 1), scale: 1.2, rotation: 2.1 }];
  const iron: Rock[] = [], forage: Rock[] = [], sceneryTrees: Tree[] = [];
  const roadDistance = (p: Point) => Math.sqrt(Math.min(...paths.flatMap(path => path.slice(1).map((b, i) => pathDistanceSquared(p, path[i], b)))));
  const crowded = (p: Point) => [...trees, ...rocks, ...iron, ...forage].some(t => Math.hypot(p.x - t.x, p.z - t.z) < 3.8);
  for (const region of terrain.regions) {
    const count = region.id === 'home' ? 9 : region.id === 'woodland' ? 22 : region.id === 'orchard' ? 18 : region.id === 'quarry' ? 14 : region.id === 'pass' ? 9 : 7;
    for (let placed = 0, attempt = 0; placed < count && attempt < 800; attempt++) {
      const a = random() * Math.PI * 2, r = .55 + random() * .3;
      const point = { x: region.x + Math.cos(a) * region.rx * gridSize * r, z: region.z + Math.sin(a) * region.rz * gridSize * r };
      if (region.id === 'home' && point.x > -9 && point.x < 17 && point.z > -13 && point.z < 11 || roadDistance(point) < 4.7 || crowded(point)) continue;
      if (polygonDistance(point, region.area) > -2.6) continue;
      const common = { ...point, scale: .9 + random() * .4, rotation: random() * Math.PI * 2 };
      if (region.id === 'quarry' && placed % 2 === 0 || region.id === 'pass' && placed % 3 === 0) iron.push(common);
      else if (region.id === 'orchard' && placed % 2 === 0 || region.id === 'woodland' && placed % 4 === 0 || region.id === 'home' && placed === 0) forage.push({ ...common, scale: 1 });
      else if (region.id === 'quarry' || region.id === 'stone-hollow' || placed % 4 === 2) rocks.push(common);
      else trees.push({ ...common, tone: Math.floor(random() * 3) });
      placed++;
    }
  }
  // Static woodland is scenery backed by an unwalkable terrain bank. Cutting
  // resource trees never erases the region boundary or opens a phantom shortcut.
  for (let z = -MAP_CONFIG.rows / 2 + 3; z < MAP_CONFIG.rows / 2 - 3; z += 4.6) for (let x = -MAP_CONFIG.columns / 2 + 3; x < MAP_CONFIG.columns / 2 - 3; x += 4.6) {
    const point = local(x + random() * 2, z + random() * 2);
    if (terrain.contains(point) || polygonDistance(point, lake) < 3 || roadDistance(point) < 5
      || terrain.playable.some(a => Math.abs(polygonDistance(point, a)) < 2)) continue;
    sceneryTrees.push({ ...point, scale: 1 + random() * .75, tone: Math.floor(random() * 3), rotation: random() * Math.PI * 2 });
  }
  return { seed, lake, trees, rocks, iron, forage, sceneryTrees, roadControls, ...terrain };
}
