import { createWorkerChannel } from './worker-channel.ts';
import { createBackgroundPaths } from './path-planner.ts';
import type { PathRequest, PathReply, PathQuery } from './path-planner.ts';
import type { Bounds, Obstacle } from './movement.ts';
import type { NativeNavigation } from './native-navigation.ts';
/** V2's packaged Worker factory is marked under construction in 9.32.1.
 * Run the stable official API behind Comlink for all route queries and
 * exclusion-area builds, so a command burst cannot block simulation ticks. */
export function createNativePlanner(nav:NativeNavigation,bounds:Bounds,base:readonly Obstacle[],fields:readonly Obstacle[]){
  if(typeof Worker==='undefined'){for(const r of [.29,.4,.54,.6,.72])nav.profile(r,bounds,r===.29?base:fields);
    return {ready:Promise.resolve(),plan:(q:PathQuery)=>nav.plan(q),waitForResult:()=>Promise.resolve(),flush(){},snapshot:()=>({pending:0}),dispose(){}};}
  const worker=new Worker(new URL('./native-planning.worker.ts',import.meta.url),{type:'module'}),channel=createWorkerChannel(worker);
  let native:ReturnType<NativeNavigation['snapshot']>|undefined;
  const transport={onmessage:null as ((event:MessageEvent<PathReply>)=>void)|null,onerror:null as ((event:ErrorEvent)=>void)|null,
    postMessage(request:PathRequest){void channel.call('path',[request]).then(reply=>{const result=reply as PathReply&{native:typeof native};native=result.native;transport.onmessage?.(new MessageEvent<PathReply>('message',{data:result}));},()=>transport.onerror?.({} as ErrorEvent));},
    terminate(){channel.close();worker.terminate();},
  };
  worker.addEventListener('error',event=>transport.onerror?.(event));
  const ready=channel.call('init',[bounds,base,fields],[],120_000).then(value=>{native=value as typeof native;});
  const queue=createBackgroundPaths(transport);
  return {...queue,ready,snapshot:()=>({...queue.snapshot(),native})};
}
