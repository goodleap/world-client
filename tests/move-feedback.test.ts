import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createMoveFeedback } from '../src/game/move-feedback.ts';

test('destination feedback shares the pause clock, replaces the old target and expires without intercepting picks', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    scene.useConstantAnimationDeltaTime = true;
    const feedback = createMoveFeedback(scene);
    feedback.show({ x: 2, z: 3 });
    for (let i = 0; i < 10; i++) scene.animate();
    scene.animationsEnabled = false;
    for (let i = 0; i < 100; i++) scene.animate();
    assert.equal(feedback.snapshot().visible, true);
    feedback.show({ x: -1, z: 4 });
    assert.deepEqual(feedback.snapshot(), { visible: true, x: -1, z: 4 });
    assert.ok(scene.meshes.every(mesh => !mesh.isPickable));
    scene.animationsEnabled = true;
    for (let i = 0; i < 55; i++) scene.animate();
    assert.equal(feedback.snapshot().visible, false);
    assert.equal(scene.animationGroups[0].isPlaying, false);
  } finally { scene.dispose(); engine.dispose(); }
});
