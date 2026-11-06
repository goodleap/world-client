import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, fighterStats } from '../src/game/combat.ts';
import { COMBAT_CONFIG, OUTPOST } from '../src/game/combat-config.ts';
import { Economy } from '../src/game/economy.ts';
import type { Obstacle } from '../src/game/movement.ts';

function encounter(role='infantry',gap=11.5){
  const economy=new Economy();economy.setLeadership(false);
  for(const u of economy.state.combat.units){u.life='defeated';u.hp=0;u.diedAt=0;}
  const solids:Obstacle[]=[],combat=new Combat(economy.state.combat,economy,()=>solids);
  const home=combat.unit(role)!,enemy=combat.unit('enemy-guard')!;
  for(const u of [home,enemy]){u.life='active';u.hp=fighterStats(u).hp;u.diedAt=undefined;u.order='guard';}
  home.position={x:0,z:0};enemy.position={x:gap,z:0};
  // Hold the opponent still to isolate the home soldier's acquisition.
  enemy.order='move';
  const step=()=>{economy.state.seconds+=.05;combat.update(.05);};
  return {combat,home,enemy,solids,step};
}

test('home infantry, archers and cavalry notice enemies up to 12 units away without extending weapon reach',()=>{
  for(const role of ['infantry','archer','cavalry'])for(const gap of [11.5,12.2]){
    const {home,enemy,step}=encounter(role,gap);step();
    assert.equal(home.target,gap<12?enemy.id:undefined,`${role} at ${gap}`);
    assert.equal(home.attack,undefined,'not yet within actual weapon reach');
    assert.equal(enemy.hp,fighterStats(enemy).hp);
  }
});

test('expanded home alert preserves cover, explicit movement and the 14-unit pursuit limit',()=>{
  for(const role of ['infantry','archer','cavalry']){
    const covered=encounter(role);
    covered.solids.push({kind:'box',x:5,z:0,halfWidth:1,halfDepth:3});covered.step();
    assert.equal(covered.home.target,undefined,'no acquisition through cover');
    const commanded=encounter(role);
    assert(commanded.combat.move([role],{x:-5,z:0})>0);commanded.step();
    assert.equal(commanded.home.order,'move');assert.equal(commanded.home.target,undefined);
    const pursuing=encounter(role);pursuing.step();
    assert.equal(pursuing.home.target,pursuing.enemy.id);
    pursuing.enemy.position={x:COMBAT_CONFIG.chase+1,z:0};pursuing.step();
    assert.equal(pursuing.home.target,undefined);assert.equal(pursuing.home.order,'hold');
    assert.deepEqual(pursuing.home.goal,{x:0,z:0});
  }
});

test('enemy passive acquisition stays at 8 units',()=>{
  for(const gap of [7.5,8.5]){
    const {home,enemy,step}=encounter();
    enemy.position={x:OUTPOST.x,z:OUTPOST.z};enemy.order='guard';
    home.position={x:OUTPOST.x+gap,z:OUTPOST.z};home.order='move';
    step();assert.equal(enemy.target,gap<8?home.id:undefined);
  }
});
