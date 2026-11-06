import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_RADIUS, bodyObstacle } from '../src/game/body-shape.ts';
import { isBlocked } from '../src/game/movement.ts';
import type { Obstacle } from '../src/game/movement.ts';
import { segmentIsClear } from '../src/game/wander.ts';
import { planMoveDestination, occupiedApproach } from '../src/game/work-navigation.ts';
import { validateNavigation } from '../src/game/navigation-plan.ts';
import { RESIDENTS, newResident } from '../src/game/resident-data.ts';
import { Combat, fighterRadius, fighterContactRadius } from '../src/game/combat.ts';
import { Economy } from '../src/game/economy.ts';
const bounds={minX:-8,maxX:8,minZ:-8,maxZ:8},radius=BODY_RADIUS.cavalry;
const walls:Obstacle[]=[{kind:'box',x:-2,z:0,halfWidth:1.4,halfDepth:3},{kind:'box',x:2,z:0,halfWidth:1.4,halfDepth:3}];

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
    assert(Math.hypot(u.position.x-before.x,u.position.z-before.z)>.01);
    assert(u.speed>.1);assert.notEqual(u.facing,facing);
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
