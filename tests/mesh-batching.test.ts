import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { Bone } from '@babylonjs/core/Bones/bone.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { batchSkinnedMeshes } from '../src/game/mesh-batching.ts';

test('batched parts retain deformed positions across a full skeletal motion cycle', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  try {
    const skeleton = new Skeleton('shared', 'shared', scene);
    const root = new Bone('root', skeleton, null, Matrix.Identity());
    const limb = new Bone('limb', skeleton, root, Matrix.Translation(0, 1, 0));
    const parent = new TransformNode('character', scene);
    parent.position.set(4, 0, -3); parent.rotation.y = .7; parent.scaling.z = -1;
    const material = new StandardMaterial('skin', scene);
    const parts = [-1, 1].map(x => {
      const mesh = MeshBuilder.CreateBox('part', {}, scene);
      mesh.bakeTransformIntoVertices(Matrix.Translation(x, 1, 0));
      mesh.parent = parent; mesh.material = material; mesh.skeleton = skeleton;
      const indices: number[] = [], weights: number[] = [];
      for (let i = 0; i < mesh.getTotalVertices(); i++) {
        indices.push(0, 1, 0, 0); weights.push(.25, .75, 0, 0);
      }
      mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, indices, false, 4);
      mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights, false, 4);
      return mesh;
    });
    const pose = (phase: number) => {
      limb.setRotationQuaternion(Quaternion.RotationAxis(Vector3.Forward(), Math.sin(phase) * 1.1));
      skeleton.prepare(true);
    };
    const before = Array.from({ length: 24 }, (_, i) => {
      pose(i * Math.PI / 12);
      return parts.flatMap(mesh => Array.from(mesh.getPositionData(true)!));
    });
    const indexCount = parts.reduce((n, mesh) => n + mesh.getTotalIndices(), 0);
    const [merged] = batchSkinnedMeshes(parts);
    assert.equal(merged.skeleton, skeleton);
    assert.equal(merged.parent, parent);
    assert.equal(merged.getTotalIndices(), indexCount);
    assert.equal(merged.subMeshes.length, 1);
    assert.equal(merged.subMeshes[0].indexCount, indexCount);
    for (let i = 0; i < before.length; i++) {
      pose(i * Math.PI / 12);
      assert.deepEqual(Array.from(merged.getPositionData(true)!), before[i]);
    }
  } finally { scene.dispose(); engine.dispose(); }
});

test('batching leaves transformed parts and different skeletons independent', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  try {
    const material = new StandardMaterial('skin', scene);
    const skeletons = [new Skeleton('one', 'one', scene), new Skeleton('two', 'two', scene)];
    const parts = Array.from({ length: 3 }, (_, i) => {
      const mesh = MeshBuilder.CreateBox('part', {}, scene);
      mesh.material = material; mesh.skeleton = skeletons[i % 2];
      if (i === 2) mesh.position.x = 2;
      return mesh;
    });
    assert.deepEqual(batchSkinnedMeshes(parts), parts);
    assert.ok(parts.every(mesh => !mesh.isDisposed()));
  } finally { scene.dispose(); engine.dispose(); }
});
