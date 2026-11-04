import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { recruit, cancelRecruit, advanceRecruitment, homeResidents } from '../src/game/recruitment.ts';
import { groupMembers, saveGroup, pruneGroups, groupInfo } from '../src/game/groups.ts';
import { groupDestinations } from '../src/game/group-orders.ts';
import { CommandGuidance } from '../src/game/command-guidance.ts';
import { livingPopulation } from '../src/game/home-status.ts';
import { bodiesFor, health } from '../src/game/vitals.ts';
import { Combat } from '../src/game/combat.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';

function funded(){const e=new Economy();e.state.inventory={wood:40,stone:24,food:60,iron:40};return e;}
test('recruitment reserves real inventory, sequences work, refunds and waits for an unobstructed exit',()=>{
  const e=funded(),initial={...e.state.inventory};
  assert(recruit(e,'infantry').ok);assert(recruit(e,'dog').ok);
  assert.equal(e.state.inventory.food,initial.food-12);assert.equal(e.state.inventory.iron,initial.iron-2);
  advanceRecruitment(e,14);assert.equal(e.state.recruitment.roster.length,0);assert.equal(e.state.recruitment.queue[1].elapsed,0);
  const blocked=[{kind:'box' as const,x:10,z:3,halfWidth:30,halfDepth:20}];
  advanceRecruitment(e,2,blocked);assert.equal(e.state.recruitment.queue[0].elapsed,15);assert.equal(e.state.recruitment.roster.length,0);
  const resumed=decodeEconomy(encodeEconomy(e)),unit=advanceRecruitment(resumed,.05)!;
  assert.equal(unit.role,'infantry');assert(!isBlocked(unit.spawn,unit.bodyRadius,economyObstacles([],[],[])));
  assert.equal(livingPopulation(resumed.state),7);assert.equal(health(resumed.state,unit.id),120);
  assert.equal(resumed.state.recruitment.queue[0].elapsed,0);
  const dogOrder=resumed.state.recruitment.queue[0];assert(cancelRecruit(resumed,dogOrder.serial));assert(!cancelRecruit(resumed,dogOrder.serial));
  assert.equal(resumed.state.inventory.food,initial.food-8);
  advanceRecruitment(resumed,100);assert.equal(resumed.state.recruitment.roster.length,1);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(resumed)));
});
test('new cavalry and dog have independent needs; death persists and releases only the matching population slot',()=>{
  const e=funded();recruit(e,'cavalry');const cavalry=advanceRecruitment(e,25)!;
  assert.equal(bodiesFor(cavalry.id).length,2);assert.equal(health(e.state,`horse:${cavalry.id}`),160);
  assert.notEqual(e.state.vitals[`horse:${cavalry.id}`],e.state.vitals.horse);
  for(let i=0;i<3;i++){assert(recruit(e,'dog').ok);advanceRecruitment(e,8);}
  assert.equal(livingPopulation(e.state),7);assert.equal(recruit(e,'dog').ok,false);
  const c=new Combat(e.state.combat,e,()=>[]);
  c.hurt(cavalry.id,1000,'enemy-0');assert.equal(livingPopulation(e.state),6);
  const dog=e.state.recruitment.roster.find(r=>r.role==='dog')!;c.hurt(dog.id,1000,'enemy-0');
  assert(recruit(e,'dog').ok);assert.equal(e.state.vitals[dog.id].hp,0);
  const restored=decodeEconomy(encodeEconomy(e));assert.equal(health(restored.state,cavalry.id),0);assert.equal(health(restored.state,dog.id),0);
  assert.equal(homeResidents(restored.state).length,11);
});
test('queue and human cap include pending recruits and reject unknown saved workers',()=>{
  const e=funded();e.state.inventory.food=200;for(let i=0;i<20;i++)assert(recruit(e,'farmer').ok);
  assert.equal(recruit(e,'farmer').ok,false);assert.equal(decodeEconomy(encodeEconomy(e)).state.recruitment.queue.length,20);
  while(e.state.recruitment.queue.length)advanceRecruitment(e,10);
  for(let i=0;i<173;i++){e.state.inventory.food=60;assert(recruit(e,'farmer').ok);advanceRecruitment(e,10);}
  assert.equal(livingPopulation(e.state),199);e.state.inventory.food=60;assert(recruit(e,'farmer').ok);
  assert.equal(recruit(e,'farmer').ok,false,'queued recruit reserves the 200th slot');
  advanceRecruitment(e,10);assert.equal(livingPopulation(decodeEconomy(encodeEconomy(e)).state),200);
  const combat=new Combat(e.state.combat,e,()=>[]);combat.hurt('infantry',1000,'enemy-0');
  assert.equal(livingPopulation(e.state),199);assert(recruit(e,'farmer').ok,'death releases exactly one slot');
  const task=e.request('harvest','plot-0').task!;task.worker='recruit-farmer-99999';
  assert.throws(()=>decodeEconomy(encodeEconomy(e)),/任务存档/);
});
test('groups move membership without changing orders, sum bars, prune dead members and round trip',()=>{
  const e=funded();recruit(e,'archer');const unit=advanceRecruitment(e,15)!;
  const before=structuredClone(e.state.combat);
  assert(saveGroup(e,0,['farmer','dog','infantry',unit.id]));assert.deepEqual(e.state.combat,before);
  assert(saveGroup(e,1,['dog',unit.id]));assert.deepEqual(groupMembers(e.state,0),['farmer','infantry']);
  assert.equal(saveGroup(e,2,['farmer','farmer']),false);
  const idle=()=>({moving:false,speed:0,working:false}),info=groupInfo(e,1,idle)!;
  assert.equal(info.meters[0].maximum,190);assert.equal(info.meters[1].value,200);
  const c=new Combat(e.state.combat,e,()=>[]);c.hurt(unit.id,1000,'enemy-0');pruneGroups(e);
  assert.deepEqual(e.state.groups[1],['dog']);assert.deepEqual(decodeEconomy(encodeEconomy(e)).state.groups,e.state.groups);
});
test('large armies can save more than 96 independent arrows without losing or duplicating them',()=>{
  const e=funded(),target=e.state.combat.units.find(u=>u.id==='enemy-guard')!;
  for(let i=0;i<100;i++){
    e.state.inventory.food=60;e.state.inventory.wood=40;assert(recruit(e,'archer').ok);
    const r=advanceRecruitment(e,15)!;
    e.state.combat.projectiles.push({id:e.state.combat.nextAttack++,source:r.id,target:target.id,
      from:{x:target.position.x+5,z:target.position.z},to:{...target.position},elapsed:.1,duration:.5,damage:14});
  }
  const restored=decodeEconomy(encodeEconomy(e));assert.deepEqual(restored.state.combat.projectiles,e.state.combat.projectiles);
  const c=new Combat(restored.state.combat,restored,()=>[]);for(let i=0;i<10;i++)c.update(.05);
  assert.equal(c.state.projectiles.length,0);assert.equal(c.unit(target.id)!.hp,0);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(restored)));
});
test('loose group destinations keep cavalry bodies separate and preserve the target center',()=>{
  const units=Array.from({length:6},(_,i)=>({id:String(i),position:{x:i*2,z:0},radius:1.12}));
  const slots=groupDestinations(units,{x:10,z:10});
  assert.equal(new Set(slots.map(s=>s.id)).size,6);
  assert(Math.abs(slots.reduce((sum,s)=>sum+s.point.x,0)/6-10)<1e-6);
  for(let i=0;i<slots.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(slots[i].point.x-slots[j].point.x,slots[i].point.z-slots[j].point.z)>2.24);
});
test('automatic deselection guidance waits for a route, freezes on pause and ends on cancellation, replacement or selection',()=>{
  const guide=new CommandGuidance();let state={token:4,alive:true,route:false};
  guide.request('farmer',4);assert.equal(guide.sample(100,()=>state),undefined);
  state.route=true;assert.deepEqual(guide.sample(110,()=>state),{id:'farmer',alpha:1});
  assert.equal(guide.sample(112.25,()=>state)?.alpha,.5);assert.equal(guide.sample(112.25,()=>state)?.alpha,.5);
  assert.equal(guide.sample(112.5,()=>state),undefined);
  guide.request('farmer',4);assert.equal(guide.sample(120,()=>({...state,token:5})),undefined);
  guide.request('farmer',4);assert.equal(guide.sample(120,()=>state,'farmer'),undefined);
  guide.request('farmer',4);guide.sample(120,()=>state);assert.equal(guide.sample(120.1,()=>({...state,route:false})),undefined);
});
