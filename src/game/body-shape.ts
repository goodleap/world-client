import type { Point } from './movement.ts';

/** Physical ground discs, shared by residents, navigation and combat movement.
 * Attack/contact reach is a separate combat parameter, not a collider size. */
export const BODY_RADIUS = { farmer: .29, infantry: .4, archer: .4, cavalry: .6, dog: .54, wolf: .72 } as const;
export const bodyObstacle = (p: Point, radius: number) => ({ kind: 'circle' as const, x: p.x, z: p.z, radius });

/** Facing follows motion; it never gates translation or needs extra clearance. */
export function turnTowards(from: number, to: number, seconds: number, rate = 14) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * (1 - Math.exp(-seconds * rate));
}
