import type { Projectile } from './combat.ts';

/** Position and orientation share the same parabola, including tower height. */
export function arrowFlight(p:Pick<Projectile,'from'|'to'|'elapsed'|'duration'>,visualLag=0){
  const t=Math.min(1,Math.max(0,p.elapsed-visualLag)/p.duration);
  const dx=p.to.x-p.from.x,dz=p.to.z-p.from.z,dy=(p.to.y??1.25)-(p.from.y??1.25);
  const height=Math.max(.14,Math.min(1.8,Math.hypot(dx,dz)*.14));
  return {position:{x:p.from.x+dx*t,y:(p.from.y??1.25)+dy*t+4*height*t*(1-t),z:p.from.z+dz*t},
    tangent:{x:dx,y:dy+4*height*(1-2*t),z:dz}};
}
