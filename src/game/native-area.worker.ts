import { createWorkerChannel } from './worker-channel.ts';
import type { ChannelTransport } from './worker-channel.ts';
import { createNativeNavigation } from './native-navigation.ts';
import { createGeometryReceiver } from './navigation-geometry.ts';
import type { PathRequest, PathReply } from './path-planner.ts';
const channel=createWorkerChannel(self as unknown as ChannelTransport),geometry=createGeometryReceiver();
const ready=createNativeNavigation();
channel.handle(async(method,args)=>{
  const nav=await ready;
  if(method==='dispose'){nav.dispose();return;}
  if(method!=='path')throw new Error(`Unknown native area request: ${method}`);
  const request=args[0] as PathRequest,start=performance.now();
  return {serial:request.serial,path:nav.plan({...request.query,obstacles:geometry(request.geometry)}),ms:performance.now()-start} satisfies PathReply;
});
