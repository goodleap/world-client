import test from 'node:test';
import assert from 'node:assert/strict';
import { updateDangerZones, pathInDanger, DANGER_CONFIG } from '../src/game/danger-zones.ts';
import type { DangerZone } from '../src/game/danger-zones.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { Raids } from '../src/game/raids.ts';

test('a distant wolf cannot renew its old mark, while its present area remains unsafe', () => {
  const zones: DangerZone[] = [];
  updateDangerZones(zones, [{id:'wolf',x:0,z:0,radius:13}], 0);
  for (let t=.5;t<10.5;t+=.5) {
    updateDangerZones(zones, [{id:'wolf',x:30,z:0,radius:13}], t);
    assert(pathInDanger(zones,[{x:0,z:0}]),'old mark stays until ten continuous safe seconds');
  }
  assert.equal(zones.find(z=>z.id==='area:0:0')?.safeSince,.5);
  updateDangerZones(zones, [{id:'wolf',x:30,z:0,radius:13}], 10.5);
  assert(!pathInDanger(zones,[{x:0,z:0}]));
  assert(pathInDanger(zones,[{x:30,z:0}]));
  assert(pathInDanger(zones,[{x:20,z:-20},{x:40,z:20}]),'intermediate route segments still count');
});

test('guards back inside their camp do not keep a cleared village mark alive', () => {
  const zones: DangerZone[]=[];
  updateDangerZones(zones,[{id:'guard',x:4,z:-4,radius:10}],0);
  const home=[{id:'camp',x:24,z:-2,radius:15,fixed:true},{id:'guard',x:22,z:-1,radius:10}];
  updateDangerZones(zones,home,1); updateDangerZones(zones,home,11);
  assert(!zones.some(z=>z.id==='area:4:-4'));
  assert(pathInDanger(zones,[{x:22,z:-1}]));
  assert(!pathInDanger(zones,[{x:1.8,z:-2.3}]));
});

test('a threat returning to the edge buffer restarts the shared clearance clock', () => {
  const zones: DangerZone[]=[];
  updateDangerZones(zones,[{id:'foe',x:0,z:0,radius:2}],0);
  const old=zones[0],edge=old.radius+DANGER_CONFIG.buffer-.1;
  updateDangerZones(zones,[],1); updateDangerZones(zones,[],9);
  updateDangerZones(zones,[{id:'foe',x:edge,z:0,radius:2}],9.5);
  assert.equal(old.safeSince,undefined);
  updateDangerZones(zones,[],10); updateDangerZones(zones,[],19.9);
  assert(zones.includes(old));
  updateDangerZones(zones,[],20); assert.equal(zones.length,0);
});

test('farmers and dog resume when the shared region clears, including save/reload, without five more seconds', () => {
  let e=new Economy(); e.state.raids.nextAt=1000;
  updateDangerZones(e.state.dangerZones,[{id:'past-threat',x:0,z:0,radius:2}],0);
  const released:string[]=[];
  const controller=()=>new Raids(e,new Combat(e.state.combat,e,()=>[]),{
    status:id=>({position:['farmer','dog'].includes(id)?{x:0,z:0}:{x:40,z:40},moving:false}),
    command:()=>false,release:id=>released.push(id),resting:()=>{},neighbours:()=>[],
  },()=>[],()=>false);
  let r=controller(); r.update(.05);
  const advance=(until:number)=>{while(e.state.seconds<until-1e-8){e.state.seconds=Math.min(until,e.state.seconds+.05);r.update(.05);}};
  assert(e.state.raids.evading.farmer&&e.state.raids.evading.dog);
  advance(5); e=decodeEconomy(encodeEconomy(e)); r=controller();
  const frozen=JSON.stringify(e.state.dangerZones);
  for(let i=0;i<50;i++)r.update(0);
  assert.equal(JSON.stringify(e.state.dangerZones),frozen);
  advance(9.9); assert(!r.canWork('farmer')&&!r.canWork('dog'));
  advance(10.6); assert(r.canWork('farmer')&&r.canWork('dog'));
  assert(released.filter(id=>id==='farmer').length>=2);
  assert(!e.state.dangerZones.some(z=>z.id==='area:0:0'));
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
  const old=JSON.parse(encodeEconomy(e));old.version=20;
  assert.throws(()=>decodeEconomy(JSON.stringify(old)),/存档版本/);
});

test('leaving an uncleared region waits for full body clearance, then permits safe work immediately', () => {
  const e=new Economy();e.state.raids.nextAt=1000;
  updateDangerZones(e.state.dangerZones,[{id:'past-threat',x:0,z:0,radius:2}],0);
  const edge=e.state.dangerZones[0].radius,position={x:0,z:0};
  const r=new Raids(e,new Combat(e.state.combat,e,()=>[]),{
    status:id=>({position:['farmer','dog'].includes(id)?position:{x:40,z:40},moving:false}),
    command:()=>false,release:()=>{},resting:()=>{},neighbours:()=>[],
  },()=>[],()=>false);
  const tick=()=>{for(let i=0;i<10;i++){e.state.seconds+=.05;r.update(.05);}};
  tick();assert(!r.canWork('dog'));
  position.x=edge+.2;tick();assert(!r.canWork('dog')&&!r.canWork('farmer'),'centers alone are outside, but bodies are not');
  position.x=edge+.65;tick();assert(r.canWork('dog')&&r.canWork('farmer'));
  assert(e.state.dangerZones.some(z=>z.id==='area:0:0'),'other work remains blocked inside the cooling region');
});
