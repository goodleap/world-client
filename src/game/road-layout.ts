import { GRID_SIZE, ROADS } from './world-data.ts';
import type { Point } from './movement.ts';
import { createCurvedRoadPaths } from './landscape-layout.ts';

// Rendering and land placement share the same native curves and road width.
export const ROAD_HALF_WIDTH = GRID_SIZE * .95;
/** Low-frequency width changes and a wider village junction, in world units. */
export function roadHalfWidthAt(p: Point) {
  return 1.05 + .22 * Math.sin(p.x * .16 + p.z * .11) + .14 * Math.cos(p.z * .27)
    + .5 * Math.exp(-(p.x * p.x + (p.z - GRID_SIZE) ** 2) / 55);
}
export const ROAD_PATHS = createCurvedRoadPaths(ROADS, GRID_SIZE, GRID_SIZE / 4);

/** The same edge wobble is used by road paint, the detail mask and plants. */
export const paintedRoadHalfWidthAt=(p:Point)=>roadHalfWidthAt(p)*(1+.045*Math.sin(p.x*1.1+p.z*.7));
type Segment={a:Point;b:Point;dx:number;dz:number;length2:number};
const roadBuckets=new Map<string,Segment[]>(),bucketSize=8;
for(const path of ROAD_PATHS)for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],dx=b.x-a.x,dz=b.z-a.z,segment={a,b,dx,dz,length2:dx*dx+dz*dz};
  for(let z=Math.floor((Math.min(a.z,b.z)-5)/bucketSize);z<=Math.floor((Math.max(a.z,b.z)+5)/bucketSize);z++)
    for(let x=Math.floor((Math.min(a.x,b.x)-5)/bucketSize);x<=Math.floor((Math.max(a.x,b.x)+5)/bucketSize);x++){
      const key=`${x},${z}`,list=roadBuckets.get(key)??[];list.push(segment);roadBuckets.set(key,list);
    }
}
/** Signed distance to the painted dirt edge, capped at 3 outside roads.
 * Static terrain generation only visits nearby curve segments. */
export function roadEdgeDistance(point:Point){
  let nearest=3;
  for(const s of roadBuckets.get(`${Math.floor(point.x/bucketSize)},${Math.floor(point.z/bucketSize)}`)??[]){
    const t=s.length2?Math.max(0,Math.min(1,((point.x-s.a.x)*s.dx+(point.z-s.a.z)*s.dz)/s.length2)):0;
    const p={x:s.a.x+t*s.dx,z:s.a.z+t*s.dz};
    nearest=Math.min(nearest,Math.hypot(point.x-p.x,point.z-p.z)-paintedRoadHalfWidthAt(p));
  }
  return nearest;
}

export function nearRoad(point: Point, clearance: number) {
  if(clearance<3)return roadEdgeDistance(point)<clearance;
  return ROAD_PATHS.some(path => path.some((a, i) => {
    if (!i) return false;
    const b = path[i - 1], dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)) : 0;
    const p = { x: a.x + t * dx, z: a.z + t * dz };
    return (point.x - p.x) ** 2 + (point.z - p.z) ** 2 < (paintedRoadHalfWidthAt(p) + clearance) ** 2;
  }));
}
