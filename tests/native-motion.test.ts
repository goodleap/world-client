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
