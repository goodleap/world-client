import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { changeHealth, eat, needsFood } from '../src/game/vitals.ts';
import { livingPopulation, formatGameTime } from '../src/game/home-status.ts';
test('lethal damage stops a soldier, clears meals and prevents commands or healing across reload', () => {
 const e = new Economy(), c = new Combat(e.state.combat, e, () => []), u = c.unit('cavalry')!;
 const population = livingPopulation(e.state);
 e.state.vitals.cavalry.meal = { remaining: 4 }; e.state.vitals.horse.meal = { remaining: 3 };
 c.move([u.id], { x: 12, z: 10 }); c.hurt(u.id, 10000, 'enemy-guard');
 assert.equal(u.life, 'defeated'); assert.equal(u.hp, 0); assert.equal(u.speed, 0); assert.deepEqual(u.route, []);
 assert.equal(c.move([u.id], {x:0,z:0}), 0); assert.equal(c.attack([u.id], 'enemy-guard'), 0);
 assert(!u.goal && !u.target && !u.attack); assert(!e.state.vitals.cavalry.meal && !e.state.vitals.horse.meal);
 changeHealth(e.state, u.id, 100); eat(e.state, u.id, 6); assert.equal(u.hp, 0); assert(!needsFood(e.state, u.id));
 assert.equal(livingPopulation(e.state), population - 1);
 const restored = decodeEconomy(encodeEconomy(e)); changeHealth(restored.state, u.id, 100);
 assert.equal(restored.state.combat.units.find(v=>v.id===u.id)!.hp, 0); assert.equal(livingPopulation(restored.state), 5);
});
test('legacy wounded save migrates to death without reviving and game clock formats boundaries', () => {
 const e = new Economy(), raw = JSON.parse(encodeEconomy(e));
 Object.assign(raw.combat.units[0], { life:'injured', hp:0 });
 const restored = decodeEconomy(JSON.stringify(raw)); assert.equal(restored.state.combat.units[0].life, 'defeated');
 assert.deepEqual([0,754,3599,3600,4354].map(formatGameTime), ['00:00','12:34','59:59','01:00:00','01:12:34']);
});
