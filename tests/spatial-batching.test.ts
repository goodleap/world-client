import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { spatialBatches } from '../src/game/spatial-batching.ts';
import { selectionRanges, objectAtFace } from '../src/game/world-selection.ts';

test('spatial batches preserve all triangles and face identities while native frustum culling excludes distant cells', async () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  try {
    const camera = new ArcRotateCamera('view', -Math.PI / 2, Math.PI / 2, 12, Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = camera.orthoBottom = -4; camera.orthoRight = camera.orthoTop = 4;
    const material = new StandardMaterial('shared', scene);
    const sources = [1, 3, 41].map((x, i) => {
      const mesh = MeshBuilder.CreateBox(`object-${i}`, {}, scene);
      mesh.position.x = x; mesh.position.z = 1; mesh.rotation.y = .2;
      mesh.material = material; mesh.metadata = { worldObjectId: mesh.name };
      return mesh;
    });
    const triangles = sources.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
    const merged = [...spatialBatches(sources).values()].map(parts => {
      const ranges = selectionRanges(parts);
      const mesh = Mesh.MergeMeshes(parts, true, true)!;
      mesh.metadata = { worldFaceRanges: ranges }; mesh.freezeWorldMatrix();
      return mesh;
    });
    assert.equal(merged.length, 2);
    assert.equal(merged.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), triangles);
    assert.equal(objectAtFace(merged[0].metadata.worldFaceRanges, 0), 'object-0');
    assert.equal(objectAtFace(merged[0].metadata.worldFaceRanges, 12), 'object-1');
    await scene.whenReadyAsync();
    scene.render();
    assert.equal(scene.getActiveIndices() / 3, 24);
    camera.target.x = 40;
    scene.render();
    assert.equal(scene.getActiveIndices() / 3, 12);
    assert.equal(objectAtFace(merged[1].metadata.worldFaceRanges, 0), 'object-2');
  } finally { scene.dispose(); engine.dispose(); }
});
