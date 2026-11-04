import { findPathToGoals } from './pathfinding.ts';
import { planMoveDestination } from './work-navigation.ts';
import type { PathQuery } from './path-planner.ts';
self.onmessage=(event:MessageEvent<{serial:number;query:PathQuery}>)=>{
  const {serial,query:q}=event.data,start=performance.now();
  try{
    const path=q.move?planMoveDestination(q.start,q.goals[0],q.radius,q.bounds,q.obstacles,q.neighbours??[]):findPathToGoals(q.start,q.goals,q.radius,q.bounds,q.obstacles);
    self.postMessage({serial,path,ms:performance.now()-start});
  }
  catch{self.postMessage({serial,error:true,ms:performance.now()-start});}
};
