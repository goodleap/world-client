// Offline asset preparation with Babylon's own simplifier. No decimation runs
// on the phone, and the original close-up trunk is kept byte-for-byte.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { QuadraticErrorSimplification } from '@babylonjs/core/Meshes/meshSimplification.js';

const input = new URL('../src/game/tree-trunk.json', import.meta.url);
const raw = await readFile(input), data = JSON.parse(raw);
const engine = new NullEngine(), scene = new Scene(engine);
try {
  const source = new Mesh('tree-trunk', scene);
  Object.assign(new VertexData(), data).applyToMesh(source);
  const output = { generator: `Babylon ${NullEngine.Version} QuadraticErrorSimplification`,
    sourceSHA256: createHash('sha256').update(raw).digest('hex') };
  for (const [name, quality] of [['medium', .18], ['far', .045]]) {
    const reduced = await new Promise(resolve => new QuadraticErrorSimplification(source)
      .simplify({ quality, distance: 0, optimizeMesh: true }, resolve));
    const geometry = VertexData.ExtractFromMesh(reduced);
    assert(geometry.indices.length > 0 && geometry.indices.length < data.indices.length);
    output[name] = { positions: Array.from(geometry.positions, n => +n.toFixed(6)),
      normals: Array.from(geometry.normals, n => +n.toFixed(6)), indices: Array.from(geometry.indices) };
    console.log(`${name}: ${geometry.indices.length / 3} trunk triangles`);
    reduced.dispose();
  }
  await writeFile(new URL('../src/game/tree-trunk-lod.json', import.meta.url), JSON.stringify(output) + '\n');
} finally { scene.dispose(); engine.dispose(); }
