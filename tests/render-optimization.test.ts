import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Bone } from '@babylonjs/core/Bones/bone.js';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { AnimationVisibility } from '../src/game/animation-visibility.ts';
import { rigEnvelope } from '../src/game/rig-envelope.ts';
import { createShadowCasterFilter } from '../src/game/shadow-culling.ts';

test('screen-hidden visual clips retain phase, changing speed and zero game delta; external pauses remain paused', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const target = new TransformNode('animated', scene);
    const track = new Animation('walk', 'position.x', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    track.setKeys([{ frame: 0, value: 0 }, { frame: 60, value: 1 }]);
    const group = new AnimationGroup('walk', scene); group.addTargetedAnimation(track, target);
    group.start(true); group.goToFrame(12);
    const scheduler = new AnimationVisibility();
    scheduler.update(group, false, .2); assert.equal(group.isPlaying, false);
    group.speedRatio = 2; scheduler.update(group, false, .1); scheduler.update(group, false, 0);
    scheduler.update(group, true, 0);
    assert.equal(group.isPlaying, true); assert.ok(Math.abs(target.position.x - .6) < 1e-6);
    group.pause(); scheduler.update(group, false, 1); scheduler.update(group, true, 0);
    assert.equal(group.isPlaying, false, 'attack poses and explicit pauses must not be resumed');
    group.stop(); scheduler.reset(group); group.speedRatio = 1; group.start(true); group.goToFrame(0);
    scheduler.update(group, false, .1); scheduler.update(group, true, 0);
    assert.ok(Math.abs(target.position.x - .1) < 1e-6, 'a new command starts a new clip instead of inheriting an old hidden phase');
  } finally { scene.dispose(); engine.dispose(); }
});

test('rig envelope contains animated translation, rotation and scale; offscreen skin shadows can be culled', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const root = new TransformNode('actor', scene), joint = new TransformNode('joint', scene);
    joint.parent = root; joint.position.y = 1; joint.rotationQuaternion = Quaternion.Identity();
    const skeleton = new Skeleton('rig', 'rig', scene);
    const bone = new Bone('joint', skeleton, null, Matrix.Translation(0, 1, 0)); bone.linkTransformNode(joint);
    const mesh = MeshBuilder.CreateBox('body', { size: 1 }, scene); mesh.parent = root; mesh.skeleton = skeleton;
    mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, new Float32Array(mesh.getTotalVertices() * 4));
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, Array.from({ length: mesh.getTotalVertices() }, () => [1, 0, 0, 0]).flat());
    const group = new AnimationGroup('reach', scene);
    const move = new Animation('reach', 'position', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
    move.setKeys([{ frame: 0, value: new Vector3(0, 1, 0) }, { frame: 60, value: new Vector3(2, 3, 0) }]); group.addTargetedAnimation(move, joint);
    const scaling = new Animation('stretch', 'scaling', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
    scaling.setKeys([{ frame: 0, value: Vector3.One() }, { frame: 60, value: new Vector3(2, 3, 1) }]); group.addTargetedAnimation(scaling, joint);
    const envelope = rigEnvelope([mesh], root); assert.ok(envelope);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20; joint.position.set(2 * t, 1 + 2 * t, 0); joint.scaling.set(1 + t, 1 + 2 * t, 1);
      joint.rotationQuaternion = Quaternion.RotationYawPitchRoll(t * 7, t * 8, t * 9);
      joint.computeWorldMatrix(true); scene.incrementRenderId(); skeleton.prepare(true);
      const posed = mesh.getPositionData(true)!;
      for (let j = 0; j < posed.length; j += 3) assert.ok(Math.hypot(posed[j], posed[j + 1], posed[j + 2]) <= envelope.radius);
    }
    mesh.metadata = { rigEnvelope: envelope };
    const planes = [new Plane(1, 0, 0, 3), new Plane(-1, 0, 0, 3), new Plane(0, 1, 0, 3), new Plane(0, -1, 0, 3), new Plane(0, 0, 1, 3), new Plane(0, 0, -1, 3)];
    const filter = createShadowCasterFilter(new Vector3(1, -1, 0));
    assert.equal(filter([mesh], 1, planes).length, 1);
    root.position.set(50, 0, 0); scene.incrementRenderId(); assert.equal(filter([mesh], 1, planes).length, 0);
    root.position.set(0, 0, 0); scene.incrementRenderId(); assert.equal(filter([mesh], 1, planes).length, 1);
  } finally { scene.dispose(); engine.dispose(); }
});
