import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { packGeometry } from '../src/game/geometry-memory.ts';
import '@babylonjs/core/Meshes/instancedMesh.js';

test('packed static buffers preserve shared instances, submeshes, CPU picking and restoration data', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const mesh = MeshBuilder.CreateBox('building', { size: 1.37 }, scene);
    const geometry = mesh.geometry!, original = [...geometry.getVerticesData('position')!], indices = [...geometry.getIndices()!];
    mesh.releaseSubMeshes();
    new SubMesh(0, 0, mesh.getTotalVertices(), 0, 18, mesh);
    new SubMesh(1, 0, mesh.getTotalVertices(), 18, 18, mesh);
    const instance = mesh.createInstance('another building'); instance.position.x = 3;
    const clone = mesh.clone('shared building')!; clone.position.x = -3;
    mesh.computeWorldMatrix(true); instance.computeWorldMatrix(true); clone.computeWorldMatrix(true);
    const ray = new Ray(new Vector3(0, 0, -5), new Vector3(0, 0, 1));
    const hit = ray.intersectsMesh(mesh).distance;
    packGeometry(geometry);
    assert.equal(clone.geometry, geometry); assert.equal(instance.sourceMesh.geometry, geometry);
    assert.deepEqual(mesh.subMeshes!.map(s => [s.materialIndex, s.indexStart, s.indexCount]), [[0, 0, 18], [1, 18, 18]]);
    assert.deepEqual([...geometry.getIndices()!], indices);
    assert(geometry.getIndices() instanceof Uint16Array);
    const positions = geometry.getVerticesData(VertexBuffer.PositionKind)!;
    assert(positions instanceof Float32Array);
    assert.deepEqual([...positions], original.map(Math.fround));
    assert(Math.abs(ray.intersectsMesh(mesh).distance - hit) < 1e-6);
    // Native retained CPU buffers are still serializable/rebuildable after packing.
    assert(geometry.getVertexBuffer('position')!.getData() instanceof Float32Array);
    const copy = geometry.copy('restored');
    assert.deepEqual([...copy.getVerticesData('position')!], [...positions]);
    assert.deepEqual([...copy.getIndices()!], indices);
    const buffer = geometry.getVertexBuffer('position'); packGeometry(geometry);
    assert.equal(geometry.getVertexBuffer('position'), buffer, 'already packed geometry is not reuploaded');
  } finally { scene.dispose(); engine.dispose(); }
});

test('large static meshes retain indices beyond 65535', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const mesh = MeshBuilder.CreateGround('large terrain', { subdivisions: 260 }, scene), geometry = mesh.geometry!;
    const indices = [...geometry.getIndices()!];
    packGeometry(geometry);
    assert(geometry.getIndices() instanceof Uint32Array);
    assert.deepEqual([...geometry.getIndices()!], indices);
  } finally { scene.dispose(); engine.dispose(); }
});
