import { createWorkerChannel } from './worker-channel.ts';
import type { ChannelTransport } from './worker-channel.ts';
import { createNativeNavigation } from './native-navigation.ts';
import { createGeometryReceiver } from './navigation-geometry.ts';
import type { Bounds, Obstacle } from './movement.ts';
import type { PathRequest, PathReply } from './path-planner.ts';
const channel=createWorkerChannel(self as unknown as ChannelTransport),geometry=createGeometryReceiver();
const ready=createNativeNavigation();
channel.handle(async(method,args)=>{
  const nav=await ready;
  if(method==='init'){const [bounds,base,fields]=args as [Bounds,readonly Obstacle[],readonly Obstacle[]];
    for(const r of [.29,.4,.54,.6,.72])nav.profile(r,bounds,r===.29?base:fields);return nav.snapshot();}
  if(method==='dispose'){nav.dispose();return;}
  if(method!=='path')throw new Error(`Unknown native planning request: ${method}`);
  const request=args[0] as PathRequest,start=performance.now();
  return {serial:request.serial,path:nav.plan({...request.query,obstacles:geometry(request.geometry)}),ms:performance.now()-start,native:nav.snapshot()} satisfies PathReply&{native:ReturnType<typeof nav.snapshot>};
});
