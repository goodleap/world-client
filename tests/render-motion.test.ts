import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { RenderMotion, interpolateAngle, interpolateCycle } from '../src/game/render-motion.ts';
import { SimulationClock } from '../src/game/simulation-clock.ts';
import { stepRoute, createRouteState } from '../src/game/route-following.ts';

test('20 Hz movement renders every 60 Hz frame while gameplay and saves retain exact authoritative positions', () => {
  const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('unit', scene);
  try {
    root.position.set(12, 0, -7); const motion = new RenderMotion(root), clock = new SimulationClock();
    let steps = 0, changed = 0, previous = motion.position.x;
    for (let frame = 0; frame < 120; frame++) {
      clock.advance(1 / 60, dt => { motion.beginStep(); root.position.x += 3 * dt; motion.endStep(); steps++; });
      motion.sample(clock.alpha); root.computeWorldMatrix(true);
      assert.ok(Math.abs(root.position.x - (12 + steps * .15)) < 1e-8);
      assert.ok(Vector3.Distance(root.getAbsolutePosition(), motion.position) < 1e-5);
      assert.ok(motion.position.x <= root.position.x + 1e-8 && root.position.x - motion.position.x <= .15 + 1e-8);
      if (frame > 3) { assert.ok(Math.abs(motion.position.x - previous - .05) < 1e-8); changed++; }
      previous = motion.position.x;
    }
    assert.equal(steps, 40); assert.equal(changed, 116);
    const frozen = motion.position.clone(); for (let i = 0; i < 5; i++) motion.sample(clock.alpha);
    assert.ok(Vector3.Distance(motion.position, frozen) < 1e-9);
    root.position.set(-20, 0, 8); motion.reset(); motion.sample(.3); root.computeWorldMatrix(true);
    assert.ok(Vector3.Distance(root.getAbsolutePosition(), root.position) < 1e-5, 'load/teleport reset has no interpolation tail');
  } finally { scene.dispose(); engine.dispose(); }
});

test('turns use shortest quaternion arc without orbiting a nonzero position or changing tower elevation', () => {
  const engine = new NullEngine(), scene = new Scene(engine), elevation = new TransformNode('tower', scene), root = new TransformNode('archer', scene);
  try {
    elevation.position.y = 4; root.parent = elevation; root.position.set(10, 0, -6);
    root.rotationQuaternion = Quaternion.RotationYawPitchRoll(3, 0, 0);
    const motion = new RenderMotion(root); motion.beginStep(); root.position.x = 11;
    root.rotationQuaternion.copyFrom(Quaternion.RotationYawPitchRoll(-3, 0, 0)); motion.endStep(); motion.sample(.5);
    root.computeWorldMatrix(true); const position = root.getAbsolutePosition(), rotation = Quaternion.Identity();
    root.getWorldMatrix().decompose(undefined, rotation);
    assert.ok(Vector3.Distance(position, new Vector3(10.5, 4, -6)) < 1e-5);
    assert.ok(Math.abs(Quaternion.Dot(rotation, motion.rotation)) > .99999);
    assert.equal(root.position.x, 11);
    assert.ok(Math.abs(interpolateAngle(3, -3, .5) - Math.PI) < 1e-8);
    assert.ok(Math.abs(interpolateCycle(.98, .04, .5) - .01) < 1e-8);
  } finally { scene.dispose(); engine.dispose(); }
});

test('a completed multi-leg step renders through its corner without cutting or slowing the gait', () => {
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('farmer',scene);
  try {
    const motion=new RenderMotion(root),route=[{x:.01,z:0},{x:.01,z:4}],navigation=createRouteState();
    const step=stepRoute('farmer',{x:0,z:0},route,navigation,.05,5,.29,{minX:-5,maxX:5,minZ:-5,maxZ:5},[],[]);
    assert(Math.abs(step.distance-.25)<1e-8);
    motion.beginStep();root.position.set(step.position.x,0,step.position.z);motion.endStep(step.path);
    motion.sample(.02);assert(Math.abs(motion.position.x-.005)<1e-8);assert.equal(motion.position.z,0);
    motion.sample(.5);assert(Math.abs(motion.position.x-.01)<1e-8);assert(Math.abs(motion.position.z-.115)<1e-8);
    root.computeWorldMatrix(true);assert(Vector3.Distance(root.getAbsolutePosition(),motion.position)<1e-7);
    motion.beginStep();motion.endStep(step.path);motion.sample(.5);
    assert(Vector3.Distance(motion.position,root.position)<1e-8,'a stopped unit must not replay the last moving trace');
  } finally {scene.dispose();engine.dispose();}
});
