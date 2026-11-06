import { after, afterEach } from 'node:test';
import { createNativeNavigation } from '../src/game/native-navigation.ts';
import { createNativeMotion } from '../src/game/native-motion.ts';
import { planPaths } from '../src/game/path-planner.ts';
import { installNavigationRuntime } from '../src/game/navigation-runtime.ts';

// Domain unit tests have no simulation clock. Supply the real native backend;
// shared-crowd integration tests explicitly prepare all actors together.
export const testNavigation=await createNativeNavigation();
let motion:ReturnType<typeof createNativeMotion>|undefined,geometry='';
const restore=installNavigationRuntime({plan:q=>testNavigation.plan(q),
  step(id,position,route,state,dt,speed,radius,bounds,solids,neighbours){
    const key=JSON.stringify([bounds,solids]);
    if(!motion||key!==geometry){motion?.dispose();motion=createNativeMotion(testNavigation,bounds,()=>solids,q=>planPaths(q.start,q.goals,q.radius,q.bounds,q.obstacles));geometry=key;}
    if(dt>0)motion.prepare([{id,position,route,radius,speed,solids},...neighbours.map(n=>({id:n.id,position:n.position,radius:n.radius,speed,
      route:n.moving&&n.heading!==undefined?[{x:n.position.x+Math.sin(n.heading)*10,z:n.position.z+Math.cos(n.heading)*10}]:[],solids}))],Math.min(dt,.05));
    return motion.runtime.step(id,position,route,state,dt,speed,radius,bounds,solids,neighbours);
  }});
afterEach(()=>{motion?.dispose();motion=undefined;geometry='';});
after(()=>{restore();testNavigation.dispose();});

import { fighterRadius, fighterStats, type Combat } from '../src/game/combat.ts';
import { WORLD_BOUNDS } from '../src/game/world-data.ts';
import { occupiedTower } from '../src/game/towers.ts';
import type { Economy } from '../src/game/economy.ts';
import type { Obstacle } from '../src/game/movement.ts';
import type { CrowdBody } from '../src/game/native-motion.ts';
const battleCrowds=new Map<Combat,ReturnType<typeof createNativeMotion>>();
afterEach(()=>{for(const m of battleCrowds.values())m.dispose();battleCrowds.clear();});
export function withCrowdStep(e:Economy,c:Combat,solids:()=>readonly Obstacle[],dt:number,advance:()=>void,extra:CrowdBody[]=[]){
  let m=battleCrowds.get(c);if(!m){m=createNativeMotion(testNavigation,WORLD_BOUNDS,solids);battleCrowds.set(c,m);}
  const bodies=c.targets().flatMap(t=>{const u=c.unit(t.id);return u&&u.life==='active'&&!u.departed&&!occupiedTower(e.state,u.id)?[{
    id:u.id,position:u.position,radius:fighterRadius(u),speed:fighterStats(u).speed*(u.order==='guard'&&!u.target? .65:1),
    route:c.movementRoute(u),solids:solids(),moveIdle:(p:{x:number;z:number})=>{u.position=p;},
  }]:[];});
  const release=installNavigationRuntime(m.runtime);
  try{m.prepare([...bodies,...extra],dt);advance();}finally{release();}
}
