import type { Obstacle, Bounds } from './movement.ts';
import { isImmutableObstacles, obstacleComponents } from './navigation-geometry.ts';

// Navigation is 2D pure data, shared by workers without a Babylon scene. The
// render scene keeps its native octree; collision uses a versioned broad phase.
const SIZE=8, indexes=new WeakMap<readonly Obstacle[],Map<string,Obstacle[]>>();
const counters={queries:0,candidates:0,indexBuilds:0,indexBuildMs:0};
export const collisionMetrics=()=>({...counters});
export function obstacleBounds(o:Obstacle):Bounds{
  if(o.kind==='polygon')return o.bounds;
  const x=o.kind==='circle'?o.radius:o.halfWidth,z=o.kind==='circle'?o.radius:o.halfDepth;
  return {minX:o.x-x,maxX:o.x+x,minZ:o.z-z,maxZ:o.z+z};
}
function cells(b:Bounds,visit:(key:string)=>void){
  for(let x=Math.floor(b.minX/SIZE);x<=Math.floor(b.maxX/SIZE);x++)
    for(let z=Math.floor(b.minZ/SIZE);z<=Math.floor(b.maxZ/SIZE);z++)visit(`${x},${z}`);
}
/** Immutable versions are indexed once. Mutable overlays are always read live;
 * polygon holes and exact swept-circle behavior remain in the narrow phase. */
export function obstacleCandidates(obstacles:readonly Obstacle[],bounds:Bounds):readonly Obstacle[]{
  counters.queries++;
  const parts=obstacleComponents(obstacles);
  if(parts)return parts.flatMap(p=>obstacleCandidates(p,bounds));
  if(obstacles.length<32||!isImmutableObstacles(obstacles)){counters.candidates+=obstacles.length;return obstacles;}
  let grid=indexes.get(obstacles);
  if(!grid){
    const start=performance.now();grid=new Map();
    for(const o of obstacles)cells(obstacleBounds(o),key=>{let bucket=grid!.get(key);if(!bucket)grid!.set(key,bucket=[]);bucket.push(o);});
    indexes.set(obstacles,grid);counters.indexBuilds++;counters.indexBuildMs+=performance.now()-start;
  }
  const found=new Set<Obstacle>();
  cells(bounds,key=>{for(const o of grid!.get(key)??[])found.add(o);});
  counters.candidates+=found.size;return [...found];
}
