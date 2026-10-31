import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { createShadowCasterFilter } from '../src/game/shadow-culling.ts';

test('offscreen casters whose shadows enter the view survive; moving bounds and skinning remain safe', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const planes = [new Plane(1, 0, 0, 2), new Plane(-1, 0, 0, 2), new Plane(0, 1, 0, 2),
      new Plane(0, -1, 0, 2), new Plane(0, 0, 1, 10), new Plane(0, 0, -1, 10)];
    const caster = MeshBuilder.CreateBox('offscreen', { size: 1 }, scene);
    caster.position.set(-5, 5, 0); caster.computeWorldMatrix(true);
    const filter = createShadowCasterFilter(new Vector3(1, -1, 0));
    assert.equal(caster.isInFrustum(planes), false);
    assert.deepEqual(filter([caster], 1, planes).map(mesh => mesh.name), ['offscreen'], 'its projected shadow crosses the view');
    caster.position.set(6, 1, 0); scene.incrementRenderId();
    assert.deepEqual(filter([caster], 1, planes).map(mesh => mesh.name), [], 'body and shadow are both outside');
    caster.position.set(0, 1, 0); scene.incrementRenderId();
    assert.deepEqual(filter([caster], 1, planes).map(mesh => mesh.name), ['offscreen'], 'changed world matrix invalidates cached bounds');
    caster.position.set(20, 1, 0); caster.skeleton = new Skeleton('rig', 'rig', scene);
    assert.deepEqual(filter([caster], 1, planes).map(mesh => mesh.name), ['offscreen'], 'bind-pose bounds cannot cull animated meshes');
  } finally { scene.dispose(); engine.dispose(); }
});
