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
