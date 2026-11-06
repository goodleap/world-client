import { createWorkerChannel } from './worker-channel.ts';
import { createBackgroundPaths } from './path-planner.ts';
import type { PathRequest, PathReply, PathQuery } from './path-planner.ts';
import type { NativeNavigation } from './native-navigation.ts';
/** V2's packaged Worker factory is marked under construction in 9.32.1.
 * Run the stable official API behind Comlink for expensive exclusion-area
 * builds; the simulation can keep advancing while a route is pending. */
export function createNativeAreaPlanner(nav:NativeNavigation){
  if(typeof Worker==='undefined')return {plan:(q:PathQuery)=>nav.plan(q),flush(){},snapshot:()=>({pending:0}),dispose(){}};
  const worker=new Worker(new URL('./native-area.worker.ts',import.meta.url),{type:'module'}),channel=createWorkerChannel(worker);
  const transport={onmessage:null as ((event:MessageEvent<PathReply>)=>void)|null,onerror:null as ((event:ErrorEvent)=>void)|null,
    postMessage(request:PathRequest){void channel.call('path',[request]).then(reply=>transport.onmessage?.({data:reply} as MessageEvent<PathReply>),()=>transport.onerror?.({} as ErrorEvent));},
    terminate(){channel.close();worker.terminate();},
  };
  worker.addEventListener('error',event=>transport.onerror?.(event));
  return createBackgroundPaths(transport);
}
