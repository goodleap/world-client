import type { Obstacle, Point } from './movement.ts';
import type { PolygonArea } from './polygon.ts';

const immutable = new WeakSet<readonly Obstacle[]>();
const contents = new WeakMap<readonly Obstacle[], string>();
const combinations = new WeakMap<readonly Obstacle[], WeakMap<readonly Obstacle[], readonly Obstacle[]>>();
const point = (p: Point) => Object.freeze({ x: p.x, z: p.z });
function polygon(p: PolygonArea): PolygonArea {
  return Object.freeze({ x:p.x, z:p.z, bounds:Object.freeze({...p.bounds}),
    points:Object.freeze(p.points.map(point)), ...(p.holes ? {holes:Object.freeze(p.holes.map(polygon))} : {}) });
}

/** Published geometry is immutable, including polygon rings. Only its producer
 * creates a new version; queued searches can safely retain the old reference. */
export function immutableObstacles(obstacles: readonly Obstacle[], previous?: readonly Obstacle[]): readonly Obstacle[] {
  if (immutable.has(obstacles)) return obstacles;
  if (previous && immutable.has(previous)) {
    const key = JSON.stringify(obstacles);
    let old = contents.get(previous);
    if (old === undefined) { old = JSON.stringify(previous); contents.set(previous, old); }
    if (key === old) return previous;
  }
  const result = Object.freeze(obstacles.map((o): Obstacle => o.kind === 'polygon'
    ? Object.freeze({kind:'polygon', ...polygon(o)})
    : o.kind === 'circle' ? Object.freeze({kind:'circle', x:o.x, z:o.z, radius:o.radius})
    : Object.freeze({kind:'box', x:o.x, z:o.z, halfWidth:o.halfWidth, halfDepth:o.halfDepth})));
  immutable.add(result); return result;
}

/** Reuse the world + danger/field overlay without recopying the map per actor. */
export function combineObstacles(base: readonly Obstacle[], overlay: readonly Obstacle[]): readonly Obstacle[] {
  if (!overlay.length) return base;
  if (!base.length) return overlay;
  if (!immutable.has(base) || !immutable.has(overlay)) return [...base, ...overlay];
  let variants = combinations.get(base);
  if (!variants) { variants = new WeakMap(); combinations.set(base, variants); }
  let result = variants.get(overlay);
  if (!result) { result = Object.freeze([...base, ...overlay]); immutable.add(result); variants.set(overlay, result); }
  return result;
}

export interface GeometrySnapshot { id:number; obstacles:readonly Obstacle[] }
export interface GeometryMessage { id:number; obstacles?:readonly Obstacle[] }
const LIMIT = 8;
function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key); map.set(key, value);
  if (map.size > LIMIT) map.delete(map.keys().next().value!);
}

/** The common immutable world takes O(1) to identify. Unpublished/mutable
 * callers still get value-based snapshots, so in-place edits cannot go stale. */
export function createGeometrySender() {
  let serial = 0, uploads = 0;
  let byArray = new WeakMap<readonly Obstacle[], GeometrySnapshot>();
  const byValue = new Map<string, GeometrySnapshot>(), sent = new Map<number, true>();
  return {
    snapshot(obstacles: readonly Obstacle[]): GeometrySnapshot {
      const fixed = immutable.has(obstacles);
      const known = fixed ? byArray.get(obstacles) : undefined;
      if (known) return known;
      const key = fixed ? undefined : JSON.stringify(obstacles);
      let value = key === undefined ? undefined : byValue.get(key);
      if (!value) value = {id:++serial, obstacles:immutableObstacles(obstacles)};
      if (fixed) byArray.set(obstacles, value);
      else remember(byValue, key!, value);
      return value;
    },
    encode(geometry: GeometrySnapshot): GeometryMessage {
      const upload = !sent.has(geometry.id); remember(sent, geometry.id, true);
      if (upload) uploads++;
      return {id:geometry.id, ...(upload ? {obstacles:geometry.obstacles} : {})};
    },
    get uploads() { return uploads; },
    clear() { byArray = new WeakMap(); byValue.clear(); sent.clear(); },
  };
}

/** Both ends use the same bounded LRU. An evicted version is uploaded again;
 * a request never silently falls back to a different map. */
export function createGeometryReceiver() {
  const cache = new Map<number, readonly Obstacle[]>();
  return (message: GeometryMessage): readonly Obstacle[] => {
    const obstacles = message.obstacles ?? cache.get(message.id);
    if (!obstacles) throw new Error('Missing navigation geometry');
    remember(cache, message.id, obstacles); return obstacles;
  };
}
