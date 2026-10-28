import { isBlocked, moveCharacter } from './movement.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';

export interface WanderSettings {
  home: Point; areaRadius: number; bodyRadius: number; speed: number; bounds: Bounds;
}
export interface WanderState {
  position: Point; target?: Point; pause: number; blockedFor: number; walkingFor: number;
  distanceTravelled: number; destinationsReached: number;
}

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ value >>> 15, value | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

export function inBounds(point: Point, radius: number, bounds: Bounds): boolean {
  return point.x >= bounds.minX + radius && point.x <= bounds.maxX - radius
    && point.z >= bounds.minZ + radius && point.z <= bounds.maxZ - radius;
}

/** Local wander targets must be directly reachable; this intentionally needs no navigation library. */
export function segmentIsClear(from: Point, to: Point, radius: number, bounds: Bounds, obstacles: readonly Obstacle[]): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / (radius * 0.45)));
  for (let i = 0; i <= steps; i++) {
    const point = { x: from.x + (to.x - from.x) * i / steps, z: from.z + (to.z - from.z) * i / steps };
    if (!inBounds(point, radius, bounds) || isBlocked(point, radius, obstacles)) return false;
  }
  return true;
}

export function createWanderState(spawn: Point, settings: WanderSettings, obstacles: readonly Obstacle[], random: () => number): WanderState {
  if (!inBounds(spawn, settings.bodyRadius, settings.bounds) || isBlocked(spawn, settings.bodyRadius, obstacles)) {
    throw new Error('Resident spawn must be on walkable land.');
  }
  return {
    position: { x: spawn.x, z: spawn.z }, pause: 0.3 + random() * 1.1, blockedFor: 0,
    walkingFor: 0, distanceTravelled: 0, destinationsReached: 0,
  };
}

export function stepWander(state: WanderState, settings: WanderSettings, seconds: number, obstacles: readonly Obstacle[], random: () => number): Point {
  const dt = Math.max(0, Math.min(seconds, 0.1));
  if (dt === 0) return { x: 0, z: 0 };
  if (state.pause > 0) { state.pause = Math.max(0, state.pause - dt); return { x: 0, z: 0 }; }
  if (!state.target) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * settings.areaRadius;
      const candidate = { x: settings.home.x + Math.sin(angle) * distance, z: settings.home.z + Math.cos(angle) * distance };
      if (Math.hypot(candidate.x - state.position.x, candidate.z - state.position.z) < 0.9) continue;
      if (segmentIsClear(state.position, candidate, settings.bodyRadius, settings.bounds, obstacles)) {
        state.target = candidate; state.walkingFor = 0; state.blockedFor = 0; break;
      }
    }
    if (!state.target) { state.pause = 0.4 + random() * 0.6; return { x: 0, z: 0 }; }
  }
  const dx = state.target.x - state.position.x, dz = state.target.z - state.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.1) {
    state.target = undefined; state.pause = 0.8 + random() * 2.2; state.destinationsReached++;
    return { x: 0, z: 0 };
  }
  const speed = Math.min(settings.speed, distance / dt);
  const next = moveCharacter(state.position, { x: dx / distance, z: dz / distance }, dt, speed, settings.bounds, obstacles, settings.bodyRadius);
  const moved = Math.hypot(next.x - state.position.x, next.z - state.position.z);
  const velocity = { x: (next.x - state.position.x) / dt, z: (next.z - state.position.z) / dt };
  state.position = next; state.distanceTravelled += moved;
  state.walkingFor += dt; state.blockedFor = moved < speed * dt * 0.15 ? state.blockedFor + dt : 0;
  if (state.blockedFor > 0.6 || state.walkingFor > 14) {
    state.target = undefined; state.pause = 0.2 + random() * 0.5;
  }
  return velocity;
}
