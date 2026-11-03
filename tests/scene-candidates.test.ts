import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { createSceneCandidates } from '../src/game/scene-candidates.ts';

test('native octree follows camera, moving children, LOD and static object lifecycles', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, .76, 80, Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.orthoTop = camera.orthoRight = 8; camera.orthoBottom = camera.orthoLeft = -8;
    for (let i = 0; i < 300; i++) { const m = MeshBuilder.CreateBox('static-' + i, {}, scene); m.position.set(i % 30 * 4 - 60, 0, Math.floor(i / 30) * 4 - 20); m.freezeWorldMatrix(); }
    const root = new TransformNode('moving-root', scene), moving = MeshBuilder.CreateBox('moving', {}, scene); moving.parent = root;
    const near = MeshBuilder.CreateSphere('near', {}, scene), far = MeshBuilder.CreateBox('lod', {}, scene); near.addLODLevel(20, far);
    const index = createSceneCandidates(scene);
    const compare = () => {
      scene.render(); const selected = scene.getActiveMeshCandidates(); const candidates = selected.data.slice(0, selected.length);
      for (const m of scene.meshes) if (!m.isBlocked && m.isVisible && m.isEnabled() && m.isInFrustum(scene.frustumPlanes)) assert.ok(candidates.includes(m), 'visible mesh omitted: ' + m.name);
      assert.ok(!candidates.includes(far), 'LOD proxy must not render independently');
      assert.ok(candidates.includes(moving), 'moving content cannot be culled by stale static bounds');
      return candidates;
    };
    assert.ok(compare().length < 180);
    root.position.x = camera.target.x = 40; compare();
    const added = MeshBuilder.CreateBox('built-house', {}, scene); added.position.x = 40; added.freezeWorldMatrix();
    assert.ok(compare().includes(added)); added.dispose(); assert.ok(!compare().includes(added));
    camera.target.x = -40; root.position.x = -40; compare();
    assert.equal(index.snapshot().rebuilds, 3);
    index.dispose();
  } finally { scene.dispose(); engine.dispose(); }
});
