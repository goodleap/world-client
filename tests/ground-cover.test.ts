import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { createGroundCover } from '../src/game/ground-cover.ts';
import { BUILDINGS, GRID_SIZE } from '../src/game/world-data.ts';
import { FARM_PLOTS } from '../src/game/economy-config.ts';

test('native ground patches keep separate GPU instance buffers and clear roads, farm plots and building footprints', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const cover = createGroundCover(scene, { paths: [[{ x: -100, z: 0 }, { x: 100, z: 0 }]], roadHalfWidth: 2 });
    cover.sync([]);
    const patches = scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.name.startsWith('meadow-cover-'));
    const positions = () => patches.filter(m => m.isEnabled()).flatMap(m => m.thinInstanceGetWorldMatrices()
      .map(matrix => Vector3.TransformCoordinates(matrix.getTranslation(), m.getWorldMatrix())));
    const initial = positions();
    assert.ok(initial.length > 4_000, 'density scales across the expanded map');
    assert.equal(new Set(patches.map(m => m.getVertexBuffer('world0'))).size, patches.length,
      'writing the last chunk must not replace every other chunk’s GPU matrices');
    const footprints = [...BUILDINGS, ...FARM_PLOTS.map(p => ({ ...p, width: GRID_SIZE, depth: GRID_SIZE }))];
    for (const p of initial) {
      assert.ok(Math.abs(p.z) >= 2.4, 'road and grass verge stay clear');
      assert.ok(footprints.every(b => Math.abs(p.x - b.x) > b.width / 2 + .4 || Math.abs(p.z - b.z) > b.depth / 2 + .4));
    }
    const site = { x: 20, z: -20, width: 10, depth: 10 };
    cover.sync([site]);
    const built = positions();
    assert.ok(built.length < initial.length);
    assert.ok(built.every(p => Math.abs(p.x - site.x) > 5.4 || Math.abs(p.z - site.z) > 5.4), 'construction removes cover throughout its footprint');
    const buffers = patches.map(m => m.getVertexBuffer('world0'));
    cover.sync([{ ...site }]);
    assert.deepEqual(patches.map(m => m.getVertexBuffer('world0')), buffers, 'ordinary economy updates do not re-upload plants');
    cover.sync([]);
    assert.deepEqual(positions(), initial, 'cancelling construction restores exactly the original meadow');
    assert.ok(patches.every(m => !m.isPickable && m.receiveShadows), 'decorations cannot intercept commands');

    const camera = new ArcRotateCamera('map', -Math.PI / 2, .76, 50, Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.minZ = .1;
    for (const extent of [16, 80, 16]) {
      camera.orthoTop = camera.orthoRight = extent; camera.orthoBottom = camera.orthoLeft = -extent;
      camera.getProjectionMatrix(true);
      for (const mesh of patches) assert.equal(mesh.getLOD(camera), extent === 80 ? null : mesh);
    }
  } finally { scene.dispose(); engine.dispose(); }
});
