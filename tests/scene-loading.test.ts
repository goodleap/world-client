import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { prepareScene } from '../src/game/scene-loading.ts';

test('scene warmup respects Babylon non-blocking texture readiness', async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const optional = new Texture(null, scene); optional.isBlocking = false;
    assert.equal(optional.isReady(), false);
    assert.equal(scene.isReady(), true);
    let progress = 0;
    await prepareScene(scene, (ready, total) => { progress = ready / total; });
    assert.equal(progress, 1, 'optional texture cannot keep a ready scene on the loading screen');
  } finally { scene.dispose(); engine.dispose(); }
});
