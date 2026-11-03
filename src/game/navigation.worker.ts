import { planNavigation, type NavigationInput } from './navigation-plan.ts';
self.onmessage=(event:MessageEvent<{serial:number;input:NavigationInput}>)=>{
  const {serial,input}=event.data,start=performance.now();
  try{self.postMessage({serial,path:planNavigation(input),ms:performance.now()-start});}
  catch{self.postMessage({serial,error:true,ms:performance.now()-start});}
};
