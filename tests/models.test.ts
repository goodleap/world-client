import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { createPalette, softBox } from '../src/game/models.ts';

test('chamfered model faces point outward so clothing and faces cannot render inside out', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const palette = createPalette(scene);
    for (const size of [[1, 2, 3], [0.52, 0.52, 0.48], [0.065, 0.13, 0.51]] as [number, number, number][]) {
      const mesh = softBox(scene, 'geometry-check', size, [0, 0, 0], palette.skin);
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      assert.ok(positions.length > 0);
      for (let i = 0; i < positions.length; i += 3) {
        const outward = positions[i] * normals[i] + positions[i + 1] * normals[i + 1] + positions[i + 2] * normals[i + 2];
        assert.ok(outward > 0, `Inward-facing surface at vertex ${i / 3}`);
      }
      assert.equal(mesh.material!.backFaceCulling, true);
    }
  } finally { scene.dispose(); engine.dispose(); }
});
