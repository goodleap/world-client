import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy,encodeEconomy,decodeEconomy } from '../src/game/economy.ts';
import { buildingInfo,buildingOperational,repairQuote } from '../src/game/building-state.ts';
import { Combat } from '../src/game/combat.ts';
import { recruit,advanceRecruitment } from '../src/game/recruitment.ts';
import { BUILDINGS, WAREHOUSE_DOOR } from '../src/game/world-data.ts';
import { buildingAt, buildingDoor } from '../src/game/construction.ts';
import { createEconomyController } from '../src/game/economy-controller.ts';
import { newCampfire } from '../src/game/campfire.ts';
import { newTower } from '../src/game/towers.ts';

function setup(){const e=new Economy();e.setLeadership(false);e.state.inventory={wood:100,stone:100,food:100,iron:50};return e;}
function finish(e:Economy,id:number,seconds=8){assert(e.assign(id).ok);e.arrive(id);e.advance(seconds);}
test('all completed structures use their armor for hostile damage, reject friendly fire and persist HP',()=>{
  const e=setup(),c=new Combat(e.state.combat,e,()=>[]);
  for(const b of BUILDINGS){
    const before=buildingInfo(e.state,b.id)!;assert(c.target(b.id));
    c.hurt(b.id,30,'infantry');assert.equal(buildingInfo(e.state,b.id)!.hp,before.hp);
    c.hurt(b.id,30,'enemy-guard');assert.equal(buildingInfo(e.state,b.id)!.hp,before.hp-30*20/(20+before.armor));
  }
  assert.deepEqual(decodeEconomy(encodeEconomy(e)).state.buildingHealth,e.state.buildingHealth);
});
test('repair reserves a proportional quote once, survives interruption/reload and only restores the quoted loss',()=>{
  let e=setup();e.damageBuilding('warehouse',250);
  const q=repairQuote(e.state,'warehouse')!;assert.deepEqual(q,{hp:250,cost:{wood:3,stone:2,food:0,iron:0}});
  const task=e.request('repair','warehouse').task!;assert(task);assert(!e.request('repair','warehouse').ok);
  assert.deepEqual(e.reserved(),q.cost);const stock={...e.state.inventory};finish(e,task.id,3);
  assert.deepEqual(e.state.inventory,stock);assert.equal(buildingInfo(e.state,'warehouse')!.hp,750);
  e.interrupt(undefined,'farmer');e=decodeEconomy(encodeEconomy(e));
  assert.equal(e.taskFor('warehouse')!.progress,3);assert.deepEqual(e.taskFor('warehouse')!.repair,q);
  e.damageBuilding('warehouse',100);finish(e,task.id,5);
  assert.equal(buildingInfo(e.state,'warehouse')!.hp,900);
  assert.equal(e.state.inventory.wood,stock.wood-3);assert.equal(e.state.inventory.stone,stock.stone-2);
  e.advance(10);assert.equal(e.state.inventory.wood,stock.wood-3);
  const next=e.request('repair','warehouse').task!;finish(e,next.id);
  assert.equal(buildingInfo(e.state,'warehouse')!.hp,1000);assert(!e.request('repair','warehouse').ok);
  assert.equal(e.state.buildingHealth.warehouse,undefined);assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
});
test('repair cancel and insufficient materials never spend or heal; malformed quotes are rejected',()=>{
  const e=setup();e.damageBuilding('cottage',600);const task=e.request('repair','cottage').task!;
  finish(e,task.id,2);const stock={...e.state.inventory};assert(e.cancel(task.id));
  assert.deepEqual(e.state.inventory,stock);assert.equal(e.reserved().wood,0);assert.equal(buildingInfo(e.state,'cottage')!.hp,0);
  e.state.inventory.wood=0;const next=e.request('repair','cottage').task!;assert(!next.reserved);assert(!e.assign(next.id).ok);
  const raw=JSON.parse(encodeEconomy(e));raw.tasks.find((t:{id:number})=>t.id===next.id).repair.cost.wood=0;
  assert.throws(()=>decodeEconomy(JSON.stringify(raw)),/维修/);
});
test('destroyed center pauses recruitment; warehouse retains stock but stops deliveries until repaired',()=>{
  const e=setup();assert(recruit(e,'farmer').ok);advanceRecruitment(e,2);const progress=e.state.recruitment.queue[0].elapsed;
  e.damageBuilding('home-center',1500);assert(!recruit(e,'archer').ok);advanceRecruitment(e,20);assert.equal(e.state.recruitment.queue[0].elapsed,progress);
  finish(e,e.request('repair','home-center').task!.id);assert(buildingOperational(e.state,'home-center'));assert(advanceRecruitment(e,20));
  const stock={...e.state.inventory},capacity=e.capacity();e.damageBuilding('warehouse',1000);
  assert.equal(e.warehouseDoors().length,0);assert.deepEqual(e.state.inventory,stock);assert.deepEqual(e.capacity(),capacity);
  const restored=decodeEconomy(encodeEconomy(e));assert.equal(restored.warehouseDoors().length,0);
  finish(restored,restored.request('repair','warehouse').task!.id);assert.equal(restored.warehouseDoors().length,1);
});
test('tower repairs retain its slot and HP; collapsed towers cannot be repaired; broken fire stays off',()=>{
  const e=setup(),tower=buildingAt('tower',{x:18,z:0},'site-0'),fire=buildingAt('campfire',{x:22,z:0},'site-1');
  e.state.sites.push(tower,fire);e.state.buildings.push(tower.id,fire.id);e.state.nextSiteId=2;
  e.state.towers.push(newTower(tower));e.state.campfires.push(newCampfire(fire.id));
  const c=new Combat(e.state.combat,e,()=>[]);c.hurt(tower.id,150,'enemy-guard');assert.equal(e.state.towers[0].hp,400);
  finish(e,e.request('repair',tower.id).task!.id);assert.equal(e.state.towers[0].hp,500);
  c.hurt(tower.id,10000,'enemy-guard');assert(!e.request('repair',tower.id).ok);
  c.hurt(fire.id,10000,'enemy-guard');e.setFire(fire.id,true);assert.equal(e.campfire(fire.id)!.enabled,false);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
});
test('cargo arriving at a destroyed warehouse reroutes to a healthy door before crediting inventory',()=>{
  const e=setup(),site=buildingAt('warehouse',{x:20,z:0},'site-0');
  e.state.sites.push(site);e.state.buildings.push(site.id);e.state.nextSiteId=1;
  e.state.goods.push({id:'goods-1',resource:'wood',amount:8,state:'ground',x:0,z:0});e.state.nextId=2;
  const task=e.request('haul','goods-1').task!;e.assign(task.id);e.arrive(task.id);e.damageBuilding('warehouse',1000);
  type Residents=Parameters<typeof createEconomyController>[2];
  let position={...WAREHOUSE_DOOR},work:ReturnType<Residents['farmerWorkState']>={id:task.id,status:'arrived'},route:{x:number;z:number}[]=[];
  const residents:Residents={farmerIds:()=>['farmer'],farmerPosition:()=>position,canWork:()=>true,hasMoveCommand:()=>false,command:()=>false,
    farmerWorkState:()=>work,releaseFarmerWork:()=>{work=undefined;},beginFarmerWork:()=>{},planFarmerWork:p=>[...p],
    startFarmerWork:(id,path)=>{route=path;work={id,status:'travelling'};}};
  const controller=createEconomyController(e,{sync:()=>false,workPoints:()=>({points:e.warehouseDoors(),target:buildingDoor(site)})},residents,false);
  const stock=e.state.inventory.wood;controller.update(.01);assert.equal(e.state.inventory.wood,stock);assert.equal(e.state.goods[0].state,'transit');assert.deepEqual(route,[buildingDoor(site)]);
  position={...route.at(-1)!};work={id:task.id,status:'arrived'};controller.update(.01);
  assert.equal(e.state.inventory.wood,stock+8);assert.equal(e.state.goods.length,0);
});
