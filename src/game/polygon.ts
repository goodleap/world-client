import type { Point, Bounds } from './movement.ts';

export interface PolygonArea extends Point {
  points: readonly Point[];
  holes?: readonly PolygonArea[];
  bounds: Bounds;
}

export function polygonArea(points: readonly Point[]): PolygonArea {
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  return { points, bounds, x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
}

export function segmentDistanceSquared(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return (p.x - a.x - t * dx) ** 2 + (p.z - a.z - t * dz) ** 2;
}

export function insidePolygon(p: Point, area: PolygonArea): boolean {
  const { bounds: b, points } = area;
  if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (segmentDistanceSquared(p, a, b) < 1e-12) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside && !area.holes?.some(hole => insidePolygon(p, hole));
}

export function polygonDistance(p: Point, area: PolygonArea) {
  let squared = Infinity;
  for (const ring of [area, ...area.holes ?? []]) for (let i = 0; i < ring.points.length; i++) squared = Math.min(squared,
    segmentDistanceSquared(p, ring.points[i], ring.points[(i + 1) % ring.points.length]));
  return Math.sqrt(squared) * (insidePolygon(p, area) ? -1 : 1);
}

/** Exact swept disk against the same polyline used by the shoreline mesh. */
export function sweepHitsPolygon(from: Point, to: Point, radius: number, area: PolygonArea) {
  const b = area.bounds;
  if (Math.max(from.x, to.x) + radius < b.minX || Math.min(from.x, to.x) - radius > b.maxX
    || Math.max(from.z, to.z) + radius < b.minZ || Math.min(from.z, to.z) - radius > b.maxZ) return false;
  if (insidePolygon(from, area) || insidePolygon(to, area)) return true;
  return sweepHitsBoundary(from, to, radius, area) || (area.holes?.some(hole => sweepHitsBoundary(from, to, radius, hole)) ?? false);
}

function sweepHitsBoundary(from: Point, to: Point, radius: number, area: PolygonArea) {
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < area.points.length; i++) {
    const a = area.points[i], c = area.points[(i + 1) % area.points.length];
    // Include touching/collinear segments, but not disjoint collinear spans.
    const intersects = cross(from, to, a) * cross(from, to, c) <= 0 && cross(a, c, from) * cross(a, c, to) <= 0
      && Math.max(from.x, to.x) >= Math.min(a.x, c.x) && Math.min(from.x, to.x) <= Math.max(a.x, c.x)
      && Math.max(from.z, to.z) >= Math.min(a.z, c.z) && Math.min(from.z, to.z) <= Math.max(a.z, c.z);
    if (intersects || Math.min(segmentDistanceSquared(from, a, c), segmentDistanceSquared(to, a, c),
      segmentDistanceSquared(a, from, to), segmentDistanceSquared(c, from, to)) < radius * radius - 1e-10) return true;
  }
  return false;
}
