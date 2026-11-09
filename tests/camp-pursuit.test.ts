import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, fighterStats } from '../src/game/combat.ts';
import { COMBAT_CONFIG as C, ENCOUNTERS } from '../src/game/combat-config.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { ENEMIES } from '../src/game/resident-data.ts';

function duel(id='enemy-guard'){
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  for(const u of e.state.combat.units){u.life='defeated';u.hp=0;u.diedAt=0;}
  const c=new Combat(e.state.combat,e,()=>[]),guard=c.unit(id)!,target=c.unit('infantry')!;
  for(const u of [guard,target]){u.life='active';u.hp=fighterStats(u).hp;u.diedAt=undefined;}
  const camp=ENCOUNTERS.find(c=>c.id===ENEMIES.find(u=>u.id===id)!.camp)!,leash=Math.max(C.chase,camp.leash);
  guard.position={x:camp.x,z:camp.z};guard.target=target.id;
  target.position={x:camp.x+leash+4,z:camp.z};target.cooldown=8;
  const step=(seconds=.05)=>{
    // Stationary opponent isolates guard policy from the player's own auto AI.
    target.order='move';target.goal=undefined;target.route=[];target.target=undefined;target.attack=undefined;
    e.state.seconds+=seconds;c.update(seconds);
  };
  return {e,c,guard,target,camp,leash,step};
}

test('melee, ranged and mounted camp guards keep fighting close opponents across the original boundary',()=>{
  for(const id of ['enemy-guard','enemy-archer',ENEMIES.find(u=>u.role==='cavalry')!.id]){
    const {guard,target,camp,leash,step}=duel(id);
    guard.position={x:camp.x+leash+.2,z:camp.z};target.position={x:guard.position.x+(guard.role==='infantry'?1.4:2),z:camp.z};
    const hp=target.hp;
    for(let i=0;i<22;i++){step();assert.equal(guard.order,'guard');assert.equal(guard.target,target.id);}
    assert(target.hp<hp,`${id} actually deals damage beyond its old boundary`);
    assert.equal(guard.goal,undefined);
  }
});

test('buffer pursuit waits three quiet seconds, preserves the timer on pause/reload, and validates it',()=>{
  const {e,guard,step}=duel();for(let i=0;i<22;i++)step();
  assert(guard.pursuitQuiet!>1);assert.equal(guard.order,'guard');
  const saved=encodeEconomy(e),restored=decodeEconomy(saved),c=new Combat(restored.state.combat,restored,()=>[]);
  const u=c.unit(guard.id)!;assert.equal(u.pursuitQuiet,guard.pursuitQuiet);
  const target=c.unit('infantry')!;
  const resumedStep=()=>{
    // Restore the same stationary-opponent fixture after loading, so the
    // player's automatic AI cannot approach and restart close combat.
    target.order='move';target.goal=undefined;target.route=[];target.target=undefined;target.attack=undefined;
    restored.state.seconds+=.05;c.update(.05);
  };
  const frozen=encodeEconomy(restored);c.update(0);assert.equal(encodeEconomy(restored),frozen);
  for(let i=0;i<36;i++)resumedStep();
  assert.equal(u.order,'guard');
  for(let i=0;i<3;i++)resumedStep();
  assert.equal(u.order,'hold');assert.deepEqual(u.goal,u.home);assert.equal(u.target,undefined);
  const bad=JSON.parse(saved);bad.combat.units.find((u:{id:string})=>u.id===guard.id).pursuitQuiet=4;
  assert.throws(()=>decodeEconomy(JSON.stringify(bad)),/战斗人物/);
});

test('taking fresh damage renews the grace period without moving the camp anchor',()=>{
  const {c,guard,target,camp,step}=duel();for(let i=0;i<20;i++)step();
  c.hurt(guard.id,1,target.id);assert.equal(guard.pursuitQuiet,0);
  for(let i=0;i<58;i++)step();assert.equal(guard.order,'guard');
  step();step();assert.equal(guard.order,'hold',JSON.stringify({quiet:guard.pursuitQuiet,position:guard.position,target:target.position}));assert.deepEqual(guard.goal,guard.home);
  assert(Math.hypot(guard.home.x-camp.x,guard.home.z-camp.z)<4);
});

test('hard limit starts a persistent return; a nearby attacker is hit without outward pursuit',()=>{
  const {e,c,guard,target,camp,leash,step}=duel();
  guard.position={x:camp.x+leash+C.campPursuit.buffer-.1,z:camp.z};target.position={x:guard.position.x+1.2,z:camp.z};
  step();assert.equal(guard.order,'hold');const goal={...guard.goal!},start={...guard.position},hp=target.hp;
  for(let i=0;i<14;i++){step();assert.equal(guard.order,'hold');assert.deepEqual(guard.goal,goal);assert(guard.position.x<=start.x+1e-6);}
  assert(target.hp<hp,'returning guard can defend itself at the outer limit');
  const saved=decodeEconomy(encodeEconomy(e)).state.combat.units.find(u=>u.id===guard.id)!;
  assert.equal(saved.order,'hold');assert.deepEqual(saved.goal,goal);
  target.position.x+=8;for(let i=0;i<30;i++)step();
  assert(guard.position.x<start.x-1);assert.equal(guard.target,undefined);
  assert.equal(c.unit(guard.id),guard);
});

test('a returning guard keeps walking when a nearby runner will leave reach before contact',()=>{
  const {guard,target,camp,leash,step}=duel();
  guard.position={x:camp.x+leash+4,z:camp.z};guard.order='hold';guard.goal={...guard.home};guard.target=undefined;guard.cooldown=.1;
  target.position={x:guard.position.x+1.2,z:camp.z};step();
  const before={...guard.position};target.position.x+=.225;step();
  assert.equal(guard.attack,undefined);assert(guard.position.x<before.x);
  assert.equal(guard.order,'hold');assert.deepEqual(guard.goal,guard.home);
});
