import type { Point } from './movement.ts';

const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x, a.z-b.z);
/** Interpolate only completed swept legs. A stale trace after stopping/loading
 * is ignored; visual positions never enter gameplay or save state. */
export function sampleMotionPath(from: Point, to: Point, alpha: number, path?: readonly Point[]): Point {
  const lerp = (a: Point, b: Point, t: number) => ({ x: a.x+(b.x-a.x)*t, z: a.z+(b.z-a.z)*t });
  if (!path || path.length < 3 || distance(path[0], from) > 1e-7 || distance(path.at(-1)!, to) > 1e-7)
    return lerp(from, to, alpha);
  let length = 0;
  for (let i = 1; i < path.length; i++) length += distance(path[i-1], path[i]);
  let remaining = length * alpha;
  for (let i = 1; i < path.length; i++) {
    const leg = distance(path[i-1], path[i]);
    if (leg > 1e-8 && remaining <= leg) return lerp(path[i-1], path[i], remaining/leg);
    remaining -= leg;
  }
  return { x: to.x, z: to.z };
}
