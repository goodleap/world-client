import type { Point } from './movement.ts';

/** Linear interception at release, never homing after release. If a unit will
 * finish its last route segment first, aim at that stopping point instead. */
export function leadShot(from: Point, target: Point, velocity: Point, speed: number, stop?: Point) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const approach = dx * velocity.x + dz * velocity.z;
  const speedSquared = velocity.x ** 2 + velocity.z ** 2;
  const difference = speed ** 2 - speedSquared;
  const time = difference > 1e-8
    ? (approach + Math.sqrt(approach ** 2 + difference * (dx ** 2 + dz ** 2))) / difference : 0;
  let point = { ...target };
  if (time > 0 && time <= 3) {
    point = { x: target.x + velocity.x * time, z: target.z + velocity.z * time };
    if (stop && Math.hypot(stop.x - target.x, stop.z - target.z) <= Math.sqrt(speedSquared) * time) point = { ...stop };
  }
  return { point, duration: Math.max(.001, Math.hypot(point.x - from.x, point.z - from.z) / speed) };
}
