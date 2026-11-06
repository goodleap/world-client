import { createPatch, applyPatch } from 'rfc6902';
import type { Operation } from 'rfc6902';
import type { Simulation, SimulationEvent } from './simulation.ts';
import type { Point } from './movement.ts';
import type { Economy } from './economy.ts';

const byId=<T extends {id:string|number}>(items:readonly T[])=>Object.fromEntries(items.map(item=>[item.id,item]));
/** Stable entity keys keep RFC 6902's array edit-distance algorithm away from
 * the changing crowd. Geometry and meshes never enter this state channel. */
export function simulationView(sim:Simulation){
  const {combat,raids,residents:_saved,...economy}=sim.economy.state;
  return {economy,combat:{...combat,units:byId(combat.units),projectiles:byId(combat.projectiles)},
    raids:{...raids,wolves:byId(raids.wolves),wildWolves:byId(raids.wildWolves)},
    residents:byId(sim.residents.frame().filter(r=>!sim.combat.unit(r.id))),revision:sim.economy.revision};
}
export type SimulationView=ReturnType<typeof simulationView>;
export interface SimulationPacket{serial:number;stamp:number;seconds:number;patch:Operation[];events:SimulationEvent[];paths?:Record<string,Point[]>;resetMotion?:boolean;diagnostics?:ReturnType<Simulation['diagnostics']>&{replication:ReturnType<ReturnType<typeof createSimulationPublisher>['snapshot']>};backlogMs:number}
export function createSimulationPublisher(initial:SimulationView){
  const previous=structuredClone(initial);let operations=0,lastMs=0,maxMs=0;
  return {diff(next:SimulationView){const start=performance.now();const patch=structuredClone(createPatch(previous,next,(before,after,ptr)=>{
      // Lists are atomic game values, not text edits. Use the library's public
      // hook to avoid quadratic Levenshtein work on routes and danger marks.
      if(Array.isArray(before)&&Array.isArray(after))return JSON.stringify(before)===JSON.stringify(after)?[]:[{op:'replace',path:ptr.toString(),value:after}];
      return undefined;
    }));
    const errors=applyPatch(previous,patch).filter(Boolean);if(errors.length)throw errors[0];
    operations+=patch.length;lastMs=performance.now()-start;maxMs=Math.max(maxMs,lastMs);return patch;},
    snapshot:()=>({operations,lastMs,maxMs}),
  };
}
export function applySimulationPatch(view:SimulationView,patch:Operation[]){
  const error=applyPatch(view,patch).find(Boolean);if(error)throw error;
}
export function updateEconomyReplica(e:Economy,view:SimulationView){
  Object.assign(e.state,view.economy);
  Object.assign(e.state.combat,view.combat,{units:Object.values(view.combat.units),projectiles:Object.values(view.combat.projectiles)});
  Object.assign(e.state.raids,view.raids,{wolves:Object.values(view.raids.wolves),wildWolves:Object.values(view.raids.wildWolves)});
  if(!Object.hasOwn(view.raids,'origin'))delete e.state.raids.origin;
  if(!Object.hasOwn(view.raids,'pendingOrigin'))delete e.state.raids.pendingOrigin;
  e.revision=view.revision;
}
