import * as core from '@recast-navigation/core';
import * as generators from '@recast-navigation/generators';
import { InjectGenerators } from '@babylonjs/addons/navigation/generator/injection.js';
import { CreateNavigationPluginAsync } from '@babylonjs/addons/navigation/factory/factory.single-thread.js';
import { RecastNavigationJSPluginV2 } from '@babylonjs/addons/navigation/plugin/RecastNavigationJSPlugin.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { IObstacle } from '@babylonjs/core/Navigation/INavigationEngine.js';
import { RecastJSCrowd } from '@babylonjs/addons/navigation/plugin/RecastJSCrowd.js';
import clipping from 'polygon-clipping';
import earcut,{flatten} from 'earcut';
import type { Bounds,Obstacle,Point } from './movement.ts';
import { sweepIsBlocked,isBlocked } from './movement.ts';
import type { PathQuery } from './path-planner.ts';
import { occupiedApproach, MOVE_DESTINATION_RADIUS } from './work-navigation.ts';
import { inBounds } from './wander.ts';
import { WaitForFullTileCacheUpdate } from '@babylonjs/addons/navigation/common/tile-cache.js';

let initialization:Promise<void>|undefined;
export async function initializeNativeNavigation(){await (initialization??=core.init());}
const CELL=.1, CLEARANCE=CELL;
const xyz=(p:Point)=>({x:p.x,y:.2,z:p.z});
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);

/** Navigation Plugin V2 owns Recast generation, Detour queries and tile updates.
 * Only walkable footprint geometry and game-specific endpoint rules live here.
 * The NullEngine is a build-time mesh adapter; it never renders or owns actors. */
export async function createNativeNavigation(){
  await initializeNativeNavigation();
  const injection={...core,...generators};
  const initial=await CreateNavigationPluginAsync({instance:injection});initial.dispose();
  const engine=new NullEngine(),scene=new Scene(engine);
  const profiles=new Map<string,{plugin:RecastNavigationJSPluginV2;obstacles:Map<string,IObstacle[]>;terrain:string}>();
  const pinned=new Set<RecastNavigationJSPluginV2>();
  const crowds=new Map<RecastJSCrowd,RecastNavigationJSPluginV2>();
  const meshes=new Map<string,Mesh>();
  type GeometryKey={terrain:string;dynamic:Map<string,Exclude<Obstacle,{kind:'polygon'}>>};
  const geometryKeys=new WeakMap<readonly Obstacle[],Map<string,GeometryKey>>();
  const stats={backend:'Babylon Navigation Plugin V2',builds:0,buildMs:0,queries:0,queryMs:0,obstacleAdds:0,obstacleRemoves:0};
  function describe(solids:readonly Obstacle[],bounds:Bounds){
    const boundsKey=JSON.stringify(bounds);let versions=geometryKeys.get(solids);
    if(!versions)geometryKeys.set(solids,versions=new Map());
    let keys=versions.get(boundsKey);if(keys)return keys;
    const terrain=JSON.stringify([bounds,solids.filter(o=>o.kind==='polygon'||o.kind==='circle'&&o.radius>2.5)]);
    const dynamic=new Map(solids.filter((o):o is Exclude<Obstacle,{kind:'polygon'}>=>o.kind==='box'||o.kind==='circle'&&o.radius<=2.5).map(o=>[JSON.stringify(o),o]));
    keys={terrain,dynamic};versions.set(boundsKey,keys);return keys;
  }
  function ground(key:string,bounds:Bounds,solids:readonly Obstacle[]){
    let mesh=meshes.get(key);if(mesh)return mesh;
    const rectangle:clipping.Polygon=[[[bounds.minX,bounds.minZ],[bounds.maxX,bounds.minZ],[bounds.maxX,bounds.maxZ],[bounds.minX,bounds.maxZ]]];
    const blocked:clipping.Polygon[]=solids.flatMap(o=>{
      if(o.kind==='polygon')return [[o.points.map(p=>[p.x,p.z] as clipping.Pair),...(o.holes??[]).map(h=>h.points.map(p=>[p.x,p.z] as clipping.Pair))]];
      if(o.kind!=='circle'||o.radius<=2.5)return [];
      // Large exclusion areas exceed Detour TileCache's touched-tile capacity.
      // Bake their footprint with Recast instead. Circumscribed vertices keep
      // the approximation outside the requested area (under half a voxel).
      const count=Math.ceil(Math.PI/Math.acos(o.radius/(o.radius+CELL*.5))),r=o.radius/Math.cos(Math.PI/count);
      return [[Array.from({length:count},(_,i)=>[o.x+Math.cos(i*Math.PI*2/count)*r,o.z+Math.sin(i*Math.PI*2/count)*r] as clipping.Pair)]];
    });
    const land=blocked.length?clipping.difference(rectangle,...blocked):[rectangle];
    const positions:number[]=[],indices:number[]=[];
    for(const poly of land){
      const flat=flatten(poly),offset=positions.length/3;
      for(let i=0;i<flat.vertices.length;i+=2)positions.push(flat.vertices[i],0,flat.vertices[i+1]);
      // Babylon's default left-handed winding is reversed by the V2 adapter.
      indices.push(...earcut(flat.vertices,flat.holes,2).map(i=>i+offset));
    }
    mesh=new Mesh('navigation-footprint',scene);const data=new VertexData();data.positions=positions;data.indices=indices;data.applyToMesh(mesh);
    meshes.set(key,mesh);return mesh;
  }
  function profile(radius:number,bounds:Bounds,solids:readonly Obstacle[]){
    const description=describe(solids,bounds),key=`${radius}/${description.terrain}`;
    let record=profiles.get(key);
    if(!record){
      const started=performance.now(),plugin=new RecastNavigationJSPluginV2(injection);
      InjectGenerators(plugin);
      plugin.createNavMesh([ground(description.terrain,bounds,solids)],{cs:CELL,ch:.2,walkableSlopeAngle:45,
        walkableHeight:10,walkableClimb:1,walkableRadius:Math.ceil((radius+CLEARANCE)/CELL),maxEdgeLen:80,maxSimplificationError:1.3,
        minRegionArea:8,mergeRegionArea:20,maxVertsPerPoly:6,detailSampleDist:6,detailSampleMaxError:1,tileSize:64,maxObstacles:2048});
      record={plugin,obstacles:new Map(),terrain:description.terrain};profiles.set(key,record);stats.builds++;stats.buildMs+=performance.now()-started;
    }
    profiles.delete(key);profiles.set(key,record);
    while(profiles.size>8){const oldest=[...profiles].find(([k,r])=>k!==key&&!pinned.has(r.plugin));if(!oldest)break;
      profiles.delete(oldest[0]);oldest[1].plugin.dispose();
      if(![...profiles.values()].some(r=>r.terrain===oldest[1].terrain)){meshes.get(oldest[1].terrain)?.dispose();meshes.delete(oldest[1].terrain);}
    }
    const {plugin,obstacles}=record;
    let queued=0;
    const flush=()=>{if(queued){WaitForFullTileCacheUpdate(plugin.navMesh!,plugin.tileCache!);queued=0;}};
    const queuedChange=()=>{if(++queued>=48)flush();};
    for(const [id,parts]of obstacles)if(!description.dynamic.has(id)){for(const part of parts){plugin.removeObstacle(part,true);queuedChange();stats.obstacleRemoves++;}obstacles.delete(id);}
    for(const [id,o]of description.dynamic)if(!obstacles.has(id)){
      // TileCache obstacles carve after erosion: include the body's clearance.
      const parts:IObstacle[]=[];
      const add=(part:IObstacle|null)=>{if(!part)throw new Error('Native navigation obstacle capacity exceeded');parts.push(part);queuedChange();stats.obstacleAdds++;};
      if(o.kind==='circle')add(plugin.addCylinderObstacle({x:o.x,y:-1,z:o.z},o.radius+radius+CLEARANCE,4,true));
      else{
        // OBB tile queries use a conservative diagonal AABB. Split large
        // buildings into exact adjacent boxes within its native tile limit.
        const width=2*(o.halfWidth+radius+CLEARANCE),depth=2*(o.halfDepth+radius+CLEARANCE),cols=Math.ceil(width/4.4),rows=Math.ceil(depth/4.4);
        for(let z=0;z<rows;z++)for(let x=0;x<cols;x++)add(plugin.addBoxObstacle(
          {x:o.x-width/2+(x+.5)*width/cols,y:0,z:o.z-depth/2+(z+.5)*depth/rows},
          {x:width/cols/2,y:2,z:depth/rows/2},0,true));
      }
      obstacles.set(id,parts);
    }
    flush();
    return plugin;
  }
  const api={
    profile,
    createCrowd(bounds:Bounds,solids:readonly Obstacle[],capacity=1024){
      const plugin=profile(0,bounds,solids);pinned.add(plugin);plugin.setTimeStep(.05);
      const crowd=new RecastJSCrowd(plugin,capacity,.72,scene);crowds.set(crowd,plugin);return crowd;
    },
    releaseCrowd(crowd:RecastJSCrowd){const plugin=crowds.get(crowd);if(!plugin)return;crowds.delete(crowd);crowd.dispose();if(![...crowds.values()].includes(plugin))pinned.delete(plugin);},
    scene,
    plan(q:PathQuery){
      if(!q.move)return api.path(q.start,q.goals,q.radius,q.bounds,q.obstacles);
      const goal=q.goals[0],valid=(p:Point)=>inBounds(p,q.radius,q.bounds)&&!isBlocked(p,q.radius,q.obstacles)&&!occupiedApproach(p,q.radius,q.neighbours??[]);
      const exact=valid(goal)?api.path(q.start,[goal],q.radius,q.bounds,q.obstacles):undefined;
      if(exact)return exact;
      const query=profile(q.radius,q.bounds,q.obstacles).navMeshQuery;
      const polygons=query.queryPolygons(xyz(goal),{x:MOVE_DESTINATION_RADIUS,y:2,z:MOVE_DESTINATION_RADIUS},{maxPolys:2048});
      const candidates:Point[]=[];
      for(const ref of polygons.polyRefs){const point=query.closestPointOnPoly(ref,xyz(goal));if(point.success)candidates.push({x:point.closestPoint.x,z:point.closestPoint.z});}
      // Endpoint spacing is a game rule. Detour still projects and searches
      // every alternative; there is no secondary grid or local A*.
      for(const n of q.neighbours??[])for(const p of [n.position,...(n.destination?[n.destination]:[])]){
        if(dist(p,goal)>MOVE_DESTINATION_RADIUS+q.radius+n.radius)continue;
        for(let i=0;i<8;i++){const angle=i*Math.PI/4,d=q.radius+n.radius+.12;
          const near=query.findClosestPoint(xyz({x:p.x+Math.cos(angle)*d,z:p.z+Math.sin(angle)*d}),{halfExtents:{x:1,y:2,z:1}});
          if(near.success)candidates.push({x:near.point.x,z:near.point.z});
        }
      }
      const seen=new Set<string>();
      const goals=candidates.filter(p=>{const key=`${p.x.toFixed(3)},${p.z.toFixed(3)}`;if(seen.has(key))return false;seen.add(key);return dist(p,goal)<=MOVE_DESTINATION_RADIUS;})
        .sort((a,b)=>dist(a,goal)-dist(b,goal)||dist(a,q.start)-dist(b,q.start));
      for(const candidate of goals)if(valid(candidate)){const path=api.path(q.start,[candidate],q.radius,q.bounds,q.obstacles);if(path)return path;}
      return undefined;
    },
    path(start:Point,goals:readonly Point[],radius:number,bounds:Bounds,solids:readonly Obstacle[]){
      const plugin=profile(radius,bounds,solids),begin=performance.now();stats.queries++;
      try{
        for(const goal of goals){
          if(isBlocked(goal,radius,solids))continue;
          const result=plugin.navMeshQuery.computePath(xyz(start),xyz(goal),{halfExtents:{x:1,y:2,z:1},maxPathPolys:4096,maxStraightPathPoints:512});
          if(!result.success||!result.path.length)continue;
          let path=result.path.map(p=>({x:p.x,z:p.z}));
          if(dist(path[0],start)<1e-5)path.shift();
          if(!path.length)path=[{...goal}];
          if(dist(path.at(-1)!,goal)>1)continue;
          if(dist(path.at(-1)!,goal)>.001)path.push({...goal});else path[path.length-1]={...goal};
          // A NavMesh projection may cross a gap to a different island. Exact
          // game geometry rejects such joins; never fabricate a reachable path.
          if(path.every((p,i)=>!sweepIsBlocked(i?path[i-1]:start,p,radius,solids)))return path;
        }
        return undefined;
      }finally{stats.queryMs+=performance.now()-begin;}
    },
    snapshot:()=>({...stats,profiles:profiles.size}),
    dispose(){for(const crowd of [...crowds.keys()])api.releaseCrowd(crowd);for(const p of profiles.values())p.plugin.dispose();profiles.clear();scene.dispose();engine.dispose();},
  };return api;
}
export type NativeNavigation=Awaited<ReturnType<typeof createNativeNavigation>>;
