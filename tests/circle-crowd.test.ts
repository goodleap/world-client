import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_RADIUS, bodyObstacle } from '../src/game/body-shape.ts';
import { findPath } from '../src/game/pathfinding.ts';
import { createRouteState, stepRoute, yieldPoint } from '../src/game/route-following.ts';
import { isBlocked } from '../src/game/movement.ts';
import type { Obstacle, Point } from '../src/game/movement.ts';
import { segmentIsClear } from '../src/game/wander.ts';
import { planMoveDestination, occupiedApproach } from '../src/game/work-navigation.ts';
import { validateNavigation } from '../src/game/navigation-plan.ts';
import { RESIDENTS, newResident } from '../src/game/resident-data.ts';
import { Combat, fighterRadius, fighterContactRadius } from '../src/game/combat.ts';
import { Economy } from '../src/game/economy.ts';
import { sampleMotionPath } from '../src/game/motion-path.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
const bounds={minX:-8,maxX:8,minZ:-8,maxZ:8},radius=BODY_RADIUS.cavalry;
const walls:Obstacle[]=[{kind:'box',x:-2,z:0,halfWidth:1.4,halfDepth:3},{kind:'box',x:2,z:0,halfWidth:1.4,halfDepth:3}];

test('all roles spend their step through a corner, with safe continuous presentation and unchanged speed',()=>{
  for(const role of ['farmer','infantry','archer','cavalry'] as const) {
    const r=BODY_RADIUS[role],solids:Obstacle[]=[{kind:'box',x:0,z:0,halfWidth:1.2,halfDepth:1.2}];
    let p={x:-4,z:0};const route=findPath(p,{x:4,z:0},r,bounds,solids)!;assert(route);
    const state=createRouteState();let corners=0;
    for(let stepIndex=0;stepIndex<200&&route.length;stepIndex++) {
      const next=stepRoute(role,p,route,state,.05,5,r,bounds,solids,[]);
      if(route.length)assert(Math.abs(next.distance-.25)<1e-7,`${role}: no speed dip at waypoints`);
      if(next.path.length>2)corners++;
      for(let i=0;i<=12;i++)assert(!isBlocked(sampleMotionPath(p,next.position,i/12,next.path),r-1e-6,solids));
      p=next.position;
    }
    assert.equal(route.length,0);assert(corners>0);assert.deepEqual(p,{x:4,z:0});
  }
});

test('a 0.6 mounted disc fits a 1.2 passage in either direction and rejects narrower gaps',()=>{
  for (const [from,to] of [[{x:0,z:-5},{x:0,z:5}],[{x:0,z:5},{x:0,z:-5}]]) {
    assert(segmentIsClear(from,to,radius,bounds,walls));
    assert(!segmentIsClear(from,to,radius,bounds,walls.map(w=>({...w,halfWidth:1.41}))));
  }
  assert(!isBlocked({x:0,z:1.01},.4,[bodyObstacle({x:0,z:0},radius)]));
  assert(isBlocked({x:.99,z:0},.4,[bodyObstacle({x:0,z:0},radius)]));
});

test('the same radii govern definitions, recruits, worker plans, adoption and arrival reservations',()=>{
  for (const role of ['infantry','archer','cavalry'] as const) {
    const r=RESIDENTS.find(r=>r.role===role)!;
    assert.equal(r.bodyRadius,role==='cavalry'?.6:.4);
    assert.equal(newResident(role,'recruit-'+role+'-1',{x:0,z:0}).bodyRadius,r.bodyRadius);
    assert.equal(fighterRadius({role}),r.bodyRadius);
    const neighbours=[{position:{x:0,z:0},radius:.4,destination:{x:1,z:0}}],start={x:0,z:-4},goal={x:0,z:-.8};
    const path=planMoveDestination(start,goal,r.bodyRadius,bounds,[],neighbours);assert(path);
    assert(!occupiedApproach(path.at(-1)!,r.bodyRadius,neighbours));
    assert(validateNavigation({start,goal,radius:r.bodyRadius,bounds,solids:[],neighbours},path));
    assert(!validateNavigation({start,goal,radius:r.bodyRadius,bounds,solids:[],neighbours},[goal]));
  }
});

test('cavalry moves on the first step while turning and keeps moving after an about-face command',()=>{
  const e=new Economy();e.setLeadership(false);const c=new Combat(e.state.combat,e,()=>[]);
  for(const u of c.state.units){u.life='defeated';u.hp=0;}
  const u=c.unit('cavalry')!;u.life='active';u.hp=130;u.position={x:0,z:0};u.facing=0;
  for(const x of [5,-5,5,-5]) {
    assert(c.move([u.id],{x,z:0}));const before={...u.position},facing=u.facing;c.update(.05);
    assert(Math.abs(Math.hypot(u.position.x-before.x,u.position.z-before.z)-6.96*.05)<1e-8);
    assert(u.speed>6.9);assert.notEqual(u.facing,facing);
    assert(Math.abs(u.facing-facing)<Math.PI/2, 'turning is gradual, translation is immediate');
  }
});

test('smaller physical cavalry radius preserves established melee contact reach',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]);
  for(const u of c.state.units){u.life='defeated';u.hp=0;}
  const rider=c.unit('cavalry')!,enemy=c.unit('enemy-guard')!;
  rider.life=enemy.life='active';rider.hp=130;enemy.hp=65;
  rider.position={x:0,z:0};rider.order='rest';enemy.position={x:2.3,z:0};enemy.order='attack';enemy.target=rider.id;
  assert.equal(c.target(rider.id)!.radius,.6);assert.equal(c.target(rider.id)!.contactRadius,1.12);
  assert.equal(fighterContactRadius(rider),1.12);
  c.update(.05);assert(enemy.attack, 'original 1.6 + (1.12 - 0.4) melee initiation reach remains');
});

test('a late cavalry formation member passes arrived allies without repeated yield orders',()=>{
  const e=new Economy();e.setLeadership(false);
  const farmer={id:'farmer',position:{x:-6.775,z:-17.775},radius:BODY_RADIUS.farmer,moving:false,purposeful:false,waiting:false};
  const c=new Combat(e.state.combat,e,()=>economyObstacles([],[]),()=>[farmer]);
  for(const u of c.state.units){u.life='defeated';u.hp=0;}
  const rider=c.unit('cavalry')!,archer=c.unit('archer')!,infantry=c.unit('infantry')!;
  for(const u of [rider,archer,infantry]){u.life='active';u.hp=100;}
  rider.position={x:-4.436174903,z:-15.01854577};archer.position={x:-5.225,z:-16.225};infantry.position={x:-6.775688271,z:-16.20594749};
  const arrived=[{...archer.position},{...infantry.position}],goal={x:-5.225,z:-17.775};
  assert(c.move([rider.id],goal));
  for(let i=0;i<200&&rider.goal;i++){
    c.update(.05);
    for(const other of [archer,infantry])assert(Math.hypot(rider.position.x-other.position.x,rider.position.z-other.position.z)>=1-1e-7);
  }
  assert(Math.hypot(rider.position.x-goal.x,rider.position.z-goal.z)<.16,'cavalry reaches its free formation slot');
  assert.deepEqual([archer.position,infantry.position],arrived,'arrived allies keep their slots when a detour is open');
});

test('an idle friend yields from a route and a following column clears the narrow passage',()=>{
  const actors=[{id:'lead',p:{x:0,z:-4},route:[{x:0,z:4}],state:createRouteState(),moving:false},{id:'rear',p:{x:0,z:-5.3},route:[{x:0,z:5.5}],state:createRouteState(),moving:false}];
  let idle:Point={x:0,z:4},idleRoute:Point[]=[],yielded=false;const idleState=createRouteState();
  for(let i=0;i<800&&(actors.some(a=>a.route.length)||idleRoute.length);i++){
    for(const a of actors){const others=actors.filter(b=>b!==a).map(b=>({id:b.id,position:b.p,radius:.4,moving:b.moving,purposeful:!!b.route.length,waiting:b.state.waiting,heading:0}));
      const next=stepRoute(a.id,a.p,a.route,a.state,.05,2,.4,bounds,walls,[...others,{id:'idle',position:idle,radius:.4,moving:!!idleRoute.length,purposeful:!!idleRoute.length,waiting:false,yield:(from,toward)=>{const p=yieldPoint(idle,from,toward,.4,bounds,walls,[...others,{id:a.id,position:a.p,radius:.4,moving:true,purposeful:true,waiting:false}]);if(p){idleRoute=[p];yielded=true;return true;}return false;}}]);a.p=next.position;a.moving=Math.hypot(next.velocity.x,next.velocity.z)>.01;
    }
    const next=stepRoute('idle',idle,idleRoute,idleState,.05,2,.4,bounds,walls,actors.map(a=>({id:a.id,position:a.p,radius:.4,moving:a.moving,purposeful:true,waiting:a.state.waiting})));idle=next.position;
    assert(Math.hypot(actors[0].p.x-actors[1].p.x,actors[0].p.z-actors[1].p.z)>=.8-1e-7);
  }
  assert(yielded);assert(actors.every(a=>a.route.length===0));
});
