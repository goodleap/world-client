import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/game/economy.ts';
import { Combat, fighterRadius } from '../src/game/combat.ts';
import { usePathPlanner,type PathQuery } from '../src/game/path-planner.ts';
import type { Neighbour } from '../src/game/route-following.ts';

test('a rear attacker advances to a nearby free point when every contact slot is occupied, then joins combat',()=>{
  const e=new Economy();e.setLeadership(false);
  const crowd:Neighbour[]=Array.from({length:12},(_,i)=>({id:`crowd-${i}`,position:{x:Math.cos(i*Math.PI/6)*1.3,z:Math.sin(i*Math.PI/6)*1.3},radius:.4,moving:false,purposeful:false,waiting:false}));
  const c=new Combat(e.state.combat,e,()=>[],()=>crowd),actor=c.unit('infantry')!,foe=c.unit('enemy-guard')!;
  for(const u of c.state.units)if(u!==actor&&u!==foe){u.position={x:80,z:80};u.cooldown=100;}
  actor.position={x:0,z:-16};foe.position={x:0,z:0};foe.cooldown=100;
  assert.equal(c.attack([actor.id],foe.id),1);
  const step=()=>{foe.order='hold';foe.goal={...foe.position};foe.route=[];e.state.seconds+=.05;c.update(.05);};
  for(let i=0;i<140;i++)step();
  assert(Math.hypot(actor.position.x,actor.position.z)<5,'blocked contact slots must not strand the rear soldier at its starting point');
  assert.equal(foe.hp,65,'the occupied front still prevents contact');
  assert(crowd.every(n=>Math.hypot(actor.position.x-n.position.x,actor.position.z-n.position.z)>=n.radius+fighterRadius(actor)-1e-6));
  crowd.length=0;
  for(let i=0;i<100&&foe.hp===65;i++)step();
  assert(foe.hp<65,'advance again when a contact position opens');
});

test('a movement order replans to a nearby reachable endpoint after its slot becomes occupied',()=>{
  const e=new Economy(),crowd:Neighbour[]=[],c=new Combat(e.state.combat,e,()=>[],()=>crowd),actor=c.unit('infantry')!;
  for(const u of c.state.units)if(u!==actor)u.position={x:80,z:80};
  actor.position={x:0,z:-10};assert.equal(c.move([actor.id],{x:0,z:0}),1);
  crowd.push({id:'new-occupant',position:{x:0,z:0},radius:1,moving:false,purposeful:false,waiting:false});
  for(let i=0;i<240;i++){e.state.seconds+=.05;c.update(.05);}
  assert(Math.hypot(actor.position.x,actor.position.z)<3);assert.equal(actor.order,'guard');assert(!actor.goal);
});


test('crowded attack fallback retains its worker snapshot while other units move',()=>{
  const e=new Economy(),crowd:Neighbour[]=Array.from({length:8},(_,i)=>({id:`front-${i}`,position:{x:Math.cos(i*Math.PI/4)*1.3,z:Math.sin(i*Math.PI/4)*1.3},radius:.4,moving:false,purposeful:false,waiting:false}));
  crowd.push({id:'passing',position:{x:30,z:30},radius:.4,moving:true,purposeful:true,waiting:false});
  const c=new Combat(e.state.combat,e,()=>[],()=>crowd),actor=c.unit('infantry')!,foe=c.unit('enemy-guard')!;
  for(const u of c.state.units)if(u!==actor&&u!==foe){u.position={x:80,z:80};u.cooldown=100;}
  actor.position={x:0,z:-16};foe.position={x:0,z:0};foe.cooldown=100;assert.equal(c.attack([actor.id],foe.id),1);
  let first:PathQuery|undefined,reads=0;
  const restore=usePathPlanner(query=>{
    if(query.start.z!==-16)return undefined;
    reads++;if(!first){first=structuredClone(query);return null;}
    assert.deepEqual(query,first);return [{x:0,z:-2.5}];
  });
  try{
    const step=()=>{foe.order='hold';foe.goal={...foe.position};foe.route=[];e.state.seconds+=.05;c.update(.05);};
    step();assert(first?.move);crowd.at(-1)!.position.x+=1;step();
    assert.equal(reads,2);assert(actor.route.length>0);assert(actor.position.z>-16);
  }finally{restore();}
});
