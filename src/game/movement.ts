export interface Point { x: number; z: number }
export type Obstacle =
  | { kind: 'box'; x: number; z: number; halfWidth: number; halfDepth: number }
  | { kind: 'circle'; x: number; z: number; radius: number };

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

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
    if (!isBlocked({ x: nextX, z: result.z }, radius, obstacles)) result.x = nextX;
    const nextZ = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, result.z + direction.z * distance / steps));
    if (!isBlocked({ x: result.x, z: nextZ }, radius, obstacles)) result.z = nextZ;
  }
  return result;
}
