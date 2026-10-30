import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { Bone } from '@babylonjs/core/Bones/bone.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { createDogRun } from '../src/game/dog-run.ts';

test('the native dog run loops and pauses at the current pose without changing the bind skeleton', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const skeleton = new Skeleton('dog', 'dog', scene);
    const body = new Bone('body', skeleton, null, Matrix.Identity());
    const legs = [-1, 1, -1, 1].map((side, index) => new Bone(`leg-${index}`, skeleton, body, Matrix.Translation(side * .17, .52, index < 2 ? .3 : -.3)));
    const bind = skeleton.bones.map(bone => bone.getBindMatrix().asArray().slice());
    const { group, referenceSpeed } = createDogRun(scene, body, legs);
    let loops = 0; group.onAnimationGroupLoopObservable.add(() => loops++);
    scene.useConstantAnimationDeltaTime = true;
    group.start(true, 4 / referenceSpeed);
    for (let i = 0; i < 6; i++) scene.animate();
    assert.ok(body.position.y > 0);
    const pose = skeleton.bones.map(bone => bone.getLocalMatrix().asArray().slice());
    scene.animationsEnabled = false;
    for (let i = 0; i < 10; i++) scene.animate();
    assert.deepEqual(skeleton.bones.map(bone => bone.getLocalMatrix().asArray().slice()), pose);
    scene.animationsEnabled = true;
    for (let i = 0; i < 30; i++) scene.animate();
    assert.ok(loops >= 2);
    group.stop(); assert.equal(group.isPlaying, false);
    assert.deepEqual(skeleton.bones.map(bone => bone.getBindMatrix().asArray().slice()), bind);
  } finally { scene.dispose(); engine.dispose(); }
});
