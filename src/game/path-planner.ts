import type { Bounds, Obstacle, Point } from './movement.ts';
import { isBlocked } from './movement.ts';
import { findPathToGoals } from './pathfinding.ts';
import { inBounds, segmentIsClear } from './wander.ts';
import type { WorkNeighbour } from './work-navigation.ts';
import { createGeometrySender, type GeometryMessage, type GeometrySnapshot } from './navigation-geometry.ts';

/** null means still planning, undefined means a completed, unreachable search. */
export type PlannedPath = Point[] | undefined | null;
export interface PathQuery { start:Point; goals:readonly Point[]; radius:number; bounds:Bounds; obstacles:readonly Obstacle[]; move?:boolean; neighbours?:readonly WorkNeighbour[] }
type Planner = (query:PathQuery)=>PlannedPath;
let background:Planner|undefined;
export function usePathPlanner(planner:Planner) {
  background=planner;
  return ()=>{if(background===planner)background=undefined;};
}

/** Cheap direct travel stays immediate. Only the grid search crosses threads.
 * Tests and the navigation worker use the same pure planner without a backend. */
export function planPaths(start:Point,goals:readonly Point[],radius:number,bounds:Bounds,obstacles:readonly Obstacle[]):PlannedPath {
  const valid=goals.filter(p=>inBounds(p,radius,bounds)&&!isBlocked(p,radius,obstacles));
  if(!valid.length)return;
  if(segmentIsClear(start,valid[0],radius,bounds,obstacles))return [{x:valid[0].x,z:valid[0].z}];
  const query={start,goals:valid,radius,bounds,obstacles};
  return background?background(query):findPathToGoals(start,valid,radius,bounds,obstacles);
}
export const planPath=(start:Point,goal:Point,radius:number,bounds:Bounds,obstacles:readonly Obstacle[])=>planPaths(start,[goal],radius,bounds,obstacles);
/** Move-destination enumeration is part of the heavy search too. Keep it in
 * the worker, including nearest-reachable fallback and arrival reservations. */
export function planMoveInBackground(start:Point,goal:Point,radius:number,bounds:Bounds,obstacles:readonly Obstacle[],neighbours:readonly WorkNeighbour[]):PlannedPath|false {
  if(!background)return false;
  return background({start,goals:[{x:goal.x,z:goal.z}],radius,bounds,obstacles,move:true,neighbours});
}

export interface PathReply { serial:number; path?:Point[]; ms:number; error?:boolean }
export interface PathRequest { serial:number; query:Omit<PathQuery,'obstacles'>; geometry:GeometryMessage }
type Transport=Pick<Worker,'postMessage'|'terminate'> & {onmessage:((event:MessageEvent<PathReply>)=>void)|null;onerror:((event:ErrorEvent)=>void)|null};
interface Entry { key:string; group:string; serial:number; query:Omit<PathQuery,'obstacles'>; geometry:GeometrySnapshot; touched:number; expires:number; done:boolean; path?:Point[] }

/** Bounded, deduplicated background work. Cache keys include exact geometry,
 * start and goals, so a demolition, new order or moved target cannot consume an
 * obsolete answer. Replies only become visible at the next active game frame. */
export function createBackgroundPaths(worker:Transport,now=()=>performance.now()) {
  let serial=0,active:Entry|undefined,failed=false,disposed=false,completed=0,hits=0,workMs=0;
  const geometry=createGeometrySender(),ready:{entry:Entry;result:PathReply}[]=[];
  const cache=new Map<string,Entry>(),groups=new Map<string,Set<Entry>>(),queue:Entry[]=[];
  const groupOf=(q:PathQuery,version:number)=>JSON.stringify([q.goals.map(p=>[p.x,p.z]),q.radius,
    [q.bounds.minX,q.bounds.maxX,q.bounds.minZ,q.bounds.maxZ],version,q.move,
    q.neighbours?.map(n=>[n.position.x,n.position.z,n.radius,n.destination?.x,n.destination?.z])]);
  function remove(entry:Entry){
    cache.delete(entry.key);const group=groups.get(entry.group);group?.delete(entry);if(!group?.size)groups.delete(entry.group);
    const queued=queue.indexOf(entry);if(queued>=0)queue.splice(queued,1);
    const replyIndex=ready.findIndex(r=>r.entry===entry);if(replyIndex>=0)ready.splice(replyIndex,1);
  }
  function pump(){
    if(active||failed||disposed)return;
    while(queue.length){
      const entry=queue.shift()!;
      if(cache.get(entry.key)!==entry)continue;
      if(now()-entry.touched>5000){remove(entry);continue;}
      active=entry;worker.postMessage({serial:entry.serial,query:entry.query,geometry:geometry.encode(entry.geometry)} satisfies PathRequest);return;
    }
  }
  const plan:Planner=query=>{
    if(failed||disposed)return;
    const version=geometry.snapshot(query.obstacles),group=groupOf(query,version.id),key=`${query.start.x},${query.start.z}/${group}`,time=now(),cached=cache.get(key);
    if(cached&&(!cached.done||cached.expires>time)){
      cached.touched=time;hits++;
      return cached.done?cached.path?.map(p=>({...p})):null;
    }
    if(cached)remove(cached);
    for(const entry of groups.get(group)??[]){
      if(entry.done&&entry.path&&entry.expires>time){
        // Share an already solved corridor only after an exact swept join from
        // the caller's live position. Remaining legs use identical geometry.
        for(let i=entry.path.length-1;i>=0;i--)if(segmentIsClear(query.start,entry.path[i],query.radius,query.bounds,query.obstacles)){
          hits++;return entry.path.slice(i).map(p=>({...p}));
        }
      }else if(!entry.done&&Math.hypot(entry.query.start.x-query.start.x,entry.query.start.z-query.start.z)<2){entry.touched=time;hits++;return null;}
    }
    // Keep outstanding work bounded even when many candidates are tried. A
    // caller receives pending and can retry; saturation never means unreachable.
    if(cache.size>=128){
      for(const e of cache.values())if(e.done||e!==active&&time-e.touched>5000){remove(e);break;}
      if(cache.size>=128)return null;
    }
    // Only mutable request data needs a snapshot. Geometry is shared until its
    // producer publishes a new version, and uploaded once per Worker version.
    const snapshot={start:{x:query.start.x,z:query.start.z},goals:query.goals.map(p=>({x:p.x,z:p.z})),
      radius:query.radius,bounds:{...query.bounds},move:query.move,neighbours:query.neighbours?.map(n=>({
        position:{x:n.position.x,z:n.position.z},radius:n.radius,destination:n.destination?{x:n.destination.x,z:n.destination.z}:undefined,
      }))};
    const entry:Entry={key,group,serial:++serial,query:snapshot,geometry:version,touched:time,expires:0,done:false};
    cache.set(key,entry);if(!groups.has(group))groups.set(group,new Set());groups.get(group)!.add(entry);
    queue.push(entry);pump();return null;
  };
  worker.onmessage=event=>{
    if(active?.serial!==event.data.serial||disposed)return;
    ready.push({entry:active,result:event.data});active=undefined;
    // These requests already own immutable snapshots. Calculation can continue
    // between renders (or while paused); only flush publishes gameplay results.
    pump();
  };
  worker.onerror=()=>{failed=true;cache.clear();groups.clear();queue.length=ready.length=0;active=undefined;geometry.clear();};
  return {
    plan,
    flush(){
      for(const {entry,result} of ready){
        if(cache.get(entry.key)!==entry)continue;
        entry.done=true;entry.path=result.error?undefined:result.path;entry.expires=now()+(entry.path?4000:2000);
        completed++;workMs=result.ms;
      }
      ready.length=0;
    },
    snapshot:()=>({pending:queue.length+Number(!!active)+ready.length,ready:ready.length,cached:cache.size,completed,hits,workMs:Math.round(workMs),geometryUploads:geometry.uploads,failed}),
    dispose(){disposed=true;cache.clear();groups.clear();queue.length=ready.length=0;active=undefined;geometry.clear();worker.onmessage=worker.onerror=null;worker.terminate();},
  };
}
