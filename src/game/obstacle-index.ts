import type { Obstacle, Bounds } from './movement.ts';
import { isImmutableObstacles, obstacleComponents } from './navigation-geometry.ts';
import { Octree } from '@babylonjs/core/Culling/Octrees/octree.js';
import { BoundingBox } from '@babylonjs/core/Culling/boundingBox.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';

// Babylon's generic Octree also indexes data without a Scene. Put footprints
// on a non-bisecting plane so zero-height entries don't duplicate along Y.
const FLAT_Y=1/3;
interface Entry{obstacle:Obstacle;min:Vector3;max:Vector3;box:BoundingBox}
const indexes=new WeakMap<readonly Obstacle[],Octree<Entry>>();
const planes=Array.from({length:6},()=>new Plane(0,0,0,0));
const counters={queries:0,candidates:0,indexBuilds:0,indexBuildMs:0};
export const collisionMetrics=()=>({...counters});
export function obstacleBounds(o:Obstacle):Bounds{
  if(o.kind==='polygon')return o.bounds;
  const x=o.kind==='circle'?o.radius:o.halfWidth,z=o.kind==='circle'?o.radius:o.halfDepth;
  return {minX:o.x-x,maxX:o.x+x,minZ:o.z-z,maxZ:o.z+z};
}
/** Immutable versions are indexed once. Mutable overlays are always read live;
 * polygon holes and exact swept-circle behavior remain in the narrow phase. */
export function obstacleCandidates(obstacles:readonly Obstacle[],bounds:Bounds):readonly Obstacle[]{
  counters.queries++;
  const parts=obstacleComponents(obstacles);
  if(parts)return parts.flatMap(p=>obstacleCandidates(p,bounds));
  if(obstacles.length<32||!isImmutableObstacles(obstacles)){counters.candidates+=obstacles.length;return obstacles;}
  let tree=indexes.get(obstacles);
  if(!tree){
    const start=performance.now();
    const entries=obstacles.map(obstacle=>{const b=obstacleBounds(obstacle),min=new Vector3(b.minX,FLAT_Y,b.minZ),max=new Vector3(b.maxX,FLAT_Y,b.maxZ);return {obstacle,min,max,box:new BoundingBox(min,max)};});
    tree=new Octree<Entry>((entry,block)=>{if(entry.box.intersectsMinMax(block.minPoint,block.maxPoint))block.entries.push(entry);},16,5);
    tree.update(new Vector3(Math.min(...entries.map(e=>e.min.x))-.01,0,Math.min(...entries.map(e=>e.min.z))-.01),
      new Vector3(Math.max(...entries.map(e=>e.max.x))+.01,1,Math.max(...entries.map(e=>e.max.z))+.01),entries);
    indexes.set(obstacles,tree);counters.indexBuilds++;counters.indexBuildMs+=performance.now()-start;
  }
  const values=[[1,0,0,-bounds.minX],[-1,0,0,bounds.maxX],[0,0,1,-bounds.minZ],[0,0,-1,bounds.maxZ],[0,1,0,0],[0,-1,0,1]];
  values.forEach(([x,y,z,d],i)=>{planes[i].normal.set(x,y,z);planes[i].d=d;});
  const found=tree.select(planes,false);counters.candidates+=found.length;
  return found.data.slice(0,found.length).map(entry=>entry.obstacle);
}
