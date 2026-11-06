import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { arrowFlight } from './arrow-flight.ts';
import { obstacleCandidates } from './obstacle-index.ts';
import { BUILDINGS, LANDSCAPE, MAP_WIDTH, MAP_DEPTH, TREES, GRID_SIZE } from './world-data.ts';
import { RESOURCE_NODES } from './economy-config.ts';
import { surfaceHeight } from './terrain-height.ts';
import { isImmutableObstacles } from './navigation-geometry.ts';
import { treeAsset, treeModelScale } from './tree-profile.ts';
import type { EconomyState } from './economy.ts';
import type { Obstacle, Point } from './movement.ts';

type Position=Point&{y:number};
export interface ShotCover {minimum:Vector3;maximum:Vector3}
const forward=new Ray(Vector3.Zero(),Vector3.Zero()),reverse=new Ray(Vector3.Zero(),Vector3.Zero());
const a=new Vector3(),b=new Vector3(),c=new Vector3(),d=new Vector3();
/** Same arc as the rendered arrow. Babylon performs every box/triangle test;
 * only game cover dimensions and the shared terrain grid are adapted here. */
export function clearArrowArc(from:Position,to:Position,covers:readonly ShotCover[],height=surfaceHeight){
  const segments=Math.max(4,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/1.5));
  const stepX=MAP_WIDTH/LANDSCAPE.geography.resolution,stepZ=MAP_DEPTH/LANDSCAPE.geography.resolution;
  let previous=from;
  for(let i=1;i<=segments;i++){
    const next=arrowFlight({from,to,elapsed:i/segments,duration:1}).position;
    forward.origin.set(previous.x,previous.y,previous.z);reverse.origin.set(next.x,next.y,next.z);
    reverse.origin.subtractToRef(forward.origin,forward.direction);forward.length=forward.direction.length();
    forward.direction.normalize();forward.direction.negateToRef(reverse.direction);reverse.length=forward.length;
    // Ray's box API tests a half-line, so require intersections from both
    // endpoints. This keeps obstacles beyond the finite flight segment out.
    if(covers.some(o=>forward.intersectsBoxMinMax(o.minimum,o.maximum)&&reverse.intersectsBoxMinMax(o.minimum,o.maximum)))return false;
    const left=Math.floor((Math.min(previous.x,next.x)+MAP_WIDTH/2)/stepX),right=Math.floor((Math.max(previous.x,next.x)+MAP_WIDTH/2)/stepX);
    const bottom=Math.floor((Math.min(previous.z,next.z)+MAP_DEPTH/2)/stepZ),top=Math.floor((Math.max(previous.z,next.z)+MAP_DEPTH/2)/stepZ);
    for(let row=bottom;row<=top;row++)for(let col=left;col<=right;col++){
      const x=col*stepX-MAP_WIDTH/2,z=row*stepZ-MAP_DEPTH/2;
      a.set(x,height(x,z),z);b.set(x+stepX,height(x+stepX,z),z);
      c.set(x,height(x,z+stepZ),z+stepZ);d.set(x+stepX,height(x+stepX,z+stepZ),z+stepZ);
      if(Math.min(previous.y,next.y)>Math.max(a.y,b.y,c.y,d.y)+.02)continue;
      if(forward.intersectsTriangle(a,b,c)||forward.intersectsTriangle(d,c,b))return false;
    }
    previous=next;
  }
  return true;
}
const resources=new Map(RESOURCE_NODES.map(n=>[`${n.x}/${n.z}`,n]));
// Authored environment.glb POSITION accessor maxima, before instance scaling.
// Keep shot cover tied to model height, not the unrelated walking radius.
const treeHeights:Record<string,number>={'oak-small':1.486,oak:2.001,'oak-large':2.588,pine:2.718};
export function createProjectileSight(state:EconomyState){
  let geometry:readonly Obstacle[]|undefined;
  const queries=new Map<string,boolean>();
  const covers=new WeakMap<Obstacle,ShotCover|undefined>(),ids=new WeakMap<Obstacle,string>();
  function sync(solids:readonly Obstacle[]){
    if(geometry===solids&&isImmutableObstacles(solids))return;geometry=solids;queries.clear();
    const buildings=new Map([...BUILDINGS,...state.sites].map(s=>[`${s.x}/${s.z}`,s]));
    for(const o of solids){
      if(o.kind==='polygon')continue; // Terrain height, not its walking footprint, blocks arrows.
      const key=`${o.x}/${o.z}`,building=buildings.get(key),resource=resources.get(key);
      if(building)ids.set(o,building.id);
      if(state.plots.some(p=>p.x===o.x&&p.z===o.z)||building&&'kind'in building&&building.kind==='farm'){covers.set(o,undefined);continue;}
      const base=surfaceHeight(o.x,o.z);
      // referenceHouse roof: wall offset .12 + rise 1.14 + ridge .17 + half tile .15.
      const roof=building&&(!('kind'in building)||['house','warehouse'].includes(building.kind))?1.58:0;
      const tree=resource?.kind==='wood'?TREES[Number(resource.id.slice(5))]:undefined;
      const height=building?building.height+roof:tree?treeHeights[treeAsset(tree.species,tree.size)]*GRID_SIZE*tree.scale*treeModelScale(tree.species,tree.size)
        :resource?resource.scale*(resource.kind==='food'?1.109*.7:resource.kind==='stone'?1.553*.63:1.45):6;
      const rx=o.kind==='box'?o.halfWidth:o.radius,rz=o.kind==='box'?o.halfDepth:o.radius;
      covers.set(o,{minimum:new Vector3(o.x-rx,base,o.z-rz),maximum:new Vector3(o.x+rx,base+height,o.z+rz)});
    }
  }
  return {clear(from:Position,to:Position,solids:readonly Obstacle[],ignored:ReadonlySet<string>){
    sync(solids);
    const key=JSON.stringify([from,to,[...ignored]]),cached=queries.get(key);if(cached!==undefined)return cached;
    const candidates=obstacleCandidates(solids,{minX:Math.min(from.x,to.x)-.05,maxX:Math.max(from.x,to.x)+.05,minZ:Math.min(from.z,to.z)-.05,maxZ:Math.max(from.z,to.z)+.05});
    const visible=candidates.flatMap(o=>{const id=ids.get(o),box=covers.get(o);return box&&(!id||!ignored.has(id))?[box]:[];});
    const clear=clearArrowArc(from,to,visible);queries.set(key,clear);
    if(queries.size>256)queries.delete(queries.keys().next().value!);
    return clear;
  }};
}
