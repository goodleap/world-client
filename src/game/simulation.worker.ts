import { createWorkerChannel } from './worker-channel.ts';
import type { ChannelTransport } from './worker-channel.ts';
import { createSimulation } from './simulation.ts';
import type { Simulation, SimulationCommand, SimulationEvent } from './simulation.ts';
import { SimulationClock } from './simulation-clock.ts';
import { createSimulationPublisher, simulationView } from './simulation-state.ts';
import type { SimulationPacket } from './simulation-state.ts';
import type { EconomyState } from './economy.ts';
import type { Bounds } from './movement.ts';
const channel=createWorkerChannel(self as unknown as ChannelTransport);
let sim:Simulation|undefined,publisher:ReturnType<typeof createSimulationPublisher>|undefined;
let paused=true,closed=false,previous=performance.now(),serial=0,diagnosticAt=0,checkpointAt=0;
let timer:ReturnType<typeof setTimeout>|undefined,inflight:Promise<unknown>|undefined;
const clock=new SimulationClock(),events:SimulationEvent[]=[];
function publish(){
  if(inflight||!sim||!publisher||closed)return inflight;
  const now=performance.now(),diagnostics=now-diagnosticAt>=500?sim.diagnostics():undefined;if(diagnostics)diagnosticAt=now;
  const packet:SimulationPacket={serial:++serial,stamp:performance.timeOrigin+now,seconds:sim.economy.state.seconds,
    patch:publisher.diff(simulationView(sim)),events:events.splice(0),diagnostics,backlogMs:clock.pendingSeconds*1000};
  // At most one publication can be waiting on rendering. On a slow frame the
  // next diff covers all changes since the acknowledgement, without a backlog
  // of stale whole-world snapshots or queued geometry uploads.
  inflight=channel.call('frame',[packet]).then(value=>{inflight=undefined;return value;},error=>{
    inflight=undefined;if(!closed){paused=true;channel.notify('error',[String(error)]);}throw error;
  });
  void inflight.catch(()=>{});
  return inflight;
}
function tick(){
  if(closed)return;const now=performance.now(),elapsed=(now-previous)/1000;previous=now;
  if(!paused&&sim){
    if(clock.advance(elapsed,dt=>sim!.step(dt))>0)publish();
    if(sim.economy.state.seconds-checkpointAt>=1){checkpointAt=sim.economy.state.seconds;channel.notify('checkpoint',[sim.save()]);}
  }
  timer=setTimeout(tick,paused?50:10);
}
channel.handle(async(method,args)=>{
  if(method==='init'){
    if(sim)throw new Error('Simulation already initialized');
    sim=await createSimulation(args[0] as EconomyState,event=>events.push(event));
    const view=simulationView(sim);publisher=createSimulationPublisher(view);previous=performance.now();tick();
    return {view,diagnostics:sim.diagnostics()};
  }
  if(!sim)throw new Error('Simulation is not ready');
  switch(method){
    case 'pause':paused=!!args[0];previous=performance.now();if(paused){await inflight;await publish();}return;
    case 'command':{const result=sim.command(args[0] as SimulationCommand);await inflight;await publish();return result;}
    case 'view':sim.setView(args[0] as Bounds);return;
    case 'save':return sim.save();
    case 'diagnostics':return {...sim.diagnostics(),replication:publisher?.snapshot(),backlogMs:clock.pendingSeconds*1000};
    case 'dispose':paused=true;closed=true;clearTimeout(timer);sim.dispose();sim=undefined;return;
  }
  throw new Error(`Unknown simulation request: ${method}`);
});
