import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { attachTreeLOD, createReferenceTree, createTreeMaterials } from '../src/game/tree.ts';

test('tree LOD preserves its full extent and reduces both bark and crown geometry', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const materials = createTreeMaterials(scene);
    const levels = (['near', 'medium', 'far'] as const).map(detail => createReferenceTree(scene, materials, 0, 0, 1, 0, detail));
    const triangles = levels.map(parts => parts.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0));
    assert.equal(triangles[0], 26508, 'the close-up mesh is unchanged');
    assert.ok(triangles[1] < 6000 && triangles[2] < 1600, 'both reduced levels have useful budgets');
    for (const parts of levels.slice(1)) {
      assert.equal(parts.length, levels[0].length, 'all six crown lobes and the trunk remain');
      for (const [i, mesh] of parts.entries()) {
        mesh.computeWorldMatrix(true); levels[0][i].computeWorldMatrix(true);
        const original = levels[0][i].getBoundingInfo().boundingBox, reduced = mesh.getBoundingInfo().boundingBox;
        for (const edge of ['minimumWorld', 'maximumWorld'] as const) {
          assert.ok(Vector3.Distance(original[edge], reduced[edge]) < .06, 'roots, branches and crown retain their extent');
        }
        assert.equal(mesh.material, levels[0][i].material);
      }
    }
  } finally { scene.dispose(); engine.dispose(); }
});

test('native instance LOD follows orthographic coverage and survives shadow selection and harvesting', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const materials = createTreeMaterials(scene);
    const levels = (['near', 'medium', 'far'] as const).map(detail => {
      const parts = createReferenceTree(scene, materials, 0, 0, 1, 0, detail);
      const bark = parts[0], crown = Mesh.MergeMeshes(parts.slice(1), true, true)!;
      for (const mesh of [bark, crown]) { mesh.bakeCurrentTransformIntoVertices(); mesh.isVisible = false; }
      return [bark, crown];
    });
    for (const [i, source] of levels[0].entries()) attachTreeLOD(source, levels[1][i], levels[2][i]);
    const camera = new Camera('map', new Vector3(0, 10, -20), scene); camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    const shadow = new Camera('shadow-lod', Vector3.Zero(), scene); shadow.mode = Camera.ORTHOGRAPHIC_CAMERA;
    shadow.orthoTop = shadow.orthoRight = 100; shadow.orthoBottom = shadow.orthoLeft = -100;
    const zoom = (size: number) => { camera.orthoTop = size; camera.orthoBottom = -size; camera.orthoRight = size / 2; camera.orthoLeft = -size / 2; };
    for (const [i, source] of levels[0].entries()) {
      const a = source.createInstance('a'), b = source.createInstance('b');
      a.position.set(10, 0, -20); b.position.set(-30, 0, 25);
      a.metadata = { worldObjectId: 'tree-a' }; a.computeWorldMatrix(true); b.computeWorldMatrix(true);
      for (const [extent, level] of [[4, 0], [18, 1], [168, 2]]) {
        zoom(extent);
        assert.equal(a.getLOD(camera), levels[level][i]);
        assert.equal(b.getLOD(camera), levels[level][i], 'map depth does not replace projected size');
      }
      zoom(4);
      assert.equal(a.getLOD(shadow), levels[2][i]);
      assert.equal(a.getLOD(camera), source, 'the shadow pass cannot leave the main view on the far level');
      assert.equal(a.metadata.worldObjectId, 'tree-a');
      for (const level of levels.slice(1)) assert.equal(level[i].isBlocked, true, 'LOD templates never render on their own');
      a.dispose();
      assert.equal(source.instances.length, 1);
      zoom(168); assert.equal(b.getLOD(camera), levels[2][i], 'harvesting one tree leaves shared LODs intact');
      assert.equal(levels[2][i].isDisposed(), false);
    }
  } finally { scene.dispose(); engine.dispose(); }
});
