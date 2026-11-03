import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { referenceHouse, homeCenter } from '../src/game/buildings.ts';
import { attachBuildingLOD } from '../src/game/building-lod.ts';
import { createPalette } from '../src/game/models.ts';
import { createSelectionFeedback } from '../src/game/selection-feedback.ts';

test('all house LODs retain parts, materials and extent, with substantial geometry reduction', () => {
  const engine = new NullEngine(), scene = new Scene(engine), p = createPalette(scene);
  try {
    for (const id of ['cottage', 'warehouse', 'home-center']) {
      const b = { id, x: 0, z: 0, width: id === 'cottage' ? 3.37683 : 5.06524, depth: 3.37683, height: 2.9 };
      const levels = (['near', 'map', 'far'] as const).map(detail => {
        const first = scene.meshes.length; if (id === 'home-center') homeCenter(scene, p, b, detail); else referenceHouse(scene, p, b, false, detail);
        return scene.meshes.slice(first);
      });
      const tris = levels.map(parts => parts.reduce((n, m) => n + m.getTotalIndices() / 3, 0));
      assert.ok(tris[1] < tris[0] * .55 && tris[2] < tris[0] * .22);
      for (const parts of levels.slice(1)) {
        assert.deepEqual(parts.map(m => [m.name, m.material?.name]), levels[0].map(m => [m.name, m.material?.name]));
        for (const [i, mesh] of parts.entries()) {
          mesh.computeWorldMatrix(true); levels[0][i].computeWorldMatrix(true);
          const a = mesh.getBoundingInfo().boundingBox, b = levels[0][i].getBoundingInfo().boundingBox;
          assert.ok(Vector3.Distance(a.minimumWorld, b.minimumWorld) < .03);
          assert.ok(Vector3.Distance(a.maximumWorld, b.maximumWorld) < .03);
        }
      }
    }
  } finally { scene.dispose(); engine.dispose(); }
});

test('built house instances and selected clones preserve native LOD, picking and disposal', () => {
  const engine = new NullEngine(), scene = new Scene(engine), p = createPalette(scene);
  try {
    const camera = new Camera('camera', Vector3.Zero(), scene); camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    const b = { id: 'warehouse', x: 0, z: 0, width: 5, depth: 3.4, height: 2.9 };
    referenceHouse(scene, p, b, false);
    const groups = new Map<Mesh['material'], Mesh[]>();
    for (const mesh of scene.meshes) { const group = groups.get(mesh.material) ?? []; group.push(mesh as Mesh); groups.set(mesh.material, group); }
    const sources = [...groups.values()].map(parts => Mesh.MergeMeshes(parts, true, true)!);
    sources.forEach(m => { m.bakeCurrentTransformIntoVertices(); m.isVisible = false; });
    attachBuildingLOD(scene, sources, detail => referenceHouse(scene, p, b, false, detail));
    const source = sources.find(m => m.material === p.terracotta)!;
    const instance = source.createInstance('built-house'); instance.position.x = 13; instance.metadata = { worldObjectId: 'built-house' }; instance.freezeWorldMatrix();
    const shadow = new ShadowGenerator(256, new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)); shadow.addShadowCaster(instance);
    const selection = createSelectionFeedback(scene, shadow), baseline = scene.meshes.length;
    const zoom = (area: number) => { const half = Math.sqrt(area) / 2; camera.orthoTop = camera.orthoRight = half; camera.orthoBottom = camera.orthoLeft = -half; camera.getProjectionMatrix(true); };
    for (const [area, expected] of [[100, 'near'], [400, 'map'], [1600, 'far']] as const) {
      zoom(area); const native = instance.getLOD(camera)!;
      assert.ok(expected === 'near' ? native === source : native.name.endsWith(expected));
      selection.update([instance]);
      const shown = scene.meshes.find(m => m.name === 'selected-built-house')!;
      assert.equal(shown.getLOD(camera)!.geometry, native.geometry);
      assert.equal(shown.getLOD(camera)!.renderOutline, true);
      assert.equal(shown.getWorldMatrix().getTranslation().x, 13);
      assert.equal(shown.isPickable, true); selection.update([]);
      assert.equal(scene.meshes.length, baseline); assert.equal(instance.isEnabled(), true);
    }
    instance.dispose(); assert.equal(source.isDisposed(), false);
    selection.dispose(); shadow.dispose();
  } finally { scene.dispose(); engine.dispose(); }
});
