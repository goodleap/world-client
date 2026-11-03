import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat, fighterStats } from '../src/game/combat.ts';
import { bodiesFor, health } from '../src/game/vitals.ts';
import { newWolf } from '../src/game/raid-state.ts';

test('proportional armor retains fractional damage for either team, wolves and unarmored residents',()=>{
  const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]),wolf=newWolf('wolf-1-0',{x:0,z:0});
  c.setThreats([wolf]);
  for(const [id,hp,attack,armor] of [['infantry',120,15,10],['archer',110,14,8],['cavalry',130,16,12]] as const){
    const u=c.unit(id)!;assert.deepEqual([u.hp,fighterStats(u).attack,fighterStats(u).armor],[hp,attack,armor]);
  }
  const hit=(id:string,attack:number,source:string,expected:number)=>{
    const before=c.target(id)!.hp;c.hurt(id,attack,source);assert(Math.abs(before-c.target(id)!.hp-expected)<1e-9);
  };
  hit('infantry',15,'enemy-guard',10); // 10 defense removes one third.
  hit('archer',14,'enemy-guard',10); // 8 defense removes 2/7.
  hit('cavalry',16,'enemy-guard',10); // 12 defense removes 3/8.
  hit('enemy-guard',15,'infantry',150/11);
  hit(wolf.id,15,'infantry',100/7);
  hit('farmer',8,wolf.id,8);hit('dog',8,wolf.id,8);
  hit('enemy-guard',.1,'infantry',1);
  e.state.upgrades.arms=3;hit('infantry',12,'enemy-guard',80/11);
  const hp=health(e.state,'infantry');c.hurt('infantry',20,'archer');assert.equal(health(e.state,'infantry'),hp);
  c.setThreats([]);assert.equal(health(decodeEconomy(encodeEconomy(e)).state,'infantry'),hp);
});

test('zero stamina leaves soldier and mount movement identical to full stamina',()=>{
  for(const id of ['infantry','archer','cavalry']){
    const run=(stamina:number)=>{
      const e=new Economy(),c=new Combat(e.state.combat,e,()=>[]);
      for(const u of c.state.units){u.position={x:45,z:45};u.order='hold';}
      const u=c.unit(id)!;u.position={x:0,z:0};
      for(const body of bodiesFor(id))e.state.vitals[body].stamina=stamina;
      assert.equal(c.move([id],{x:8,z:0}),1);
      for(let i=0;i<20;i++)c.update(.05);
      return {position:u.position,speed:u.speed};
    };
    assert.deepEqual(run(0),run(100),id);
  }
});

test('zero stamina leaves gathering and upgraded work progress unchanged',()=>{
  for(const tools of [0,2]){
    const run=(stamina:number)=>{
      const e=new Economy();e.setLeadership(false);e.state.upgrades.tools=tools;e.state.vitals.farmer.stamina=stamina;
      e.request('chop','tree-0');const task=e.claim()!;e.arrive(task.id);
      e.advance(1);const progress=task.progress;e.advance(10);
      assert.equal(task.status,'done');return {progress,goods:e.state.goods};
    };
    assert.deepEqual(run(0),run(100));
  }
});
