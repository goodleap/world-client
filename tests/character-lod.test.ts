import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { attachMeshLOD } from '../src/game/character-lod.ts';

test('native screen-coverage LOD switches differently sized parts together under orthographic zoom', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  try {
    const camera = new ArcRotateCamera('camera', 0, 1, 36, Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.minZ = .1;
    const skeleton = new Skeleton('shared', 'shared', scene);
    const material = new StandardMaterial('original', scene);
    const reduced = MeshBuilder.CreateSphere('temporary', { segments: 6 }, scene);
    const data = VertexData.ExtractFromMesh(reduced, true, true); reduced.dispose();
    const parts = [1, .1].map(diameter => {
      const source = MeshBuilder.CreateSphere('part', { diameter, segments: 16 }, scene);
      source.position.set(4, 0, -3); source.scaling.z = -1;
      source.skeleton = skeleton; source.material = material; source.receiveShadows = true;
      return attachMeshLOD(source, data);
    });
    const zoom = (extent: number) => {
      camera.orthoTop = camera.orthoRight = extent;
      camera.orthoBottom = camera.orthoLeft = -extent;
      camera.getProjectionMatrix(true);
    };
    zoom(10);
    for (const { source, detail } of parts) {
      assert.equal(source.getLOD(camera), detail);
      assert.equal(detail.skeleton, skeleton);
      assert.equal(detail.material, material);
      assert.equal(detail.getWorldMatrix(), source.getWorldMatrix());
      assert.equal(detail.isBlocked, true, 'LOD must not also render as an independent scene mesh');
    }
    zoom(2);
    for (const { source } of parts) assert.equal(source.getLOD(camera), source);
    camera.radius = 100; // Distance does not replace zoom for this camera type.
    for (const { source } of parts) assert.equal(source.getLOD(camera), source);
    zoom(10);
    for (const { source, detail } of parts) assert.equal(source.getLOD(camera), detail);
    assert.equal(scene.skeletons.length, 1);
  } finally { scene.dispose(); engine.dispose(); }
});
