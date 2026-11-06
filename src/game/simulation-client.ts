import { createWorkerChannel } from './worker-channel.ts';
import type { Economy } from './economy.ts';
import type { Bounds } from './movement.ts';
import type { SimulationCommand, CommandResult } from './simulation.ts';
import { applySimulationPatch, updateEconomyReplica } from './simulation-state.ts';
import type { SimulationPacket, SimulationView } from './simulation-state.ts';

export async function createSimulationClient(economy:Economy,checkpoint:(text:string)=>void,onError:(message:string)=>void){
  const worker=new Worker(new URL('./simulation.worker.ts',import.meta.url),{type:'module'}),channel=createWorkerChannel(worker);
  let view:SimulationView|undefined,diagnostics:SimulationPacket['diagnostics'],serial=0,closed=false;
  let paused=true,stamp=performance.timeOrigin+performance.now(),seconds=economy.state.seconds,duration=.05,backlogMs=0,pending=0;
  let consume:(packet:SimulationPacket,view:SimulationView)=>void=()=>{};
  channel.handle((method,args)=>{
    if(method==='checkpoint'){checkpoint(args[0] as string);return;}
    if(method==='error'){onError(args[0] as string);return;}
    if(method==='frame'){
      const packet=args[0] as SimulationPacket;
      if(!view||packet.serial!==serial+1)throw new Error('Simulation state sequence mismatch');
      serial=packet.serial;applySimulationPatch(view,packet.patch);updateEconomyReplica(economy,view);
      if(packet.seconds>seconds){duration=packet.seconds-seconds;stamp=packet.stamp;seconds=packet.seconds;}
      backlogMs=packet.backlogMs;diagnostics=packet.diagnostics??diagnostics;consume(packet,view);return;
    }
    throw new Error(`Unknown simulation event: ${method}`);
  });
  worker.addEventListener('error',event=>{if(!closed){onError(event.message||'模拟线程异常');channel.close('Simulation worker failed');}});
  try{
    const initial=await channel.call('init',[economy.state],[],120_000) as {view:SimulationView;diagnostics:NonNullable<typeof diagnostics>};
    view=initial.view;diagnostics=initial.diagnostics;updateEconomyReplica(economy,view);
  }catch(error){closed=true;channel.close();worker.terminate();throw error;}
  return {get view(){return view!;},get duration(){return duration;},get seconds(){return seconds;},get backlogMs(){return backlogMs;},
    get alpha(){return paused?1:Math.min(1,Math.max(0,(performance.timeOrigin+performance.now()-stamp)/(duration*1000)));},
    subscribe(callback:typeof consume){consume=callback;},
    async pause(value:boolean){paused=value;await channel.call('pause',[value]);},
    async command(command:SimulationCommand){pending++;try{return await channel.call('command',[command]) as CommandResult;}finally{pending--;}},
    setView:(bounds:Bounds)=>channel.notify('view',[bounds]),
    save:()=>channel.call('save') as Promise<{text:string;encodeMs:number}>,
    diagnostics:()=>({...diagnostics!,replication:{...diagnostics!.replication,serial},backlogMs,communication:channel.snapshot()}),get pending(){return pending;},
    async dispose(){if(closed)return;closed=true;try{await channel.call('dispose',[],[],5000);}finally{channel.close();worker.terminate();}},
  };
}
export type SimulationClient=Awaited<ReturnType<typeof createSimulationClient>>;
