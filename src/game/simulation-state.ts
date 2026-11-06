import { createPatch, applyPatch } from 'rfc6902';
import type { Operation } from 'rfc6902';
import type { Simulation, SimulationEvent } from './simulation.ts';
import type { Point } from './movement.ts';
import type { Fighter } from './combat.ts';
import type { ResidentFrame } from './resident-simulation.ts';
import type { Economy } from './economy.ts';

const byId=<T extends {id:string|number}>(items:readonly T[])=>Object.fromEntries(items.map(item=>[item.id,item]));
/** Stable entity keys keep RFC 6902's array edit-distance algorithm away from
 * the changing crowd. Geometry and meshes never enter this state channel. */
export function simulationView(sim:Simulation){
  const {combat,raids,residents:_saved,...economy}=sim.economy.state;
  return {economy,combat:{...combat,units:byId(combat.units),projectiles:byId(combat.projectiles)},
    raids:{...raids,wolves:byId(raids.wolves),wildWolves:byId(raids.wildWolves)},
    residents:byId(sim.residents.frame(true).map(frame=>({...frame,path:undefined}))),revision:sim.economy.revision};
}
export type SimulationView=ReturnType<typeof simulationView>;
export interface SimulationPacket{serial:number;stamp:number;seconds:number;patch:SimulationUpdate;events:SimulationEvent[];paths?:Record<string,Point[]>;resetMotion?:boolean;diagnostics?:ReturnType<Simulation['diagnostics']>&{replication:ReturnType<ReturnType<typeof createSimulationPublisher>['snapshot']>};backlogMs:number}
// High-frequency poses are one native transferable buffer. The existing RFC
// 6902 library still owns structural changes; no custom diff/RPC implementation.
const poseGroups=(v:SimulationView)=>[v.combat.units,v.raids.wolves,v.raids.wildWolves,v.residents] as const;
const STRIDE=11;
export interface SimulationUpdate {patch:Operation[];motion:{ids:string[][];values:Float64Array}}
function splitMotion(view:SimulationView){
  const groups=poseGroups(view),ids=groups.map(g=>Object.keys(g));
  const values=new Float64Array(ids.reduce((n,g)=>n+g.length,0)*STRIDE);
  let offset=0;
  const records=groups.map((group,index)=>Object.fromEntries(ids[index].map(id=>{
    const a=group[id] as Fighter|ResidentFrame,n=a.navigation;
    values.set([a.position.x,a.position.z,a.facing,a.speed,n.waited,n.retryIn,n.replanIn,
      'cooldown'in a?a.cooldown:0,'planIn'in a?a.planIn:0,'attack'in a?a.attack?.elapsed??0:0,
      'playbackSpeed'in a?a.playbackSpeed:0],offset);offset+=STRIDE;
    const cold={...a,position:{x:0,z:0},facing:0,speed:0,navigation:{...n,waited:0,retryIn:0,replanIn:0}};
    if('cooldown'in cold){cold.cooldown=0;cold.planIn=0;if(cold.attack)cold.attack={...cold.attack,elapsed:0};}
    if('playbackSpeed'in cold){cold.playbackSpeed=0;cold.path=undefined;}
    return [id,cold];
  })));
  return {cold:{...view,combat:{...view.combat,units:records[0]},raids:{...view.raids,wolves:records[1],wildWolves:records[2]},residents:records[3]},motion:{ids,values}};
}
export function createSimulationPublisher(initial:SimulationView){
  const previous=structuredClone(splitMotion(initial).cold);let operations=0,lastMs=0,maxMs=0,totalMs=0,publications=0,poseBytes=0;
  return {diff(next:SimulationView):SimulationUpdate{const start=performance.now(),{cold,motion}=splitMotion(next);
    const patch=structuredClone(createPatch(previous,cold,(before,after,ptr)=>{
      // Entity records and lists are atomic values. Avoid allocating hundreds
      // of JSON pointers for clocks/positions on every 50 ms publication.
      if(Array.isArray(before)&&Array.isArray(after)||/^\/(?:combat\/units|raids\/(?:wolves|wildWolves)|residents|economy\/vitals)\/[^/]+$/.test(ptr.toString()))
        return JSON.stringify(before)===JSON.stringify(after)?[]:[{op:'replace',path:ptr.toString(),value:after}];
      return undefined;
    }));
    const errors=applyPatch(previous,patch).filter(Boolean);if(errors.length)throw errors[0];
    operations+=patch.length;poseBytes=motion.values.byteLength;lastMs=performance.now()-start;maxMs=Math.max(maxMs,lastMs);totalMs+=lastMs;publications++;return {patch,motion};},
    snapshot:()=>({operations,lastMs,maxMs,meanMs:totalMs/Math.max(1,publications),poseBytes,publications}),
  };
}
export function applySimulationPatch(view:SimulationView,update:SimulationUpdate){
  const error=applyPatch(view,update.patch).find(Boolean);if(error)throw error;
  const groups=poseGroups(view),{ids,values}=update.motion;let offset=0;
  for(let index=0;index<groups.length;index++)for(const id of ids[index]){
    const a=groups[index][id] as Fighter|ResidentFrame,n=a.navigation;
    a.position={x:values[offset],z:values[offset+1]};a.facing=values[offset+2];a.speed=values[offset+3];
    n.waited=values[offset+4];n.retryIn=values[offset+5];n.replanIn=values[offset+6];
    if('cooldown'in a){a.cooldown=values[offset+7];a.planIn=values[offset+8];if(a.attack)a.attack.elapsed=values[offset+9];}
    if('playbackSpeed'in a)a.playbackSpeed=values[offset+10];offset+=STRIDE;
  }
}
export function updateEconomyReplica(e:Economy,view:SimulationView){
  Object.assign(e.state,view.economy);
  Object.assign(e.state.combat,view.combat,{units:Object.values(view.combat.units),projectiles:Object.values(view.combat.projectiles)});
  Object.assign(e.state.raids,view.raids,{wolves:Object.values(view.raids.wolves),wildWolves:Object.values(view.raids.wildWolves)});
  if(!Object.hasOwn(view.raids,'origin'))delete e.state.raids.origin;
  if(!Object.hasOwn(view.raids,'pendingOrigin'))delete e.state.raids.pendingOrigin;
  e.revision=view.revision;
}
