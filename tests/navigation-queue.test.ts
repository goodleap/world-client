import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationQueue } from '../src/game/navigation-queue.ts';
import { planNavigation, validateNavigation, type NavigationInput } from '../src/game/navigation-plan.ts';
import { groupDestinations } from '../src/game/group-orders.ts';
import { ENEMIES } from '../src/game/resident-data.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';
import { findPath } from '../src/game/pathfinding.ts';
import { WORLD_BOUNDS } from '../src/game/world-data.ts';

const input:NavigationInput={start:{x:0,z:0},goal:{x:5,z:0},radius:.4,bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},solids:[],neighbours:[]};
test('worker orders wait for game flush, replace stale orders and snapshot each member after previous acceptance',()=>{
  let tick=0;const sent:{serial:number;input:NavigationInput}[]=[],applied:string[]=[];
  const worker={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null as ((e:ErrorEvent)=>void)|null,postMessage:(p:typeof sent[number])=>sent.push(p),terminate:()=>{}};
  const q=createNavigationQueue(worker,()=>++tick),reply=()=>worker.onmessage!({data:{serial:sent.at(-1)!.serial,path:[input.goal],ms:1}} as MessageEvent);
  q.request('a',()=>input,()=>applied.push('old'));q.request('b',()=>({...input,neighbours:applied.map(()=>({position:input.goal,radius:.4}))}),()=>applied.push('b'));
  q.request('a',()=>input,()=>applied.push('a'));reply();assert.deepEqual([...applied],[]);assert.equal(sent.length,1);
  q.flush();assert.equal(sent.length,2);reply();q.flush();assert.deepEqual([...applied],['b']);assert.equal(sent.at(-1)!.input.neighbours.length,0);
  q.cancel('a');reply();q.flush();assert.deepEqual([...applied],['b']);assert.equal(q.snapshot().pending,0);
  q.request('c',()=>({...input,neighbours:applied.map(()=>({position:input.goal,radius:.4}))}),()=>applied.push('c'));
  assert.equal(sent.at(-1)!.input.neighbours.length,1);reply();assert.deepEqual(applied,['b']);q.flush();assert.deepEqual(applied,['b','c']);q.dispose();
});
test('prepared routes reject new obstacles and occupied endpoints and join from the live position',()=>{
  const path=[{x:2,z:0},{x:5,z:0}];assert.deepEqual(validateNavigation({...input,start:{x:1,z:0}},path),[{x:5,z:0}]);
  assert.equal(validateNavigation({...input,solids:[{kind:'box',x:3,z:0,halfWidth:1,halfDepth:4}]},path),undefined);
  assert.equal(validateNavigation({...input,neighbours:[{position:{x:5,z:0},radius:.4}]},path),undefined);
});
test('group corridor reuse keeps personal destinations and rejects a shortcut through a changed wall',()=>{
  const hint=[{x:1,z:3},{x:4,z:3},{x:5,z:0}],wall={kind:'box' as const,x:2.5,z:0,halfWidth:.5,halfDepth:2};
  const p={...input,goal:{x:5,z:1},solids:[wall],routeHint:hint};
  const joined=planNavigation(p)!;assert.deepEqual(joined.at(-1),p.goal);assert(validateNavigation(p,joined));
  const stale={...p,routeHint:[{x:3,z:0},{x:5,z:0}]};assert.equal(validateNavigation(stale,stale.routeHint),undefined);
  const fresh=planNavigation(stale)!;assert.deepEqual(fresh.at(-1),p.goal);assert(validateNavigation(stale,fresh));
});
test('every formation size centers on the click with sufficient body clearance',()=>{
  for(let count=1;count<=6;count++){
    const units=Array.from({length:count},(_,i)=>({id:String(i),position:{x:i,z:0},radius:i===0?1.12:.4}));
    const click={x:30,z:40},slots=groupDestinations(units,click);
    assert(Math.abs(slots.reduce((s,p)=>s+p.point.x,0)/count-click.x)<1e-9);assert(Math.abs(slots.reduce((s,p)=>s+p.point.z,0)/count-click.z)<1e-9);
    for(let i=0;i<count;i++)for(let j=0;j<i;j++)assert(Math.hypot(slots[i].point.x-slots[j].point.x,slots[i].point.z-slots[j].point.z)>2.24);
  }
});
test('four remote camps add sixteen reachable, separated enemies with mixed roles',()=>{
  const extra=ENEMIES.filter(e=>['orchard','hollow','lowland','east'].includes(e.camp??'')),solids=economyObstacles([]);assert.equal(extra.length,16);
  for(const e of extra){assert(Math.hypot(e.spawn.x,e.spawn.z)>50);assert(!isBlocked(e.spawn,e.bodyRadius,solids));
    assert(findPath({x:0,z:1.2},e.spawn,e.bodyRadius,WORLD_BOUNDS,solids));}
  assert.equal(extra.filter(e=>e.role==='archer').length,4);assert.equal(extra.filter(e=>e.variant==='heavy').length,4);
});
