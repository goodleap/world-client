import {updateDangerZones,pathInDanger} from '../src/game/danger-zones.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import {Economy,encodeEconomy,decodeEconomy} from '../src/game/economy.ts';
import {buildingAt} from '../src/game/construction.ts';import {newCampfire} from '../src/game/campfire.ts';
import {newTower,evictTower,towerPlatform} from '../src/game/towers.ts';import {Combat} from '../src/game/combat.ts';
import {createEconomyController} from '../src/game/economy-controller.ts';import {Raids} from '../src/game/raids.ts';
import {WAREHOUSE_DOOR} from '../src/game/world-data.ts';import {ECONOMY_CONFIG} from '../src/game/economy-config.ts';
function site(e:Economy,kind:'warehouse'|'tower'|'campfire'|'house',built=true){const s=buildingAt(kind,{x:-10,z:-10},`site-${e.state.nextSiteId++}`);e.state.sites.push(s);if(built)e.state.buildings.push(s.id);return s;}
function finishRemoval(e:Economy,id:string){const task=e.taskFor(id)!;assert(e.assign(task.id).ok);e.arrive(task.id);e.advance(ECONOMY_CONFIG.workSeconds.demolish);}
test('demolition releases unfinished reservations, spills excess warehouse stock and never refunds twice',()=>{
  const e=new Economy();e.state.inventory={wood:80,stone:80,food:80,iron:20};
  const unbuilt=site(e,'house',false);const task=e.request('build',unbuilt.id).task!;assert(task.reserved);const before={...e.state.inventory};
  assert(e.demolish(unbuilt.id).ok);assert.deepEqual(e.state.inventory,before);assert.equal(e.reserved().wood,0);assert(!e.demolish('home-center').ok);
  const queued=decodeEconomy(encodeEconomy(e));assert(queued.cancel(queued.taskFor(unbuilt.id)!.id));assert(queued.state.sites.some(s=>s.id===unbuilt.id));assert(queued.request('build',unbuilt.id).ok);
  assert(e.state.sites.some(s=>s.id===unbuilt.id));finishRemoval(e,unbuilt.id);assert(!e.state.sites.some(s=>s.id===unbuilt.id));
  const store=site(e,'warehouse');e.state.inventory.wood=ECONOMY_CONFIG.capacity.wood+70;const quote=e.demolition(store.id)!;
  e.damageBuilding(store.id,100);e.request('repair',store.id);
  assert(e.demolish(store.id).ok);assert.equal(e.state.inventory.wood,ECONOMY_CONFIG.capacity.wood+70);finishRemoval(e,store.id);assert.equal(e.state.inventory.wood,ECONOMY_CONFIG.capacity.wood);
  assert.equal(e.state.goods.filter(g=>g.resource==='wood').reduce((n,g)=>n+g.amount,0),70+quote.refund.wood);
  const loaded=decodeEconomy(encodeEconomy(e)),count=loaded.state.goods.length;assert(!loaded.demolish(store.id).ok);assert.equal(loaded.state.goods.length,count);
});
test('removing fire clears its personal supply and preserves incoming goods, meals and raw stocks',()=>{
  const e=new Economy();const s=site(e,'campfire');e.state.campfires.push({...newCampfire(s.id),enabled:true,wood:3,food:2,meals:1,cook:2});
  const t=e.request('supply',s.id,undefined,'manual',{resource:'wood',amount:2}).task!;assert(e.assign(t.id).ok);e.arrive(t.id);
  e.state.vitals.farmer.rest={camp:s.id,goal:{x:0,z:0},supply:t.id};e.updateCargo({x:2,z:-3});
  assert(e.demolish(s.id).ok);e.setFire(s.id,false);finishRemoval(e,s.id);assert.equal(e.state.vitals.farmer.rest,undefined);assert(!e.state.goods.some(g=>g.destination===s.id||g.carrier));
  assert.equal(e.state.goods.filter(g=>g.resource==='food').reduce((n,g)=>n+g.amount,0),4);
  assert.equal(e.state.goods.filter(g=>g.resource==='wood').reduce((n,g)=>n+g.amount,0),5);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
});
test('removing an unfinished field can be cancelled and saved without losing the plot',()=>{
  let e=new Economy();e.setLeadership(false);const p=e.state.plots[2];p.tilled=false;
  assert(e.request('till',p.id).ok);assert(e.demolish(p.id).ok);
  e=decodeEconomy(encodeEconomy(e));assert(e.cancel(e.taskFor(p.id)!.id));assert(e.plot(p.id));
  assert(e.demolish(p.id).ok);finishRemoval(e,p.id);assert(!e.plot(p.id));assert.equal(e.state.goods.length,0);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
});
test('occupied tower blocks demolition until a safe exit is available, then removes without falling damage',()=>{
  const e=new Economy(),s=site(e,'tower'),tower=newTower(s);tower.unit='archer';tower.phase='occupied';e.state.towers.push(tower);
  const c=new Combat(e.state.combat,e,()=>[]),u=c.unit('archer')!;u.position=towerPlatform(tower);const hp=u.hp;
  assert(e.demolish(s.id).ok);finishRemoval(e,s.id);assert.equal(e.state.sites.length,1);assert.match(e.taskFor(s.id)!.reason,/入口/);
  e.setDemolitionPreparation(id=>evictTower(e,c,id));e.advance(.05);
  assert.equal(u.hp,hp);assert.equal(e.state.towers.length,0);assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
});
test('demolition waits for a farmer, persists partial progress, cancels intact and ignores automatic danger',()=>{
  let e=new Economy();e.setLeadership(false);const s=site(e,'house');
  assert(e.demolish(s.id).ok);e.advance(30);assert(e.state.sites.some(v=>v.id===s.id));assert.equal(e.state.goods.length,0);
  let task=e.taskFor(s.id)!;e.holdDanger(task);assert.equal(task.danger,undefined);
  assert(e.assign(task.id).ok);e.arrive(task.id);e.advance(1.5);
  e=decodeEconomy(encodeEconomy(e));task=e.taskFor(s.id)!;assert.equal(task.progress,1.5);
  assert(e.cancel(task.id));e.advance(5);assert(e.state.sites.some(v=>v.id===s.id));assert.equal(e.state.goods.length,0);
  assert(e.demolish(s.id).ok);finishRemoval(e,s.id);assert(!e.state.sites.some(v=>v.id===s.id));
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
});
test('danger is shared by all farmers, pauses without a timer escape, persists and resumes only after its shared area stays safe for ten game seconds',()=>{
  let e=new Economy();e.setLeadership(false);e.state.goods.push({id:'goods-1',x:8,z:-3,resource:'wood',amount:8,state:'ground'});e.state.nextId=2;
  let t=e.request('haul','goods-1',undefined,'continuation').task!;e.claim();e.arrive(t.id);e.updateCargo({x:4,z:-3});
  t.watchPath=[{x:0,z:-3},{x:8,z:-3},{...WAREHOUSE_DOOR}];e.holdDanger(t,{x:4,z:-3});
  assert.equal(e.state.goods[0].state,'ground');assert.equal(e.claim('farmer-2'),undefined);
  for(let i=0;i<20;i++){e.advance(.5);e.checkDanger(()=>true);}assert(t.danger);assert.equal(e.claim(),undefined);
  updateDangerZones(e.state.dangerZones,[{id:'foe',x:4,z:-3,radius:2}],e.state.seconds);
  const check=()=>{updateDangerZones(e.state.dangerZones,[],e.state.seconds);e.checkDanger(p=>pathInDanger(e.state.dangerZones,p));};
  check();e.advance(3);check();e=decodeEconomy(encodeEconomy(e));t=e.taskFor('goods-1')!;assert(t.danger);assert.equal(t.reason,'危险，等待清场');
  updateDangerZones(e.state.dangerZones,[{id:'foe',x:4,z:-3,radius:2}],e.state.seconds);check();
  e.advance(9.9);check();assert(t.danger);
  e.advance(.11);check();assert(!t.danger);assert.equal(e.claim('farmer-2')?.id,t.id);
  assert.equal(e.state.goods.reduce((n,g)=>n+g.amount,0),8);
});
test('dispatch checks a dangerous route before moving and gives another farmer safe work',()=>{
  const e=new Economy();e.setLeadership(false);e.state.goods.push({id:'goods-1',x:8,z:-3,resource:'wood',amount:8,state:'ground'});e.state.nextId=2;
  const bad=e.request('haul','goods-1',undefined,'continuation').task!,safe=e.request('sow','plot-2','wheat','steward').task!;
  type R=Parameters<typeof createEconomyController>[2];let moving:number[]=[];
  const r:R={farmerIds:()=>['farmer','farmer-2'],farmerPosition:()=>({x:1,z:-3}),canWork:()=>true,hasMoveCommand:()=>false,command:()=>false,farmerWorkState:()=>undefined,releaseFarmerWork:()=>{},beginFarmerWork:()=>{},planFarmerWork:p=>[...p],startFarmerWork:id=>{moving.push(id);}};
  const controller=createEconomyController(e,{sync:()=>false,workPoints:id=>({points:id==='goods-1'?[{x:8,z:-3}]:[{x:1,z:-4}],target:{x:0,z:0}})},r,false,()=>{},()=>{},()=>true,path=>path.some(p=>p.x>6));
  controller.update(.05);assert(bad.danger);assert(!moving.includes(bad.id));assert(moving.includes(safe.id));
});
test('route risk covers enemies along intermediate segments, not just the destination',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]);for(const u of c.state.units)if(u.team==='enemy')u.departed=true;
  const foe=c.unit('enemy-guard')!;foe.departed=false;foe.position={x:0,z:0};
  const r=new Raids(e,c,{status:()=>({position:{x:30,z:30},moving:false}),command:()=>false,release:()=>{},resting:()=>{},neighbours:()=>[]},()=>[],()=>false);
  assert(r.unsafePath([{x:-15,z:0},{x:15,z:0}]));assert(!r.unsafePath([{x:-15,z:20},{x:15,z:20}]));
});
