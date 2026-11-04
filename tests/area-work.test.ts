import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { pathInDanger, updateDangerZones, dangerObstacles } from '../src/game/danger-zones.ts';
import type { DangerZone } from '../src/game/danger-zones.ts';
import { createSteward } from '../src/game/steward.ts';
import { Combat } from '../src/game/combat.ts';
import { Raids } from '../src/game/raids.ts';
import { createEconomyController } from '../src/game/economy-controller.ts';
import type { Point } from '../src/game/movement.ts';

test('nearby new jobs and different farmers share area exclusion without probing the dangerous target',()=>{
  const e=new Economy();e.setLeadership(false);
  const p=e.plot('plot-0')!;
  updateDangerZones(e.state.dangerZones,[{id:'foe',x:p.x,z:p.z,radius:2}],0);
  const task=e.request('harvest',p.id,undefined,'steward').task!;
  assert.equal(e.claim('farmer'),undefined);assert(task.danger);
  assert.equal(e.claim('farmer-2'),undefined);
  e.state.goods.push({id:'goods-100',x:p.x+.5,z:p.z,resource:'wood',amount:3,state:'ground'});e.state.nextId=101;
  const other=e.request('haul','goods-100',undefined,'continuation').task!;assert.equal(e.claim('farmer-2'),undefined);assert(other.danger);
  e.setLeadership(true);
  const steward=createSteward(e,p=>!pathInDanger(e.state.dangerZones,[p]));
  const job=steward.requestWork();if(job)assert(!pathInDanger(e.state.dangerZones,[e.taskPoint(job)!]));
  assert(e.state.tasks.every(t=>t.worker===undefined));
});

test('area memory survives moving enemies, return visits and save/reload; only ten continuously safe game seconds clear it',()=>{
  let e=new Economy();const threat={id:'foe',x:4,z:4,radius:3};
  updateDangerZones(e.state.dangerZones,[threat],0);
  updateDangerZones(e.state.dangerZones,[],1);e.state.seconds=5;e=decodeEconomy(encodeEconomy(e));
  updateDangerZones(e.state.dangerZones,[],10.9);assert(pathInDanger(e.state.dangerZones,[threat]));
  updateDangerZones(e.state.dangerZones,[threat],11);updateDangerZones(e.state.dangerZones,[],12);
  updateDangerZones(e.state.dangerZones,[],21.9);assert(pathInDanger(e.state.dangerZones,[threat]));
  updateDangerZones(e.state.dangerZones,[],22);assert.equal(e.state.dangerZones.length,0);
  const trail:DangerZone[]=[];updateDangerZones(trail,[threat],0);updateDangerZones(trail,[{...threat,x:20}],1);
  assert(pathInDanger(trail,[threat]));assert(pathInDanger(trail,[{x:20,z:4}]));
});

test('guard area memory persists behind cover and clears after guards leave and ten safe seconds pass',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]);
  const r=new Raids(e,c,{status:()=>({position:{x:0,z:0},moving:false}),command:()=>false,release:()=>{},resting:()=>{},neighbours:()=>[]},
    ()=>[{kind:'box',x:-25,z:4,halfWidth:10,halfDepth:.5}],()=>false);
  const point={x:-25,z:9};assert(r.unsafePath([point]));
  assert(!r.unsafePath([{x:-10,z:-10}]),'a safe home fire is outside the ore guards\' acquisition area; chase leash is not a hazard radius');
  for(const u of c.state.units.filter(u=>u.id.startsWith('enemy-road-')))u.position={x:-35,z:9};
  e.state.seconds=15;assert(r.unsafePath([point]));
  assert(r.unsafePath([{x:-45,z:9},{x:-5,z:9}]));
  for(const u of c.state.units.filter(u=>u.id.startsWith('enemy-road-')))u.position={x:-50,z:9};
  e.state.seconds=16;r.unsafePath([]);
  e.state.seconds=26;assert(!r.unsafePath([point]));
});

test('automatic repairs queue all damaged buildings once, reserve resources, pause by area and persist the switch',()=>{
  let e=new Economy();e.setLeadership(false);e.state.inventory={wood:80,stone:80,food:0,iron:0};
  e.damageBuilding('warehouse',100);e.damageBuilding('cottage',60);e.setAutoRepair(true);
  assert.equal(e.state.tasks.filter(t=>t.kind==='repair').length,2);const reserved=e.reserved();
  e.arrangeRepairs();assert.deepEqual(e.reserved(),reserved);assert.equal(e.state.inventory.wood,80);
  e=decodeEconomy(encodeEconomy(e));assert.equal(e.state.autoRepair,true);
  const task=e.taskFor('warehouse')!,point=e.taskPoint(task)!;
  updateDangerZones(e.state.dangerZones,[{id:'foe',...point,radius:2}],e.state.seconds);
  e.claim('farmer');e.claim('farmer-2');assert(task.danger);assert.equal(task.worker,undefined);
  e.setAutoRepair(false);e.cancel(task.id);e.arrangeRepairs();assert.equal(e.taskFor('warehouse'),undefined);
  e.state.dangerZones=[];e.setAutoRepair(true);assert(e.taskFor('warehouse'));
  for(const t of e.state.tasks.filter(t=>t.kind==='repair'&&['waiting','travelling'].includes(t.status))){
    t.danger=undefined;assert(e.assign(t.id,'farmer').ok);e.arrive(t.id);e.advance(9);
  }
  assert.equal(e.state.buildingHealth.warehouse,undefined);assert.equal(e.state.buildingHealth.cottage,undefined);
});

test('outbound work detours around areas and a dangerous return warehouse prevents dispatch',()=>{
  for (const blockedReturn of [false,true]) {
    const e=new Economy();e.setLeadership(false);const from={x:-10,z:-18},goal={x:-2,z:-18};
    e.state.goods.push({id:'goods-1',...goal,resource:'wood',amount:4,state:'ground'});e.state.nextId=2;
    const task=e.request('haul','goods-1',undefined,'continuation').task!;
    e.state.dangerZones.push({id:'camp:review',...(blockedReturn?e.warehouseDoors()[0]:{x:-6,z:-18}),radius:1.2});
    let dispatched:Point[]|undefined;
    const residents:Parameters<typeof createEconomyController>[2]={
      farmerIds:()=>['farmer'],farmerPosition:()=>from,canWork:()=>true,hasMoveCommand:()=>false,
      command:()=>false,farmerWorkState:()=>undefined,releaseFarmerWork:()=>{},beginFarmerWork:()=>{},
      planFarmerWork:p=>[...p],startFarmerWork:(_id,path)=>{dispatched=path;},
    };
    const controller=createEconomyController(e,{sync:()=>false,workPoints:()=>({points:[goal],target:goal})},residents,false,
      ()=>{},()=>{},()=>true,p=>pathInDanger(e.state.dangerZones,p),()=>dangerObstacles(e.state.dangerZones));
    controller.update(.05);
    if(blockedReturn){assert(task.danger);assert.equal(dispatched,undefined);assert.equal(e.state.goods[0].state,'ground');}
    else {assert(dispatched&&dispatched.length>1);assert(!task.danger);assert(!pathInDanger(e.state.dangerZones,task.watchPath!));}
  }
});
