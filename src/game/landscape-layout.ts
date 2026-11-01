import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { polygonArea, polygonDistance, segmentDistanceSquared } from './polygon.ts';
import type { Point } from './movement.ts';

export const LANDSCAPE_SEED = 20261101;
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

/** A fixed-seed review area. Curves are Babylon's native Catmull–Rom curves;
 * placement rules reserve the playable village, paths and working approaches. */
export function createLandscapeLayout(gridPoint: (x: number, z: number) => Point, gridSize: number, seed = LANDSCAPE_SEED) {
  const random = seededRandom(seed);
  const roadControls = [
    [[46, 0], [43, 21], [47, 36], [50, 49], [44, 63], [28, 75], [4, 80]],
    [[8, 33], [26, 35], [39, 45], [50, 49], [60, 51], [64, 56], [62, 75], [66, 100]],
  ].map(path => path.map(([x, z]) => gridPoint(x, z)));
  const controls = [[72, 20], [84, 15], [96, 22], [96, 40], [92, 53], [97, 69], [88, 82], [77, 77], [74, 65], [67, 56], [68, 47], [64, 37]];
  const shoreline = Curve3.CreateCatmullRomSpline(controls.map(([x, z]) => {
    const p = gridPoint(x, z); return new Vector3(p.x, 0, p.z);
  }), 16, true).getPoints();
  // Native closed curves repeat the first point. Keep the polygon non-degenerate.
  if (Vector3.DistanceSquared(shoreline[0], shoreline.at(-1)!) < 1e-10) shoreline.pop();
  const lake = polygonArea(shoreline.map(({ x, z }) => ({ x, z })));
  const reserved = createCurvedRoadPaths(roadControls, gridSize, gridSize / 4).flatMap(path => path.slice(1).map((p, i) => [path[i], p] as const));
  type Tree = Point & { scale: number; tone: number; rotation: number };
  type Rock = Point & { scale: number; rotation: number };
  const trees: Tree[] = [
    { ...gridPoint(44, 49), scale: 1, tone: 0, rotation: .7 },
    { ...gridPoint(43, 53), scale: 1.1, tone: 1, rotation: 2.3 },
  ];
  const rocks: Rock[] = [
    { ...gridPoint(59, 44), scale: 1, rotation: .5 },
    { ...gridPoint(40, 49), scale: 1.2, rotation: 2.1 },
  ];
  // The first review is concentrated around home and the west shore. Later map
  // regions deliberately wait for visual approval instead of multiplying assets.
  const patches = [
    [34, 38, 8, 8, 23], [33, 58, 9, 8, 22], [42, 31, 11, 5, 17],
    [58, 34, 5, 9, 17], [59, 63, 6, 5, 16], [40, 69, 9, 5, 15],
  ];
  const crowded = (p: Point, radius: number) => trees.some(n => Math.hypot(p.x - n.x, p.z - n.z) < n.scale * .5 + radius + 1.05)
    || rocks.some(n => Math.hypot(p.x - n.x, p.z - n.z) < n.scale * .85 + radius + 1.05);
  function allowed(p: Point, size: number, rock: boolean) {
    const column = p.x / gridSize + 50, row = 50 - p.z / gridSize;
    if (column > 43 && column < 58 && row > 43 && row < 59) return false;
    if (polygonDistance(p, lake) < 2.2 + size) return false;
    if (reserved.some(([a, b]) => segmentDistanceSquared(p, a, b) < (2.3 + size) ** 2)) return false;
    return !crowded(p, size * (rock ? .85 : .5));
  }
  for (const [cx, cz, rx, rz, count] of patches) {
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * 100; attempt++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
      const p = gridPoint(cx + Math.cos(angle) * rx * radius, cz + Math.sin(angle) * rz * radius);
      const scale = (.95 + random() * .65) * (placed % 4 === 2 ? 1.3 : 1);
      if (!allowed(p, scale, placed % 4 === 2)) continue;
      const rotation = random() * Math.PI * 2;
      if (placed % 4 === 2) rocks.push({ ...p, scale, rotation });
      else trees.push({ ...p, scale, tone: Math.floor(random() * 3), rotation });
      placed++;
    }
  }
  return { seed, lake, trees, rocks, roadControls };
}
