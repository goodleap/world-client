import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { buildingInfo } from '../src/game/building-state.ts';
import { newWolf } from '../src/game/raid-state.ts';
import type { DamageNumber } from '../src/game/damage-numbers.ts';

test('damage feedback reports only actual health loss after armor, including lethal hits, civilians, wolves and buildings',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]),hits:DamageNumber[]=[];
  c.setDamageFeedback(hit=>hits.push(hit));
  c.hurt('infantry',30,'archer');assert.equal(hits.length,0);
  const u=c.unit('infantry')!,hp=u.hp;c.hurt(u.id,30,'enemy-guard');assert.equal(hits.at(-1)!.amount,hp-u.hp);assert.equal(hits.at(-1)!.team,'home');
  u.hp=2.5;c.hurt(u.id,10000,'enemy-guard');assert.equal(hits.at(-1)!.amount,2.5);
  const count=hits.length;c.hurt(u.id,10000,'enemy-guard');assert.equal(hits.length,count);
  const farmer=e.state.vitals.farmer.hp!;c.hurt('farmer',8,'enemy-guard');assert.equal(hits.at(-1)!.amount,farmer-e.state.vitals.farmer.hp!);
  const wolf=newWolf('wolf-1-0',{x:3,z:2});c.setThreats([wolf]);c.hurt(wolf.id,12,'archer');assert.equal(hits.at(-1)!.amount,75-wolf.hp);assert.equal(hits.at(-1)!.team,'enemy');
  const before=buildingInfo(e.state,'warehouse')!.hp;c.hurt('warehouse',30,'enemy-guard');assert.equal(hits.at(-1)!.amount,before-buildingInfo(e.state,'warehouse')!.hp);
  assert.equal(hits.at(-1)!.target,'warehouse');
});
