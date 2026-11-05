import test from 'node:test';
import { execFileSync } from 'node:child_process';

// A separate process makes the compile-time opening selection explicit; the
// rest of the existing logic suite continues to exercise the standard game.
test('map development starts clean, stays peaceful, and supports building, recruitment and reload', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { BUILDINGS, WAREHOUSE, createLandGrid } from './src/game/world-data.ts';
    import { RESIDENTS, ENEMIES } from './src/game/resident-data.ts';
    import { FARM_PLOTS } from './src/game/economy-config.ts';
    import { Economy, encodeEconomy, decodeEconomy } from './src/game/economy.ts';
    import { Combat } from './src/game/combat.ts';
    import { Raids } from './src/game/raids.ts';
    import { homeResidents, recruit, advanceRecruitment } from './src/game/recruitment.ts';
    import { buildingOperational } from './src/game/building-state.ts';
    const e = new Economy();
    assert.deepEqual(BUILDINGS.map(b => b.id), ['home-center']);
    assert.deepEqual(RESIDENTS.map(r => r.id), ['farmer', 'farmer-2', 'farmer-leader']);
    assert.equal(RESIDENTS.find(r => r.id === 'farmer-leader').effects[0], 'leader');
    assert.equal(ENEMIES.length, 0);
    assert.equal(FARM_PLOTS.length, 0);
    assert.equal(createLandGrid().some(c => c.type === 'garden'), false);
    assert.equal(buildingOperational(e.state, 'warehouse'), false);
    assert.equal(e.state.steward.enabled, false);
    assert.deepEqual(Object.keys(e.state.vitals), RESIDENTS.map(r => r.id));
    const combat = new Combat(e.state.combat, e, () => []);
    const people = { status: id => ({ position: RESIDENTS.find(r => r.id === id).spawn, moving: false }),
      command: () => false, release() {}, resting() {}, neighbours: () => [] };
    const raids = new Raids(e, combat, people, () => [], () => false);
    for (const seconds of [60, 600, 3600, 86400]) {
      e.state.seconds = seconds; raids.update(.25); combat.update(.25);
    }
    assert.equal(combat.state.units.length, 0);
    assert.equal(raids.wolves.length, 0);
    assert.equal(raids.state.wave, 0);
    assert.equal(raids.state.pendingCount, 0);
    assert.equal(e.state.goods.length, 0);
    assert.equal(e.state.tasks.length, 0);
    const fresh = new Economy();
    const result = fresh.placeBuilding('warehouse', WAREHOUSE);
    assert.equal(result.ok, true, result.message);
    assert.ok(result.task);
    fresh.assign(result.task.id, 'farmer'); fresh.arrive(result.task.id); fresh.advance(120);
    assert.equal(result.task.status, 'done');
    assert.equal(buildingOperational(fresh.state, result.task.target), true);
    assert.equal(recruit(fresh, 'archer').ok, true);
    const archer = advanceRecruitment(fresh, 20);
    assert.equal(archer.role, 'archer');
    assert.equal(archer.bodyRadius, .4);
    const loaded = decodeEconomy(encodeEconomy(fresh));
    assert.equal(loaded.state.opening, 'map-development');
    assert.equal(homeResidents(loaded.state).length, 4);
    assert.equal(loaded.state.raids.wildWolves.length, 0);
    const wrongProfile = JSON.parse(encodeEconomy(fresh)); wrongProfile.opening = 'standard';
    assert.throws(() => decodeEconomy(JSON.stringify(wrongProfile)), /开局配置/);
  `], { cwd: new URL('..', import.meta.url), env: { ...process.env, VITE_MAP_DEVELOPMENT: 'true' }, timeout: 30000, stdio: 'pipe' });
});
