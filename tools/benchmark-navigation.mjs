import { planNavigation } from '../src/game/navigation-plan.ts';
import { groupDestinations } from '../src/game/group-orders.ts';
import { WORLD_BOUNDS } from '../src/game/world-data.ts';
import { economyObstacles } from '../src/game/economy-config.ts';

// Same map, starts, body clearance and five destinations in both runs.
const units=Array.from({length:5},(_,i)=>({id:String(i),position:{x:-4+i,z:-4},radius:.4}));
const destination={x:46,z:57},slots=groupDestinations(units,destination),solids=economyObstacles([]);
function measure(reuse){
  let routeHint;const neighbours=[],members=[];
  for(const slot of slots){
    const unit=units.find(u=>u.id===slot.id),start=performance.now();
    const path=planNavigation({start:unit.position,goal:slot.point,radius:.4,bounds:WORLD_BOUNDS,solids,neighbours,routeHint:reuse?routeHint:undefined});
    if(!path)throw new Error('Expected reachable formation slot');
    members.push(Math.round((performance.now()-start)*10)/10);
    neighbours.push({position:unit.position,radius:.4,destination:path.at(-1)});routeHint=path;
  }
  return {members,totalMs:Math.round(members.reduce((a,b)=>a+b,0))};
}
measure(false); // Warm common planning/JIT before comparing both paths.
const rounds=Array.from({length:3},()=>({independent:measure(false),shared:measure(true)}));
console.log(JSON.stringify({environment:'cloud Node.js; computation only, excludes worker messages/render cadence',destination,radius:.4,rounds},null,2));
