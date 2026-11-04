import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock,RenderCadence } from '../src/game/simulation-clock.ts';
import { Economy,initialEconomy,encodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { recruit,advanceRecruitment } from '../src/game/recruitment.ts';
import { PERFORMANCE_MODES } from '../src/game/graphics-settings.ts';

function simulate(frames:readonly number[],fps:number){
  const e=new Economy(initialEconomy(1234));e.setLeadership(false);recruit(e,'farmer');
  const combat=new Combat(e.state.combat,e,()=>[]),clock=new SimulationClock(),render=new RenderCadence();
  combat.move(['archer'],{x:0,z:-12});
  const task=e.request('harvest','plot-0').task!;e.assign(task.id);e.arrive(task.id);
  let draws=0;
  for(const frame of frames){clock.advance(frame,dt=>{e.advance(dt);advanceRecruitment(e,dt);combat.update(dt);});if(render.ready(frame,fps))draws++;}
  while(clock.pendingSeconds+1e-9>=SimulationClock.step)clock.advance(0,dt=>{e.advance(dt);advanceRecruitment(e,dt);combat.update(dt);});
  return {state:encodeEconomy(e),draws};
}
test('60/30/20 render limits run identical movement, attacks, crops, work, recruitment and saved clocks',()=>{
  const frames=Array(1200).fill(1/60),results=Object.values(PERFORMANCE_MODES).map(mode=>simulate(frames,mode.fps));
  assert.equal(results[0].state,results[1].state);assert.equal(results[1].state,results[2].state);
  assert.deepEqual(results.map(r=>r.draws),[1200,600,400]);
  assert.equal(simulate(Array(400).fill(.05),20).state,results[0].state);
  assert.equal(simulate([2,1,.3,8.2,.5,8],20).state,results[0].state,'long active frames never discard elapsed game time');
});
test('a slow step yields to rendering and retained debt drains without losing game time',()=>{
  let now=0,time=0,steps=0;
  const clock=new SimulationClock(()=>now);
  const update=(dt:number)=>{time+=dt;steps++;now+=7;};
  clock.advance(.45,update);
  assert.equal(steps,1);assert(Math.abs(clock.pendingSeconds-.4)<1e-8);assert.equal(clock.alpha,1);
  while(clock.pendingSeconds+1e-9>=SimulationClock.step)clock.advance(0,update);
  assert.equal(steps,9);assert(Math.abs(time-.45)<1e-8);
  const cheap=new SimulationClock(()=>0);let count=0;
  cheap.advance(1,()=>count++);assert.equal(count,3);assert(Math.abs(cheap.pendingSeconds-.85)<1e-8);
});
test('paused time is excluded and substep remainder survives graphics changes',()=>{
  const clock=new SimulationClock();let time=0;
  clock.advance(.03,dt=>time+=dt);clock.advance(0,dt=>time+=dt);clock.advance(.02,dt=>time+=dt);
  assert.equal(time,.05);clock.advance(-1,dt=>time+=dt);clock.advance(NaN,dt=>time+=dt);assert.equal(time,.05);
});
