import { planNavigation } from './navigation-plan.ts';
import type { NavigationRequest } from './navigation-queue.ts';
import { createGeometryReceiver } from './navigation-geometry.ts';
const geometry=createGeometryReceiver();
self.onmessage=(event:MessageEvent<NavigationRequest>)=>{
  const {serial,input}=event.data,start=performance.now();
  try{self.postMessage({serial,path:planNavigation({...input,solids:geometry(event.data.geometry)}),ms:performance.now()-start});}
  catch{self.postMessage({serial,error:true,ms:performance.now()-start});}
};
