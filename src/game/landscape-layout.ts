import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { polygonDistance } from './polygon.ts';
import type { Point } from './movement.ts';

import { MAP_CONFIG, ROUTE_LAYOUT, createRegions, pathDistanceSquared } from './map-regions.ts';

import { createMapLandmarks } from './map-landmarks.ts';
import { isBlocked } from './movement.ts';
import { createMapWater } from './map-water.ts';
export type TreeSpecies = 'oak' | 'pine' | 'sapling' | 'fruit' | 'blossom';
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
  const landmarks = createMapLandmarks(gridSize);
  const water = createMapWater(gridSize, paths);
  const terrain = createRegions(gridSize, paths, water.water, water.waterSolidPolygons);
  type Tree = Point & { scale: number; tone: number; rotation: number; species: TreeSpecies };
  type Rock = Point & { scale: number; rotation: number };
  const trees: Tree[] = [{ ...gridPoint(MAP_CONFIG.columns / 2 - 6, MAP_CONFIG.rows / 2 - 5), scale: 1, tone: 0, species: 'oak', rotation: .7 }, { ...gridPoint(MAP_CONFIG.columns / 2 - 7, MAP_CONFIG.rows / 2 + 3), scale: 1.1, tone: 1, species: 'sapling', rotation: 2.3 }];
  const rocks: Rock[] = [{ ...gridPoint(MAP_CONFIG.columns / 2 + 9, MAP_CONFIG.rows / 2 - 6), scale: 1, rotation: .5 }, { ...gridPoint(MAP_CONFIG.columns / 2 - 10, MAP_CONFIG.rows / 2 - 4), scale: 1.2, rotation: 2.1 }];
  const iron: Rock[] = [], forage: Rock[] = [], sceneryTrees: Tree[] = [];
  const roadDistance = (p: Point) => Math.sqrt(Math.min(...paths.flatMap(path => path.slice(1).map((b, i) => pathDistanceSquared(p, path[i], b)))));
  const crowded = (p: Point) => [...trees, ...rocks, ...iron, ...forage].some(t => Math.hypot(p.x - t.x, p.z - t.z) < 3.8);
  const treeSpecies = (biome: string): TreeSpecies => biome === 'conifers' || biome === 'rock' || biome === 'camp' ? 'pine' : biome === 'orchard' ? (random() < .55 ? 'fruit' : 'blossom') : biome === 'meadow' ? 'blossom' : biome === 'wetland' || biome === 'lake' ? 'sapling' : random() < .28 ? 'sapling' : 'oak';
  for (const region of terrain.regions) {
    const count = region.id === 'home' ? 9 : ['woodland','conifers'].includes(region.id) ? 22 : region.id === 'orchard' ? 18 : region.id === 'quarry' ? 14 : region.id === 'pass' ? 9 : 7;
    for (let placed = 0, attempt = 0; placed < count && attempt < 800; attempt++) {
      const a = random() * Math.PI * 2, r = .55 + random() * .3;
      const point = { x: region.x + Math.cos(a) * region.rx * gridSize * r, z: region.z + Math.sin(a) * region.rz * gridSize * r };
      if (region.id === 'home' && point.x > -14 && point.x < 17 && point.z > -15 && point.z < 11 || roadDistance(point) < 4.7 || crowded(point)) continue;
      if (isBlocked(point, 2, landmarks.obstacles) || polygonDistance(point, region.area) > -2.6 || !terrain.contains(point) || water.waterAreas.some(a => polygonDistance(point,a) < 2.4)) continue;
      const common = { ...point, scale: .9 + random() * .4, rotation: random() * Math.PI * 2 };
      if (region.id === 'quarry' && placed % 2 === 0 || region.id === 'pass' && placed % 3 === 0) iron.push(common);
      else if (region.id === 'orchard' && placed % 2 === 0 || region.id === 'woodland' && placed % 4 === 0 || region.id === 'home' && placed === 0) forage.push({ ...common, scale: 1 });
      else if (region.id === 'quarry' || region.id === 'stone-hollow' || placed % 4 === 2) rocks.push(common);
      else trees.push({ ...common, tone: Math.floor(random() * 3), species: treeSpecies(region.biome) });
      placed++;
    }
  }
  // Static woodland is scenery backed by an unwalkable terrain bank. Cutting
  // resource trees never erases the region boundary or opens a phantom shortcut.
  for (let z = -MAP_CONFIG.rows / 2 + 3; z < MAP_CONFIG.rows / 2 - 3; z += 2.7) for (let x = -MAP_CONFIG.columns / 2 + 3; x < MAP_CONFIG.columns / 2 - 3; x += 2.7) {
    const point = local(x + random() * 2, z + random() * 2);
    if (terrain.contains(point) || water.waterAreas.some(a => polygonDistance(point,a) < 2.5) || roadDistance(point) < 5
      || terrain.playable.some(a => Math.abs(polygonDistance(point, a)) < 2)) continue;
    const region = terrain.regions.reduce((a,b) => Math.hypot(a.x-point.x,a.z-point.z) < Math.hypot(b.x-point.x,b.z-point.z) ? a : b);
    sceneryTrees.push({ ...point, scale: .9 + random() * .6, tone: Math.floor(random() * 3), species: treeSpecies(region.biome), rotation: random() * Math.PI * 2 });
  }
  return { seed, ...water, trees, rocks, iron, forage, sceneryTrees, roadControls, ...terrain };
}
