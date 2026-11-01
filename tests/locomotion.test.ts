import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { destinationSpeed, runReferenceSpeed, mountedRunReferenceSpeed } from '../src/game/locomotion.ts';
import { createRouteState, stepRoute } from '../src/game/route-following.ts';
import { COMBAT_CONFIG } from '../src/game/combat-config.ts';

test('gait reauthoring preserves every navigation step and arrival time at full and reduced stamina', () => {
  const bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
  for (const [wander, authored] of [[2.3, true], [2.2, true], [2.7, true], [3.2, true], [1.55, false]] as const) {
    for (const effort of [1, .65, .4]) {
      const originalSpeed = wander * (authored ? (5 / 3) / 1.15 : 2.1 / 1.15) * 1.5;
      const speeds = [originalSpeed, destinationSpeed(wander, authored)];
      const states = speeds.map(() => ({ position: { x: -10, z: 0 }, route: [{ x: 0, z: 2 }, { x: 10, z: 0 }], navigation: createRouteState() }));
      for (let i = 0; i < 1000 && states.some(s => s.route.length); i++) {
        const dt = i % 13 === 0 ? 0 : i % 7 === 0 ? .15 : .05;
        states.forEach((s, j) => { s.position = stepRoute('resident', s.position, s.route, s.navigation, dt, speeds[j] * effort, .4, bounds, [], []).position; });
        assert.deepEqual(states[0], states[1], `navigation changed at step ${i}`);
      }
      assert.equal(states[0].route.length, 0);
    }
  }
  assert.equal(destinationSpeed(2.3), 5);
  assert.deepEqual([COMBAT_CONFIG.infantry.speed, COMBAT_CONFIG.archer.speed, COMBAT_CONFIG.cavalry.speed], [4.6, 4.8, 6.96]);
});

test('exported run cycles fit current gameplay speeds and keep all four loop seams continuous', () => {
  const bytes = readFileSync(new URL('../studies/characters/characters.glb', import.meta.url));
  const length = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = bytes.subarray(28 + length);
  function values(id: number) {
    const a = gltf.accessors[id], v = gltf.bufferViews[a.bufferView];
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), width = a.type === 'VEC4' ? 4 : a.type === 'VEC3' ? 3 : 1;
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) => binary.readFloatLE(start + (i * width + j) * 4)));
  }
  for (const name of ['Run', 'CarryRun', 'RideRun', 'HorseRideRun']) {
    const clip = gltf.animations.find((a: { name: string }) => a.name === name); assert.ok(clip);
    for (const track of clip.samplers) {
      const times = values(track.input), poses = values(track.output);
      assert.ok(Math.abs(times.at(-1)![0] - .34) < 1e-6);
      poses[0].forEach((v, j) => assert.ok(Math.abs(v - poses.at(-1)![j]) < 1e-6));
      assert.ok(poses.every(row => row.every(Number.isFinite)));
    }
  }
  for (const speed of [5, 4.6, 4.8]) assert.ok(.34 / (speed / runReferenceSpeed) >= .3 && .34 / (speed / runReferenceSpeed) <= .4);
  assert.equal(.34 / (COMBAT_CONFIG.cavalry.speed / mountedRunReferenceSpeed), .34);
});
