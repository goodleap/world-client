import { withCrowdStep } from './native-test-runtime.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy,encodeEconomy,decodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { buildingAt,buildingDoor } from '../src/game/construction.ts';
import { newTower,requestGarrison,updateTowers,evictTower,TOWER_CONFIG,towerHeight,towerPlatform,garrisonCandidate,garrisonAvailability } from '../src/game/towers.ts';
import { recruit,advanceRecruitment } from '../src/game/recruitment.ts';
import { maxHealth } from '../src/game/vitals.ts';
import { newWolf } from '../src/game/raid-state.ts';
import { Raids } from '../src/game/raids.ts';
import { createNeedsController } from '../src/game/needs-controller.ts';
import { newCampfire } from '../src/game/campfire.ts';
import { RESIDENTS } from '../src/game/resident-data.ts';

function setup(){
  const e=new Economy();e.setLeadership(false);
  const site=buildingAt('tower',{x:18,z:0},'site-0');e.state.sites.push(site);e.state.buildings.push(site.id);e.state.nextSiteId=1;
  const tower=newTower(site);e.state.towers.push(tower);
  const solids=()=>[{kind:'box' as const,x:site.x,z:site.z,halfWidth:site.width/2+.12,halfDepth:site.depth/2+.12}];
  const c=new Combat(e.state.combat,e,()=>tower.hp>0?solids():[]);
  for(const u of c.state.units){u.position={x:u.team==='home'?-50:50,z:50};u.order='hold';}
  const archer=c.unit('archer')!;archer.position={x:site.x,z:site.z-6};
  const step=(seconds:number)=>{for(let t=0;t<seconds-1e-8;t+=.05){e.state.seconds+=.05;withCrowdStep(e,c,()=>tower.hp>0?solids():[],.05,()=>{updateTowers(e,c);c.update(.05);});}};
  const enter=()=>{assert(requestGarrison(e,c,tower.id,archer.id).ok);step(3);assert.equal(tower.phase,'occupied');};
  return {e,c,site,tower,archer,step,enter};
}
test('tower reserves one archer, approaches the real entrance and persists occupation',()=>{
  const s=setup();assert.equal(requestGarrison(s.e,s.c,s.tower.id,'infantry').ok,false);
  assert(requestGarrison(s.e,s.c,s.tower.id,'archer').ok);assert.equal(s.tower.phase,'approach');
  assert.equal(requestGarrison(s.e,s.c,s.tower.id,'archer').ok,false);
  assert.deepEqual(s.archer.goal,buildingDoor(s.site));
  const approach=decodeEconomy(encodeEconomy(s.e));assert.equal(approach.state.towers[0].phase,'approach');
  s.step(3);assert.equal(s.tower.phase,'occupied');assert.equal(towerHeight(s.e.state,'archer'),TOWER_CONFIG.height);
  assert.equal(decodeEconomy(encodeEconomy(s.e)).state.towers[0].unit,'archer');
});
test('automatic garrison prefers reachable ungrouped archers and respects a single explicit choice',()=>{
  const s=setup();s.e.state.inventory={wood:40,food:40,stone:0,iron:0};
  const recruits=[];
  for(let i=0;i<2;i++){assert(recruit(s.e,'archer').ok);recruits.push(advanceRecruitment(s.e,15)!);}
  const c=new Combat(s.e.state.combat,s.e,()=>[]),near=c.unit(recruits[0].id)!,far=c.unit(recruits[1].id)!;
  s.archer.position={x:s.site.x,z:s.site.z-3};near.position={x:s.site.x,z:s.site.z-5};far.position={x:s.site.x,z:s.site.z-9};
  s.e.state.groups[0]=['archer'];
  const before=encodeEconomy(s.e);
  assert.equal(garrisonCandidate(s.e,c,s.tower.id)?.id,near.id);
  assert.equal(garrisonCandidate(s.e,c,s.tower.id,['archer'])?.id,'archer');
  assert.equal(encodeEconomy(s.e),before,'preview must not change orders, groups or seats');
  near.target='enemy-guard';assert.equal(garrisonCandidate(s.e,c,s.tower.id)?.id,far.id);
  far.goal={x:20,z:20};assert.equal(garrisonCandidate(s.e,c,s.tower.id)?.id,'archer');
  near.target=undefined;far.goal=undefined;
  // A closed enclosure around the nearest ungrouped archer excludes it.
  const walls=[{kind:'box' as const,x:near.position.x,z:near.position.z-1,halfWidth:1,halfDepth:.1},
    {kind:'box' as const,x:near.position.x,z:near.position.z+1,halfWidth:1,halfDepth:.1},
    ...[-1,1].map(dx=>({kind:'box' as const,x:near.position.x+dx,z:near.position.z,halfWidth:.1,halfDepth:1}))];
  const blocked=new Combat(s.e.state.combat,s.e,()=>walls);
  assert.equal(garrisonCandidate(s.e,blocked,s.tower.id)?.id,far.id);
  assert.equal(garrisonCandidate(s.e,blocked,s.tower.id,[near.id]),undefined,'explicit unreachable choice is not silently replaced');
});
test('an idle person at the entrance does not disable automatic garrison; the archer waits without overlapping',()=>{
  const s=setup(),door=buildingDoor(s.site);
  const blocker={id:'farmer',position:{...door},radius:.29,moving:false,purposeful:false,waiting:false};
  const c=new Combat(s.e.state.combat,s.e,()=>[{kind:'box',x:s.site.x,z:s.site.z,halfWidth:s.site.width/2+.12,halfDepth:s.site.depth/2+.12}],()=>[blocker]);
  assert.equal(garrisonCandidate(s.e,c,s.tower.id)?.id,'archer');
  assert(requestGarrison(s.e,c,s.tower.id,'archer').ok);
  const step=()=>{s.e.state.seconds+=.05;updateTowers(s.e,c);c.update(.05);};
  for(let i=0;i<60;i++){
    step();assert(Math.hypot(s.archer.position.x-door.x,s.archer.position.z-door.z)>=.69-1e-6);
  }
  assert.equal(s.tower.phase,'approach');
  blocker.position={x:door.x+3,z:door.z};
  for(let i=0;i<60&&s.tower.phase==='approach';i++)step();
  assert.equal(s.tower.phase,'occupied');assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(s.e)));
  const blocked=setup(),wall=new Combat(blocked.e.state.combat,blocked.e,()=>[{kind:'circle',...buildingDoor(blocked.site),radius:2}]);
  assert.equal(garrisonAvailability(blocked.e,wall,blocked.tower.id).reason,'入口无法到达');
});
test('garrison shoots at twelve units from the deck, checks cover and never chases',()=>{
  const s=setup();s.enter();const enemy=s.c.unit('enemy-grove-0')!;
  enemy.position={x:s.site.x+10,z:s.site.z};enemy.order='rest';enemy.goal=undefined;enemy.route=[];
  s.step(.8);assert(s.e.state.combat.projectiles.some(p=>p.source==='archer'&&p.from.y===TOWER_CONFIG.height+1.25));
  const before=enemy.hp;s.step(1);assert(enemy.hp<before);
  enemy.position.x=s.site.x+20;s.step(2);assert.deepEqual(s.archer.position,towerPlatform(s.tower));assert.equal(s.archer.route.length,0);
  assert.equal(s.archer.target,undefined);
  const blocked=new Combat(s.e.state.combat,s.e,()=>[{kind:'box',x:s.site.x+5,z:s.site.z,halfWidth:1,halfDepth:20}]);
  enemy.position.x=s.site.x+10;const health=enemy.hp;
  for(let i=0;i<30;i++)blocked.update(.05);assert.equal(enemy.hp,health);
});
test('a garrison damages an enemy beyond an adjacent tower without changing range or armor',()=>{
  const s=setup();s.enter();
  const adjacent=buildingAt('tower',{x:s.site.x+3,z:s.site.z},'site-1');s.e.state.sites.push(adjacent);s.e.state.buildings.push(adjacent.id);s.e.state.towers.push(newTower(adjacent));
  const obstacles=s.e.state.sites.map(t=>({kind:'box' as const,x:t.x,z:t.z,halfWidth:t.width/2+.12,halfDepth:t.depth/2+.12}));
  const c=new Combat(s.e.state.combat,s.e,()=>obstacles),enemy=c.unit('enemy-grove-0')!;
  enemy.position={x:s.site.x+10,z:s.site.z};enemy.order='rest';enemy.goal=undefined;enemy.route=[];
  const hp=enemy.hp;
  for(let i=0;i<45;i++){s.e.state.seconds+=.05;c.update(.05);}
  assert(enemy.hp<hp,'walking occupancy of the neighboring tower must not block elevated arrows');
  assert.deepEqual(s.archer.position,towerPlatform(s.tower));
});
test('melee attacks the tower rather than its protected archer; destruction evacuates and damages once',()=>{
  const s=setup();s.enter();const enemy=s.c.unit('enemy-grove-0')!;
  enemy.position={x:s.site.x,z:s.site.z-2.7};enemy.defendFrom={...enemy.position};enemy.provoked={from:{...enemy.position},leash:14};enemy.target=s.archer.id;enemy.order='guard';
  const hp=s.archer.hp;s.step(2);assert(s.tower.hp<TOWER_CONFIG.hp);assert.equal(s.archer.hp,hp);
  s.c.hurt(s.tower.id,10000,enemy.id);assert.equal(s.tower.hp,0);assert.equal(s.archer.hp,hp-maxHealth('archer')*.25);
  assert.equal(towerHeight(s.e.state,'archer'),0);assert(!s.e.state.sites.some(t=>t.id===s.tower.id));assert.equal(s.tower.unit,undefined);
  const after=s.archer.hp;s.c.hurt(s.tower.id,10000,enemy.id);assert.equal(s.archer.hp,after);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(s.e)));
});
test('manual movement leaves a tower; eating retains reservation and returns after recovery',()=>{
  const s=setup();s.enter();const point={x:s.site.x,z:s.site.z-7};
  assert(s.c.move(['archer'],point,false,true));assert.equal(s.tower.phase,'meal');assert.equal(towerHeight(s.e.state,'archer'),0);
  s.step(4);s.archer.goal=undefined;s.archer.route=[];s.archer.order='hold';s.e.state.vitals.archer.rest=undefined;
  s.step(3);assert.equal(s.tower.phase,'occupied');
  assert(evictTower(s.e,s.c,s.tower.id));assert.equal(s.tower.unit,undefined);assert.equal(towerHeight(s.e.state,'archer'),0);
  s.step(2);assert(s.c.move(['archer'],point));assert.equal(s.tower.phase,'empty');
});
test('lethal collapse preserves death and ordinary tower deaths retain platform height',()=>{
  const s=setup();s.enter();s.archer.hp=10;s.c.hurt(s.tower.id,10000,'enemy-0');assert.equal(s.archer.life,'defeated');assert.equal(s.archer.hp,0);
  const saved=decodeEconomy(encodeEconomy(s.e));assert.equal(saved.state.combat.units.find(u=>u.id==='archer')!.life,'defeated');
  const second=setup();second.enter();second.c.hurt('archer',1000,'enemy-0');assert.equal(second.archer.deathElevation,TOWER_CONFIG.height);assert.equal(second.tower.unit,undefined);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(second.e)));
});
test('wolves can bite the tower but cannot bite a garrison through the platform',()=>{
  const s=setup();s.enter();const w=newWolf('wolf-1-0',{x:s.site.x,z:s.site.z-2.8});
  Object.assign(s.e.state.raids,{wave:1,phase:'raid',wolves:[w],origin:{...w.position},startedAt:s.e.state.seconds});
  const people={status:(id:string)=>({position:RESIDENTS.find(r=>r.id===id)!.spawn,moving:false}),command:()=>false,release:()=>{},resting:()=>{},neighbours:()=>[]};
  const raids=new Raids(s.e,s.c,people,()=>[{kind:'box',x:s.site.x,z:s.site.z,halfWidth:s.site.width/2+.12,halfDepth:s.site.depth/2+.12}],()=>false);
  const hp=s.archer.hp;for(let i=0;i<30;i++){s.e.state.seconds+=.05;raids.update(.05);s.c.update(.05);}
  assert.equal(w.target,s.tower.id);assert(s.tower.hp<TOWER_CONFIG.hp);assert.equal(s.archer.hp,hp);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(s.e)));
});

test('tower construction spends its own cost once and validates missing or mismatched occupancy',()=>{
  const e=new Economy();e.setLeadership(false);e.state.inventory={wood:30,stone:20,food:24,iron:4};
  const result=e.placeBuilding('tower',{x:-10.8,z:-10.8});assert(result.ok,result.message);
  const task=e.claim()!;e.arrive(task.id);e.advance(20);assert.equal(e.state.towers.length,1);assert.equal(e.state.towers[0].hp,TOWER_CONFIG.hp);
  assert.equal(e.state.inventory.wood,10);assert.equal(e.state.inventory.stone,8);e.advance(20);assert.equal(e.state.towers.length,1);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
  const invalid=JSON.parse(encodeEconomy(e));invalid.towers[0].unit='infantry';invalid.towers[0].phase='occupied';assert.throws(()=>decodeEconomy(JSON.stringify(invalid)));
});

test('an enemy archer can target a garrison and arrows retain their elevated endpoint',()=>{
  const s=setup();s.enter();const enemy=s.c.unit('enemy-grove-0')!;enemy.role='archer';
  enemy.position={x:s.site.x,z:s.site.z-5};enemy.defendFrom={...enemy.position};enemy.provoked={from:{...enemy.position},leash:14};enemy.target=s.archer.id;enemy.order='guard';enemy.goal=undefined;enemy.route=[];enemy.cooldown=0;
  s.archer.cooldown=10;const hp=s.archer.hp;s.step(2);
  assert.equal(enemy.target,'archer');assert(s.archer.hp<hp);
});

test('hungry garrison uses real meals then returns to the reserved platform',()=>{
  const s=setup();s.enter();
  const fireSite=buildingAt('campfire',{x:s.site.x,z:s.site.z-7.2},'site-1');s.e.state.sites.push(fireSite);s.e.state.buildings.push(fireSite.id);s.e.state.nextSiteId=2;
  const fire=newCampfire(fireSite.id);Object.assign(fire,{enabled:true,wood:20,meals:8});s.e.state.campfires.push(fire);
  const residents={needsStatus:(id:string)=>({position:s.c.unit(id)?.position??{x:-40,z:40},moving:false,speed:0,working:false,goal:undefined}),setResting(){},releaseFarmerWork(){},command:()=>false};
  const needs=createNeedsController(s.e,residents,s.c);s.e.state.vitals.archer.stamina=10;s.e.state.vitals.archer.manualUntil=0;
  needs.update(.05);assert.equal(s.tower.phase,'meal');
  for(let i=0;i<1000&&String(s.tower.phase)!=='occupied';i++){s.e.advance(.05);updateTowers(s.e,s.c);s.c.update(.05);needs.update(.05);}
  assert.equal(s.tower.phase,'occupied');assert(s.e.state.vitals.archer.stamina>=85);assert(fire.meals<8);
});
