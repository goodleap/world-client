import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat, effectiveFighterStats, fighterStats } from '../src/game/combat.ts';
import { soldierLevel } from '../src/game/unit-progression.ts';
import { maxHealth, changeHealth } from '../src/game/vitals.ts';
import { populationInfo } from '../src/game/unit-info.ts';
import { ENEMIES } from '../src/game/resident-data.ts';
import { isBlocked } from '../src/game/movement.ts';
import { economyObstacles } from '../src/game/economy-config.ts';

test('actual fractional damage grants both teams XP, excludes overkill and friendly fire, and preserves wounds on upgrade',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]),a=c.unit('infantry')!,b=c.unit('enemy-guard')!;
  const levels:{id:string;level:number}[]=[];c.setLevelFeedback((id,level)=>levels.push({id,level}));
  a.experience=199;a.hp=70;e.state.upgrades.arms=2;
  const before=b.hp;c.hurt(b.id,15,a.id);const dealt=before-b.hp;
  assert(Math.abs(a.experience-(199+dealt))<1e-9);assert.equal(soldierLevel(a.experience),2);
  assert.equal(a.hp,82);assert.equal(maxHealth(a.id,e.state),132);
  assert.deepEqual([effectiveFighterStats(a,2).attack,effectiveFighterStats(a,2).armor],[22.5,13]);
  b.experience=199;b.hp=20;c.hurt('farmer',2,b.id);assert.equal(b.experience,201);assert.equal(b.hp,27);
  b.hp=.25;const xp=a.experience;c.hurt(b.id,9999,a.id);assert.equal(a.experience,xp+.25);
  const unchanged=a.experience;c.hurt('archer',99,a.id);assert.equal(a.experience,unchanged);
  changeHealth(e.state,a.id,1000);assert.equal(a.hp,132);
  assert.equal(populationInfo(e.state).find(r=>r.id===a.id)!.progression!.level,2);
  assert.deepEqual(levels,[{id:a.id,level:2},{id:b.id,level:2}]);
  const restored=decodeEconomy(encodeEconomy(e)),next=new Combat(restored.state.combat,restored,()=>[]);
  next.setLevelFeedback(()=>assert.fail('loading an existing level must not replay the effect'));next.update(0);
});

test('maximum rank, fractional saves and effective-health validation apply to enemy cavalry too',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]),r=ENEMIES.find(r=>r.role==='cavalry')!,u=c.unit(r.id)!;
  assert.equal(u.hp,110);assert.equal(r.bodyRadius,.6);
  u.experience=599.75;u.hp=40;c.hurt('farmer',10,u.id);
  assert.equal(u.experience,600);assert.equal(u.hp,51);assert.equal(maxHealth(u.id,e.state),132);
  c.hurt('farmer',10,u.id);assert.equal(u.experience,600);
  u.hp=132;const loaded=decodeEconomy(encodeEconomy(e));assert.equal(loaded.state.combat.units.find(v=>v.id===u.id)!.hp,132);
  const saved=JSON.parse(encodeEconomy(e));saved.combat.units.find((v:{id:string})=>v.id===u.id).experience=0;
  assert.throws(()=>decodeEconomy(JSON.stringify(saved)),/战斗人物/);
  c.hurt(u.id,9999,'cavalry');assert.equal(u.life,'defeated');assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
  assert(ENEMIES.filter(r=>r.role==='cavalry').every(r=>!isBlocked(r.spawn,r.bodyRadius,economyObstacles([],[],[]))));
});

test('arrows award XP exactly once across reload, including a fallen shooter without resurrection',()=>{
  let e=new Economy(),c=new Combat(e.state.combat,e,()=>[]);const archer=c.unit('archer')!,target=c.unit('enemy-guard')!;
  archer.experience=199.5;archer.hp=0;archer.life='defeated';archer.diedAt=0;archer.order='hold';
  target.position={x:5,z:5};target.order='hold';
  c.state.projectiles.push({id:c.state.nextAttack++,source:archer.id,target:target.id,from:{x:5,z:3},to:{...target.position},elapsed:0,duration:.05,damage:14});
  e=decodeEconomy(encodeEconomy(e));c=new Combat(e.state.combat,e,()=>[]);c.setLevelFeedback(()=>assert.fail('a dead shooter must not play an upgrade effect'));c.update(.05);
  const xp=c.unit('archer')!.experience;assert(xp>200);assert.equal(c.unit('archer')!.hp,0);assert.equal(c.unit('archer')!.life,'defeated');
  e=decodeEconomy(encodeEconomy(e));c=new Combat(e.state.combat,e,()=>[]);c.update(.05);assert.equal(c.unit('archer')!.experience,xp);
});

test('enemy building damage grants only the remaining actual building health',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]),enemy=c.unit('enemy-guard')!;
  e.damageBuilding('warehouse',999.5);c.hurt('warehouse',999,enemy.id);assert.equal(enemy.experience,.5);
  assert.equal(fighterStats(enemy).hp,65);
});
