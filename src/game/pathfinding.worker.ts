import { findPathToGoals } from './pathfinding.ts';
import { planMoveDestination } from './work-navigation.ts';
import type { PathRequest } from './path-planner.ts';
import { createGeometryReceiver } from './navigation-geometry.ts';
const geometry=createGeometryReceiver();
self.onmessage=(event:MessageEvent<PathRequest>)=>{
  const {serial,query:q}=event.data,start=performance.now();
  try{
    const obstacles=geometry(event.data.geometry);
    const path=q.move?planMoveDestination(q.start,q.goals[0],q.radius,q.bounds,obstacles,q.neighbours??[]):findPathToGoals(q.start,q.goals,q.radius,q.bounds,obstacles);
    self.postMessage({serial,path,ms:performance.now()-start});
  }
  catch{self.postMessage({serial,error:true,ms:performance.now()-start});}
};
