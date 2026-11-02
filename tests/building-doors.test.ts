import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { createBuildingDoors } from '../src/game/building-doors.ts';
import type { Palette } from '../src/game/models.ts';

test('native door motion preserves its hinge, handles repeated visitors and freezes with game time', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const p = { sage: new StandardMaterial('teal', scene), golden: new StandardMaterial('brass', scene) } as Palette;
    const doors = createBuildingDoors(scene, p);
    doors.add({ id: 'home', x: 0, z: 0, depth: 3 });
    doors.add({ id: 'warehouse', x: 8, z: 0, depth: 3 }, true);
    doors.add({ id: 'site-0', x: 20, z: 0, depth: 3 }, true);
    doors.useWarehouse({ x: 19, z: -2 }); doors.update(.2);
    const open = doors.snapshot().find(d => d.id === 'site-0')!;
    assert(open.angle < 0); assert.equal(doors.snapshot().find(d => d.id === 'warehouse')!.angle, 0);
    const leaf = scene.getMeshByName('site-0-door-leaf')!, knob = scene.getMeshByName('site-0-door-knob')!;
    leaf.computeWorldMatrix(true);
    assert(leaf.getAbsolutePosition().z > -1.5, 'leaf opens inside the front wall');
    assert.equal(leaf.parent, knob.parent); assert.equal(leaf.metadata.worldObjectId, 'site-0');
    doors.update(0); assert.deepEqual(doors.snapshot().find(d => d.id === 'site-0'), open);
    doors.update(1.1); const closing = doors.snapshot().find(d => d.id === 'site-0')!.angle;
    doors.use('site-0'); assert(Math.abs(doors.snapshot().find(d => d.id === 'site-0')!.angle - closing) < 1e-6);
    doors.update(.2); assert(doors.snapshot().find(d => d.id === 'site-0')!.angle <= closing);
    doors.update(2); assert.equal(doors.snapshot().find(d => d.id === 'site-0')!.angle, 0);
    doors.remove('site-0'); assert.equal(scene.getMeshByName('site-0-door-leaf'), null);
  } finally { scene.dispose(); engine.dispose(); }
});
