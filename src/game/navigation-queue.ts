import type { Point } from './movement.ts';
import type { NavigationInput } from './navigation-plan.ts';
import { createGeometrySender, type GeometryMessage } from './navigation-geometry.ts';

export interface NavigationRequest { serial:number; input:Omit<NavigationInput,'solids'>; geometry:GeometryMessage }

interface Job { id:string; serial:number; started:number; input:()=>NavigationInput|undefined; done:(path:Point[]|undefined)=>void }
interface Reply { serial:number; path?:Point[]; ms:number; error?:boolean }
type Transport=Pick<Worker,'postMessage'|'terminate'> & {onmessage:((e:MessageEvent<Reply>)=>void)|null;onerror:((e:ErrorEvent)=>void)|null};

/** Dispatch only one snapshot at a time, so later members see earlier arrival
 * reservations. Results are consumed by the game loop, never while paused. */
export function createNavigationQueue(worker:Transport,now=()=>performance.now()){
  let serial=0,active:Job|undefined,ready:Reply|undefined,failed=false;
  let completed=0,lastMs=0,maxMs=0,workMs=0;
  const jobs:Job[]=[],latest=new Map<string,number>();
  const geometry=createGeometrySender();
  function pump(){
    if(active||ready)return;
    while(jobs.length){
      const job=jobs.shift()!;
      if(latest.get(job.id)!==job.serial)continue;
      const input=job.input();active=job;
      if(!input||failed){ready={serial:job.serial,ms:0,error:failed};return;}
      const {solids,...request}=input;
      worker.postMessage({serial:job.serial,input:request,geometry:geometry.encode(geometry.snapshot(solids))} satisfies NavigationRequest);return;
    }
  }
  worker.onmessage=e=>{if(active?.serial===e.data.serial)ready=e.data;};
  worker.onerror=()=>{failed=true;if(active)ready={serial:active.serial,ms:0,error:true};};
  return {
    request(id:string,input:Job['input'],done:Job['done']){
      const job={id,serial:++serial,started:now(),input,done};latest.set(id,job.serial);
      for(let i=jobs.length-1;i>=0;i--)if(jobs[i].id===id)jobs.splice(i,1);
      jobs.push(job);pump();
    },
    cancel(id:string){latest.delete(id);for(let i=jobs.length-1;i>=0;i--)if(jobs[i].id===id)jobs.splice(i,1);},
    pending:(id:string)=>latest.has(id),
    flush(){
      if(!ready||!active)return;
      const job=active,result=ready;active=undefined;ready=undefined;
      if(latest.get(job.id)===job.serial){latest.delete(job.id);completed++;lastMs=now()-job.started;maxMs=Math.max(maxMs,lastMs);workMs=result.ms;job.done(result.path);}
      pump();
    },
    snapshot:()=>({pending:latest.size,completed,lastMs:Math.round(lastMs),maxMs:Math.round(maxMs),workMs:Math.round(workMs),geometryUploads:geometry.uploads,failed}),
    dispose(){jobs.length=0;latest.clear();active=undefined;ready=undefined;geometry.clear();worker.onmessage=worker.onerror=null;worker.terminate();},
  };
}
