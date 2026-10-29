import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { objectAtFace, selectionRanges } from '../src/game/world-selection.ts';

test('ray picks retain logical identities after transforming and batching different objects', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  try {
    const parts = [-4, -2, 0, 2, 4].map((x, index) => {
      const mesh = index % 2 ? MeshBuilder.CreateSphere('round', { diameter: 1 }, scene) : MeshBuilder.CreateBox('box', { size: 1 }, scene);
      mesh.position.x = x; mesh.rotation.y = index * .2;
      mesh.metadata = { worldObjectId: ['tree-a', undefined, 'crop-a', 'tree-a', 'house-a'][index] };
      return mesh;
    });
    const ranges = selectionRanges(parts);
    const merged = Mesh.MergeMeshes(parts, true, true)!;
    merged.computeWorldMatrix(true);
    for (const [index, x] of [-4, -2, 0, 2, 4].entries()) {
      const pick = scene.pickWithRay(new Ray(new Vector3(x, 3, 0), new Vector3(0, -1, 0)), mesh => mesh === merged)!;
      assert.ok(pick.hit);
      assert.equal(objectAtFace(ranges, pick.faceId), ['tree-a', undefined, 'crop-a', 'tree-a', 'house-a'][index]);
    }
    assert.equal(objectAtFace(ranges, -1), undefined);
  } finally { scene.dispose(); engine.dispose(); }
});
