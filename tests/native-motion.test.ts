import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeNavigation } from '../src/game/native-navigation.ts';
import { createNativeMotion, type CrowdBody } from '../src/game/native-motion.ts';
import { createRouteState } from '../src/game/route-following.ts';
import { BODY_RADIUS } from '../src/game/body-shape.ts';
import { fighterStats } from '../src/game/combat.ts';
import { RESIDENTS, wanderSettings } from '../src/game/resident-data.ts';
import { destinationSpeed } from '../src/game/locomotion.ts';
import { segmentIsClear } from '../src/game/wander.ts';
import type { Point, Obstacle } from '../src/game/movement.ts';

const bounds={minX:-50,maxX:50,minZ:-50,maxZ:50},dt=.05;
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
const roles=['infantry','archer','cavalry'] as const;
const movers=[...(['home','enemy'] as const).flatMap(team=>roles.map(role=>({id:`${team}-${role}`,radius:BODY_RADIUS[role],speed:fighterStats({team,role}).speed}))),
  ...(['farmer','dog'] as const).map(role=>({id:role,radius:BODY_RADIUS[role],speed:destinationSpeed(wanderSettings(RESIDENTS.find(r=>r.role===role)!).speed,role!=='dog')}))];

test('all movers arrive at speed in the open and at a warehouse door without predicting travel through the wall',async()=>{
  const nav=await createNativeNavigation();
  const layouts:Obstacle[][]=[[],[{kind:'box',x:0,z:7,halfWidth:2.65,halfDepth:1.37}]];
  try{for(const solids of layouts)for(const config of movers){
    const motion=createNativeMotion(nav,bounds,()=>solids),state=createRouteState(),goal={x:0,z:5};
    const actor:CrowdBody&{route:Point[]}={...config,position:{x:0,z:0},route:[goal],solids};
    let ticks=0;
    try{
      while(actor.route.length&&ticks<100){
        motion.prepare([actor],dt);
        const step=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,actor.radius,bounds,solids,[]);
        assert(step.position.z<=goal.z+.001,`${actor.id} must not overshoot`);
        assert(segmentIsClear(actor.position,step.position,actor.radius,bounds,solids),'retain wall clearance');
        if(actor.route.length)assert(step.distance/dt>actor.speed*.95,`${actor.id} must not crawl towards a clear destination`);
        actor.position=step.position;ticks++;
      }
      assert.equal(actor.route.length,0);
      assert(distance(actor.position,goal)<.001);
      assert(ticks<=Math.ceil(5/actor.speed/dt)+1,`${actor.id} arrives without an extra braking tail`);
      actor.moveIdle=(p:Point)=>{actor.position=p;};
      for(let i=0;i<6;i++)motion.prepare([actor],dt);
      assert(distance(actor.position,goal)<.001,'arrival also clears native velocity');
    }finally{motion.dispose();}
  }}finally{nav.dispose();}
});

test('the final approach retains native body separation at an occupied destination',async()=>{
  const nav=await createNativeNavigation(),solids:Obstacle[]=[],motion=createNativeMotion(nav,bounds,()=>solids),state=createRouteState();
  const actor={id:'farmer',position:{x:0,z:-2},radius:.29,speed:5,route:[{x:0,z:0}],solids};
  const blocker:CrowdBody={id:'idle',position:{x:0,z:0},radius:.4,speed:0,route:[],solids};
  blocker.moveIdle=p=>{blocker.position=p;};
  try{for(let i=0;i<80&&actor.route.length;i++){
    motion.prepare([actor,blocker],dt);
    actor.position=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,actor.radius,bounds,solids,[]).position;
    assert(distance(actor.position,blocker.position)>=actor.radius+blocker.radius-.03,'no arrival snap through a neighbour');
  }}finally{motion.dispose();nav.dispose();}
});

test('retargeting during the final approach restores a native corridor around obstacles',async()=>{
  const nav=await createNativeNavigation(),solids:Obstacle[]=[{kind:'box',x:3,z:0,halfWidth:1,halfDepth:1}],motion=createNativeMotion(nav,bounds,()=>solids),state=createRouteState();
  const actor={id:'farmer',position:{x:0,z:-.5},radius:.29,speed:5,route:[{x:0,z:0}],solids};
  try{
    motion.prepare([actor],dt);actor.position=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,actor.radius,bounds,solids,[]).position;
    const goal={x:6,z:0};actor.route=nav.path(actor.position,[goal],actor.radius,bounds,solids)!;
    assert(actor.route.length>1);
    for(let i=0;i<150&&actor.route.length;i++){
      motion.prepare([actor],dt);
      const step=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,actor.radius,bounds,solids,[]);
      assert(segmentIsClear(actor.position,step.position,actor.radius,bounds,solids));actor.position=step.position;
    }
    assert.equal(actor.route.length,0);assert(distance(actor.position,goal)<.001);
  }finally{motion.dispose();nav.dispose();}
});

test('both factions, farmers and dogs pass an occupied intermediate waypoint and regain cruising speed',async()=>{
  const nav=await createNativeNavigation(),solids:Obstacle[]=[];
  try{for(const config of movers){
    const motion=createNativeMotion(nav,bounds,()=>solids),state=createRouteState(),route=[{x:0,z:0},{x:0,z:40}];
    const actor={...config,position:{x:0,z:-5},route,solids};
    const blocker:CrowdBody={id:'idle',position:{x:0,z:0},radius:.6,speed:0,route:[],solids};
    blocker.moveIdle=p=>{blocker.position=p;};
    const speeds:number[]=[];
    try{for(let i=0;i<100;i++){
      motion.prepare([actor,blocker],dt);
      const step=motion.runtime.step(actor.id,actor.position,route,state,dt,actor.speed,actor.radius,bounds,solids,[]);
      actor.position=step.position;speeds.push(step.distance/dt);
      assert(distance(actor.position,blocker.position)>=actor.radius+blocker.radius-.03,`${actor.id} keeps physical separation`);
    }
    assert(actor.position.z>7,`${actor.id} must continue beyond the occupied intermediate point`);
    assert(speeds.slice(-10).every(s=>s>actor.speed*.95),`${actor.id} must recover its own cruising speed`);
    assert.deepEqual(route,[{x:0,z:40}],'keep the final destination');
    }finally{motion.dispose();}
  }}finally{nav.dispose();}
});

test('route continuation keeps body clearance around a building and still stops at the final point',async()=>{
  const nav=await createNativeNavigation(),solids:Obstacle[]=[{kind:'box',x:0,z:0,halfWidth:1,halfDepth:3}];
  try{for(const radius of [.29,.4,.6]){
    const motion=createNativeMotion(nav,bounds,()=>solids),state=createRouteState(),goal={x:6,z:0};
    const actor={id:'corner',position:{x:-6,z:0},radius,speed:5,route:nav.path({x:-6,z:0},[goal],radius,bounds,solids)!,solids};
    assert(actor.route.length>1);
    try{for(let i=0;i<200&&actor.route.length;i++){
      motion.prepare([actor],dt);
      const step=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,radius,bounds,solids,[]);
      assert(segmentIsClear(actor.position,step.position,radius,bounds,solids),'do not cut the blocked corner');
      actor.position=step.position;
    }
    assert(distance(actor.position,goal)<.03,'arrive at the actual final destination');
    assert.equal(actor.route.length,0);
    }finally{motion.dispose();}
  }}finally{nav.dispose();}
});

test('Crowd keeps automatic danger exclusions and accepts retargeting after a reposition',async()=>{
  const nav=await createNativeNavigation(),world:Obstacle[]=[],danger:Obstacle[]=[{kind:'circle',x:0,z:0,radius:3}];
  const motion=createNativeMotion(nav,bounds,()=>world),state=createRouteState();
  const actor={id:'farmer',position:{x:-7,z:0},radius:.29,speed:5,route:nav.path({x:-7,z:0},[{x:7,z:0}],.29,bounds,danger)!,solids:danger};
  try{
    for(let i=0;i<180&&actor.route.length;i++){
      motion.prepare([actor],dt);const step=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,actor.radius,bounds,danger,[]);
      assert(segmentIsClear(actor.position,step.position,actor.radius,bounds,danger));actor.position=step.position;
    }
    assert(distance(actor.position,{x:7,z:0})<.03,'use the legal route around a role-specific excluded area');
    actor.position={x:8,z:8};actor.route=[{x:8,z:-8}];
    for(let i=0;i<4;i++){motion.prepare([actor],dt);actor.position=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,actor.radius,bounds,danger,[]).position;}
    actor.route=[{x:12,z:8}];
    for(let i=0;i<120&&actor.route.length;i++){motion.prepare([actor],dt);actor.position=motion.runtime.step(actor.id,actor.position,actor.route,state,dt,actor.speed,actor.radius,bounds,danger,[]).position;}
    assert(distance(actor.position,{x:12,z:8})<.03,'a new destination replaces the native corridor');
  }finally{motion.dispose();nav.dispose();}
});
