import { createWorkerChannel } from './worker-channel.ts';
import type { ChannelTransport } from './worker-channel.ts';
import { createSimulation } from './simulation.ts';
import type { Simulation, SimulationCommand, SimulationEvent } from './simulation.ts';
import { SimulationClock } from './simulation-clock.ts';
import { createSimulationPublisher, simulationView } from './simulation-state.ts';
import type { SimulationPacket } from './simulation-state.ts';
import type { EconomyState } from './economy.ts';
import type { Bounds, Point } from './movement.ts';
const channel=createWorkerChannel(self as unknown as ChannelTransport);
let sim:Simulation|undefined,publisher:ReturnType<typeof createSimulationPublisher>|undefined;
let paused=true,closed=false,previous=performance.now(),serial=0,diagnosticAt=0,checkpointAt=0;
let timelineOrigin=0;
let timer:ReturnType<typeof setTimeout>|undefined,inflight:Promise<unknown>|undefined;
const clock=new SimulationClock(),events:SimulationEvent[]=[];
let commands:Promise<unknown>=Promise.resolve();
let traces:Record<string,Point[]>={},resetMotion=false;
const positions=new Map<string,Point>();
function captureMotion(){
  if(!sim)return;
  const poses=[...sim.residents.frame(true),...sim.combat.state.units,...sim.raids.wolves],ids=new Set(poses.map(p=>p.id));
  for(const id of positions.keys())if(!ids.has(id))positions.delete(id);
  for(const pose of poses){const previous=positions.get(pose.id),next={x:pose.position.x,z:pose.position.z};
    if(previous&&(previous.x!==next.x||previous.z!==next.z)){
      const path=traces[pose.id]??=[previous];
      if(path.length<64)path.push(next);else resetMotion=true;
    }positions.set(pose.id,next);
  }
}
function publish(){
  if(inflight||!sim||!publisher||closed)return inflight;
  const now=performance.now(),diagnostics=now-diagnosticAt>=500?{...sim.diagnostics(),replication:publisher.snapshot()}:undefined;if(diagnostics)diagnosticAt=now;
  const packet:SimulationPacket={serial:++serial,stamp:timelineOrigin+sim.economy.state.seconds*1000,seconds:sim.economy.state.seconds,
    patch:publisher.diff(simulationView(sim)),events:events.splice(0),paths:traces,resetMotion,diagnostics,backlogMs:clock.pendingSeconds*1000};
  // At most one publication can be waiting on rendering. On a slow frame the
  // next diff covers all changes since the acknowledgement, without a backlog
  // of stale whole-world snapshots or queued geometry uploads.
  traces={};resetMotion=false;
  inflight=channel.call('frame',[packet],[packet.patch.motion.values.buffer as ArrayBuffer]).then(value=>{inflight=undefined;return value;},error=>{
    inflight=undefined;if(!closed){paused=true;channel.notify('error',[String(error)]);}throw error;
  });
  void inflight.catch(()=>{});
  return inflight;
}
function tick(){
  if(closed)return;const now=performance.now(),elapsed=(now-previous)/1000;previous=now;
  if(!paused&&sim){
    if(clock.advance(elapsed,dt=>{sim!.step(dt);captureMotion();})>0)publish();
    if(sim.economy.state.seconds-checkpointAt>=1){checkpointAt=sim.economy.state.seconds;channel.notify('checkpoint',[sim.save()]);}
  }
  timer=setTimeout(tick,paused?50:10);
}
channel.handle(async(method,args)=>{
  if(method==='init'){
    if(sim)throw new Error('Simulation already initialized');
    sim=await createSimulation(args[0] as EconomyState,event=>events.push(event));
    const view=simulationView(sim);publisher=createSimulationPublisher(view);captureMotion();previous=performance.now();tick();
    return {view,diagnostics:{...sim.diagnostics(),replication:publisher.snapshot()}};
  }
  if(!sim)throw new Error('Simulation is not ready');
  switch(method){
    case 'pause':paused=!!args[0];previous=performance.now();if(!paused)timelineOrigin=performance.timeOrigin+previous-(sim.economy.state.seconds+clock.pendingSeconds)*1000;if(paused){await commands;await inflight;await publish();}return;
    case 'command':{const work=commands.then(()=>sim!.command(args[0] as SimulationCommand));commands=work.catch(()=>{});
      const result=await work;await inflight;await publish();return result;}
    case 'view':sim.setView(args[0] as Bounds);return;
    case 'save':{await commands;const start=performance.now(),text=sim.save();return {text,encodeMs:performance.now()-start};}
    case 'diagnostics':return {...sim.diagnostics(),replication:publisher?.snapshot(),backlogMs:clock.pendingSeconds*1000};
    case 'dispose':paused=true;await commands;closed=true;clearTimeout(timer);sim.dispose();sim=undefined;return;
  }
  throw new Error(`Unknown simulation request: ${method}`);
});
