export interface Point { x: number; z: number }
export type Obstacle =
  | { kind: 'box'; x: number; z: number; halfWidth: number; halfDepth: number }
  | { kind: 'circle'; x: number; z: number; radius: number };

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

function pointSegmentDistanceSquared(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dz = to.z - from.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / length)) : 0;
  return (point.x - from.x - t * dx) ** 2 + (point.z - from.z - t * dz) ** 2;
}

/** Exact swept disc against circles and rounded box corners. Sampling a segment
 * can miss a grazing contact, so the planner and follower must share this test. */
export function sweepIsBlocked(from: Point, to: Point, radius: number, obstacles: readonly Obstacle[]): boolean {
  return obstacles.some(obstacle => {
    if (obstacle.kind === 'circle') {
      return pointSegmentDistanceSquared(obstacle, from, to) < (radius + obstacle.radius) ** 2 - 1e-10;
    }
    const minX = obstacle.x - obstacle.halfWidth, maxX = obstacle.x + obstacle.halfWidth;
    const minZ = obstacle.z - obstacle.halfDepth, maxZ = obstacle.z + obstacle.halfDepth;
    const dx = to.x - from.x, dz = to.z - from.z;
    let enter = 0, exit = 1;
    for (const [origin, delta, min, max] of [[from.x, dx, minX, maxX], [from.z, dz, minZ, maxZ]]) {
      if (Math.abs(delta) < 1e-12) {
        if (origin < min || origin > max) { enter = 2; break; }
      } else {
        const a = (min - origin) / delta, b = (max - origin) / delta;
        enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (enter <= exit) return true;
    // For disjoint segments/rectangles, the closest pair contains a segment
    // endpoint or a rectangle corner. This retains genuinely round corners.
    const endpointDistance = (p: Point) => (p.x - Math.max(minX, Math.min(maxX, p.x))) ** 2
      + (p.z - Math.max(minZ, Math.min(maxZ, p.z))) ** 2;
    const squared = Math.min(endpointDistance(from), endpointDistance(to),
      pointSegmentDistanceSquared({ x: minX, z: minZ }, from, to), pointSegmentDistanceSquared({ x: minX, z: maxZ }, from, to),
      pointSegmentDistanceSquared({ x: maxX, z: minZ }, from, to), pointSegmentDistanceSquared({ x: maxX, z: maxZ }, from, to));
    return squared < radius * radius - 1e-10;
  });
}

export function normalizeInput(x: number, z: number): Point {
  const length = Math.hypot(x, z);
  return length > 1 ? { x: x / length, z: z / length } : { x, z };
}

export function isBlocked(position: Point, radius: number, obstacles: readonly Obstacle[]): boolean {
  return obstacles.some((obstacle) => {
    if (obstacle.kind === 'circle') {
      return Math.hypot(position.x - obstacle.x, position.z - obstacle.z) < radius + obstacle.radius;
    }
    const nearestX = Math.max(obstacle.x - obstacle.halfWidth, Math.min(position.x, obstacle.x + obstacle.halfWidth));
    const nearestZ = Math.max(obstacle.z - obstacle.halfDepth, Math.min(position.z, obstacle.z + obstacle.halfDepth));
    return Math.hypot(position.x - nearestX, position.z - nearestZ) < radius;
  });
}

/** Small swept steps prevent tunneling; separate axes let the character slide along walls. */
export function moveCharacter(
  from: Point, input: Point, seconds: number, speed: number,
  bounds: Bounds, obstacles: readonly Obstacle[], radius = 0.3,
): Point {
  const direction = normalizeInput(input.x, input.z);
  const distance = Math.max(0, Math.min(seconds, 0.1)) * speed;
  const steps = Math.max(1, Math.ceil(distance / (radius * 0.5)));
  // Engine vectors expose x/z as accessors, so copying enumerable fields loses them.
  const result = { x: from.x, z: from.z };
  for (let step = 0; step < steps; step++) {
    const nextX = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, result.x + direction.x * distance / steps));
    if (!sweepIsBlocked(result, { x: nextX, z: result.z }, radius, obstacles)) result.x = nextX;
    const nextZ = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, result.z + direction.z * distance / steps));
    if (!sweepIsBlocked(result, { x: result.x, z: nextZ }, radius, obstacles)) result.z = nextZ;
  }
  return result;
}
