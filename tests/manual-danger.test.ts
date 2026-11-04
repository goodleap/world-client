import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { createEconomyController } from '../src/game/economy-controller.ts';
import { Combat } from '../src/game/combat.ts';
import { Raids } from '../src/game/raids.ts';
import { dangerObstacles, pathInDanger } from '../src/game/danger-zones.ts';
import { ECONOMY_CONFIG } from '../src/game/economy-config.ts';
import { gridPoint, WORLD_BOUNDS } from '../src/game/world-data.ts';
import { usePathPlanner, type PathQuery } from '../src/game/path-planner.ts';
import { findPath } from '../src/game/pathfinding.ts';

function setup(e=new Economy()) {
  e.setLeadership(false);e.state.raids.nextAt=1000;
  type Residents=Parameters<typeof createEconomyController>[2];
  let work:ReturnType<Residents['farmerWorkState']>, moving=false, reachable=true;
  const position={x:0,z:-3};
  const residents:Residents={
    farmerIds:()=>['farmer'],farmerPosition:()=>position,canWork:id=>id==='farmer',hasMoveCommand:()=>moving&&!work,
    command:()=>{moving=true;work=undefined;return true;},farmerWorkState:()=>work,
    releaseFarmerWork:()=>{work=undefined;moving=false;},
    beginFarmerWork:id=>{work={id,status:'working'};},
    planFarmerWork:points=>reachable?[...points]:undefined,
    startFarmerWork:(id,path)=>{moving=false;work={id,status:'travelling',path};},
  };
  const combat=new Combat(e.state.combat,e,()=>[]);
  const raids=new Raids(e,combat,{
    status:id=>({position:id==='farmer'?position:{x:90,z:90},moving}),
    command:()=>{moving=true;return true;},release:residents.releaseFarmerWork,resting:()=>{},neighbours:()=>[],
  },()=>[],()=>false);
  const controller=createEconomyController(e,{
    sync:()=>false,workPoints:()=>({points:[{...position}],target:{...position}}),
  },residents,false,()=>{},()=>{},(id,task)=>raids.canWork(id,task?.origin==='manual'),
  points=>pathInDanger(e.state.dangerZones,points),()=>dangerObstacles(e.state.dangerZones),id=>!!raids.state.evading[id]);
  const tick=(seconds=.05)=>{controller.update(seconds);raids.update(.05);};
  return {e,combat,position,raids,controller,residents,tick,
    arrive:()=>{if(work)work.status='arrived';tick();},
    blocked:()=>{reachable=false;},
    hazard:()=>e.state.dangerZones.push({id:'area:0:-3',...position,radius:30}),
  };
}

test('queued player construction overrides evasion and finishes despite dangerous target, route and long work',()=>{
  const h=setup(),{e}=h;h.hazard();
  e.state.inventory={wood:24,stone:16,food:0,iron:0};
  h.raids.update(.05);assert(e.state.raids.evading.farmer);assert(h.residents.hasMoveCommand('farmer'));
  const task=e.placeBuilding('house',gridPoint(44,56)).task!;assert(task);assert.equal(task.origin,'manual');
  for(let i=0;i<8;i++)h.tick();assert.equal(e.active()?.id,task.id);assert(!e.state.raids.evading.farmer);
  h.arrive();const before={...e.state.inventory};
  for(let i=0;i<180;i++)h.tick();
  assert.equal(task.status,'done');assert(!task.danger);assert(e.state.buildings.includes(task.target));
  assert.equal(e.state.inventory.wood,before.wood-12);assert.equal(e.state.inventory.stone,before.stone-8);
});

test('explicit work takes over a held automatic job without losing progress or reservation; physical reachability still applies',()=>{
  const h=setup(),{e,controller:c}=h;h.hazard();
  const task=e.request('sow','plot-2','wheat','steward').task!;e.claim();
  assert(task.danger);task.progress=.5;const reserved=e.reserved();
  const order={kind:'work',work:'sow',target:'plot-2',crop:'wheat'} as const;
  assert(c.command('farmer',order).ok);assert.equal(task.origin,'manual');assert(!task.danger);
  assert.equal(task.progress,.5);assert.deepEqual(e.reserved(),reserved);
  h.arrive();h.tick(3);assert.equal(task.status,'done');
  h.blocked();assert(!c.command('farmer',{...order,target:'plot-3'}).ok);
  assert(!c.command('infantry',{...order,target:'plot-3'}).ok);
});

test('taking over already active automatic work changes its authority without restarting work',()=>{
  const h=setup(),{e,controller:c}=h;
  const task=e.request('sow','plot-2','wheat','steward').task!;
  h.tick();h.arrive();const state=h.residents.farmerWorkState('farmer');
  assert(c.command('farmer',{kind:'work',work:'sow',target:task.target,crop:'wheat'}).ok);
  assert.equal(task.origin,'manual');assert.strictEqual(h.residents.farmerWorkState('farmer'),state);
  h.hazard();h.tick(.6);assert(!task.danger);assert.equal(task.status,'working');
});

test('manual gathering keeps authority through pickup, reload and delivery; automatic continuations still wait',()=>{
  for(const origin of ['manual','steward'] as const){
    let e=new Economy();e.setLeadership(false);
    const task=e.request('chop','tree-0',undefined,origin).task!;e.claim();e.arrive(task.id);e.advance(ECONOMY_CONFIG.workSeconds.chop);
    const haul=e.active()!;assert.equal(haul.origin,origin==='manual'?'manual':'continuation');
    const h=setup(e);h.hazard();h.tick();
    if(origin==='steward'){assert(haul.danger);assert.equal(e.state.goods[0].state,'ground');continue;}
    assert(!haul.danger);e=decodeEconomy(encodeEconomy(e));assert.equal(e.active()?.origin,'manual');
    const resumed=setup(e);resumed.tick();resumed.arrive();assert.equal(e.active()?.status,'delivering');
    e=decodeEconomy(encodeEconomy(e));assert.equal(e.active()?.origin,'manual');
    e.arrive(haul.id);e.arrive(haul.id);assert.equal(e.state.inventory.wood,24);assert.equal(e.state.goods.length,0);
  }
});

test('queued work cannot replace a player move and automatic work cannot replace evasion',()=>{
  const h=setup(),{e}=h;h.hazard();
  const auto=e.request('sow','plot-2','wheat','steward').task!;
  h.raids.update(.05);h.tick();assert(!auto.worker);
  const manual=e.request('sow','plot-3','wheat').task!;
  h.raids.manual('farmer');h.residents.command({x:3,z:0},'farmer');h.tick();
  assert(!manual.worker);assert(!auto.worker);
});

test('danger follows actual guard alert range instead of adding camp size and a second buffer',()=>{
  const h=setup(),{e}=h;
  for(const unit of e.state.combat.units)if(unit.team==='enemy')unit.departed=true;
  for(const wolf of [...e.state.raids.wildWolves,...e.state.raids.wolves])wolf.mode='gone';
  const guard=e.state.combat.units.find(u=>u.id==='enemy-guard')!;
  guard.departed=false;guard.position={x:24,z:-2};
  assert(h.raids.unsafePath([{x:16.5,z:-2}]));
  assert(!h.raids.unsafePath([{x:14,z:-2}]));
  assert(!e.state.dangerZones.some(z=>z.id.startsWith('camp:')));
});


test('actual damage interrupts manual work, preserves progress and waits for the attacker to leave before resuming',()=>{
  const h=setup(),{e,combat,position}=h;
  const foe=combat.unit('enemy-guard')!;foe.position={x:position.x+1,z:position.z};
  const task=e.request('sow','plot-2','wheat').task!;h.tick();h.arrive();task.progress=.4;
  assert.equal(task.status,'working');assert(!e.state.raids.evading.farmer,'manual work ignores preventive danger');
  e.state.vitals.farmer.manualUntil=1000;
  combat.hurt('farmer',2,foe.id);
  for(let i=0;i<12;i++)h.tick();
  assert.equal(task.status,'waiting');const progress=task.progress;assert(progress>=.4&&progress<1);assert.equal(task.threat?.source,foe.id);
  assert.equal(h.raids.state.evading.farmer?.attacker,foe.id);assert(h.residents.hasMoveCommand('farmer'));
  assert(!h.raids.canWork('farmer',true));assert(!e.claim('farmer-2'));
  const loaded=decodeEconomy(encodeEconomy(e));assert.equal(loaded.state.tasks.find(t=>t.id===task.id)!.threat!.source,foe.id);
  const resumed=setup(loaded),saved=resumed.e.state.tasks.find(t=>t.id===task.id)!;
  resumed.combat.unit(foe.id)!.position={x:80,z:80};
  for(let i=0;i<85;i++)resumed.tick();
  assert(!saved.threat);assert.equal(saved.origin,'manual');assert.equal(resumed.e.active('farmer')?.id,saved.id);
  assert.equal(saved.progress,progress);
});

test('attack escape preserves hauled goods and a newer player command overrides the escape',()=>{
  const h=setup(),{e,combat,position}=h;
  const foe=combat.unit('enemy-guard')!;foe.position={x:position.x+1,z:position.z};
  const cargo=e.dropReward(position,{wood:3})[0],task=e.request('haul',cargo).task!;
  assert(e.assign(task.id,'farmer').ok);e.arrive(task.id);assert.equal(e.state.goods[0].state,'transit');
  combat.hurt('farmer',2,foe.id);h.raids.update(.6);
  assert.equal(task.status,'waiting');assert(task.threat);assert.equal(e.state.goods[0].state,'ground');
  assert.equal(e.state.goods[0].amount,3);assert.equal(decodeEconomy(encodeEconomy(e)).state.goods[0].amount,3);
  h.raids.manual('farmer');assert(!e.state.raids.evading.farmer);assert(!e.state.vitals.farmer.lastAttack);
  // Explicit reissuing is permitted even while that same hostile remains nearby.
  assert(e.assign(task.id,'farmer').ok);assert(!task.threat);
  h.raids.update(.6);assert.equal(e.active('farmer')?.id,task.id);assert(!e.state.raids.evading.farmer);
});


test('escape keeps a pending worker query stable and validates the answer against moved neighbours',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]);e.setLeadership(false);e.state.raids.nextAt=1000;
  const position={x:0,z:-3},foe=c.unit('enemy-guard')!;foe.position={x:1,z:-3};
  let bystander={x:40,z:40},first:PathQuery|undefined,adopted=false,requests=0;
  const restore=usePathPlanner(query=>{
    if(query.radius===.29){requests++;if(!first){first=structuredClone(query);return null;}assert.deepEqual(query,first);}
    return findPath(query.start,query.goals[0],query.radius,query.bounds,query.obstacles);
  });
  try{
    const raids=new Raids(e,c,{
      status:id=>({position:id==='farmer'?position:{x:90,z:90},moving:false}),release:()=>{},resting:()=>{},neighbours:()=>[],
      movementInput:(_id,goal)=>({start:position,goal,radius:.29,bounds:WORLD_BOUNDS,
        solids:[{kind:'box',x:(goal.x+position.x)/2,z:(goal.z+position.z)/2,halfWidth:.3,halfDepth:.3}],
        neighbours:[{position:{...bystander},radius:.4}]}),
      command:(_point,id,path)=>{if(id==='farmer'&&path?.length)adopted=true;return true;},
    },()=>[],()=>false);
    e.state.vitals.farmer.manualUntil=1000;c.hurt('farmer',2,foe.id);
    raids.update(.05);assert(first);assert(!adopted);bystander={x:45,z:44};
    for(let i=0;i<8&&!adopted;i++){e.state.seconds+=.1;raids.update(.1);}
    assert(adopted,'a changing crowd must not restart the pending route forever');assert.equal(requests,2);
  }finally{restore();}
});
