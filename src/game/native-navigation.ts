import * as core from '@recast-navigation/core';
import * as generators from '@recast-navigation/generators';
import { CreateNavigationPluginAsync } from '@babylonjs/addons/navigation/factory/factory.single-thread.js';
import type { RecastNavigationJSPluginV2 } from '@babylonjs/addons/navigation/plugin/RecastNavigationJSPlugin.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { IObstacle } from '@babylonjs/core/Navigation/INavigationEngine.js';
import clipping from 'polygon-clipping';
import earcut,{flatten} from 'earcut';
import type { Bounds,Obstacle,Point } from './movement.ts';
import { sweepIsBlocked,isBlocked } from './movement.ts';

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
  const engine=new NullEngine(),scene=new Scene(engine);
  const profiles=new Map<string,{plugin:RecastNavigationJSPluginV2;obstacles:Map<string,IObstacle>}>();
  const meshes=new Map<string,Mesh>();
  type GeometryKey={terrain:string;dynamic:Map<string,Exclude<Obstacle,{kind:'polygon'}>>};
  const geometryKeys=new WeakMap<readonly Obstacle[],Map<string,GeometryKey>>();
  const stats={backend:'Babylon Navigation Plugin V2',builds:0,buildMs:0,queries:0,queryMs:0,obstacleAdds:0,obstacleRemoves:0};
  function describe(solids:readonly Obstacle[],bounds:Bounds){
    const boundsKey=JSON.stringify(bounds);let versions=geometryKeys.get(solids);
    if(!versions)geometryKeys.set(solids,versions=new Map());
    let keys=versions.get(boundsKey);if(keys)return keys;
    const terrain=JSON.stringify([bounds,solids.filter(o=>o.kind==='polygon')]);
    const dynamic=new Map(solids.filter((o):o is Exclude<Obstacle,{kind:'polygon'}>=>o.kind!=='polygon').map(o=>[JSON.stringify(o),o]));
    keys={terrain,dynamic};versions.set(boundsKey,keys);return keys;
  }
  function ground(key:string,bounds:Bounds,solids:readonly Obstacle[]){
    let mesh=meshes.get(key);if(mesh)return mesh;
    const rectangle:clipping.Polygon=[[[bounds.minX,bounds.minZ],[bounds.maxX,bounds.minZ],[bounds.maxX,bounds.maxZ],[bounds.minX,bounds.maxZ]]];
    const blocked=solids.filter((o):o is Extract<Obstacle,{kind:'polygon'}>=>o.kind==='polygon').map(o=>[o.points.map(p=>[p.x,p.z] as clipping.Pair),...(o.holes??[]).map(h=>h.points.map(p=>[p.x,p.z] as clipping.Pair))]);
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
  async function profile(radius:number,bounds:Bounds,solids:readonly Obstacle[]){
    const description=describe(solids,bounds),key=`${radius}/${description.terrain}`;
    let record=profiles.get(key);
    if(!record){
      const started=performance.now(),plugin=await CreateNavigationPluginAsync({instance:{...core,...generators}});
      plugin.createNavMesh([ground(description.terrain,bounds,solids)],{cs:CELL,ch:.2,walkableSlopeAngle:45,
        walkableHeight:10,walkableClimb:1,walkableRadius:Math.ceil((radius+CLEARANCE)/CELL),maxEdgeLen:80,maxSimplificationError:.5,
        minRegionArea:0,mergeRegionArea:0,maxVertsPerPoly:6,detailSampleDist:6,detailSampleMaxError:1,tileSize:64,maxObstacles:2048});
      record={plugin,obstacles:new Map()};profiles.set(key,record);stats.builds++;stats.buildMs+=performance.now()-started;
    }
    const {plugin,obstacles}=record;
    for(const [id,obstacle]of obstacles)if(!description.dynamic.has(id)){plugin.removeObstacle(obstacle);obstacles.delete(id);stats.obstacleRemoves++;}
    for(const [id,o]of description.dynamic)if(!obstacles.has(id)){
      // TileCache obstacles carve after erosion: include the body's clearance.
      const obstacle=o.kind==='circle'?plugin.addCylinderObstacle({x:o.x,y:-1,z:o.z},o.radius+radius+CLEARANCE,4):
        plugin.addBoxObstacle({x:o.x,y:0,z:o.z},{x:o.halfWidth+radius+CLEARANCE,y:2,z:o.halfDepth+radius+CLEARANCE},0);
      if(!obstacle)throw new Error('Native navigation obstacle capacity exceeded');
      obstacles.set(id,obstacle);stats.obstacleAdds++;
    }
    return plugin;
  }
  return {
    profile,
    async path(start:Point,goals:readonly Point[],radius:number,bounds:Bounds,solids:readonly Obstacle[]){
      const plugin=await profile(radius,bounds,solids),begin=performance.now();stats.queries++;
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
    dispose(){for(const p of profiles.values())p.plugin.dispose();profiles.clear();scene.dispose();engine.dispose();},
  };
}
