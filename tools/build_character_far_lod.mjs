/** Offline only: npm install --prefix /tmp/world-lod-tool meshoptimizer@1.3.0
 * node tools/build_character_far_lod.mjs /tmp/world-lod-tool/node_modules/meshoptimizer/index.js
 * Native Babylon simplification does not preserve skin attributes. meshoptimizer
 * selects original vertices; every retained attribute (including weights) is
 * copied byte-for-byte. Rig, materials and near/medium assets remain intact. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
assert.equal(JSON.parse(await readFile(resolve(dirname(process.argv[2]), 'package.json'), 'utf8')).version, '1.3.0');
const { MeshoptSimplifier: simplify } = await import(pathToFileURL(process.argv[2]).href);
await simplify.ready;
const folder = new URL('../studies/characters/', import.meta.url);
const raw = await readFile(new URL('characters-lod.glb', folder));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const length = raw.readUInt32LE(12), source = JSON.parse(raw.subarray(20, 20 + length));
const binary = raw.subarray(28 + length), output = structuredClone(source);
assert(!source.animations?.length && !source.images?.length);
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
function bytes(index) {
  const a = source.accessors[index], v = source.bufferViews[a.bufferView];
  assert(!a.sparse && types[a.componentType]);
  const size = sizes[a.type] * types[a.componentType].BYTES_PER_ELEMENT;
  const start = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || size;
  const packed = Buffer.alloc(a.count * size);
  for (let i = 0; i < a.count; i++) binary.copy(packed, i * size, start + i * stride, start + i * stride + size);
  return packed;
}
function values(index) {
  const data = bytes(index), Type = types[source.accessors[index].componentType];
  return new Type(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}
const chunks = [], cache = new Map(); let offset = 0;
output.accessors = []; output.bufferViews = [];
function store(index, data = bytes(index), count = source.accessors[index].count, componentType = source.accessors[index].componentType) {
  const a = { ...source.accessors[index], count, componentType };
  delete a.bufferView; delete a.byteOffset;
  // A subset's extrema may differ; calculate them instead of copying old bounds.
  if (a.min || a.max) {
    const Type = types[componentType], array = new Type(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const width = sizes[a.type]; a.min = Array(width).fill(Infinity); a.max = Array(width).fill(-Infinity);
    for (let i = 0; i < array.length; i++) { const c = i % width; a.min[c] = Math.min(a.min[c], array[i]); a.max[c] = Math.max(a.max[c], array[i]); }
  }
  const key = hash(Buffer.concat([Buffer.from(JSON.stringify(a)), data]));
  if (cache.has(key)) return cache.get(key);
  const padding = (4 - offset % 4) % 4; chunks.push(Buffer.alloc(padding)); offset += padding;
  a.bufferView = output.bufferViews.length;
  output.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
  chunks.push(data); offset += data.length;
  const result = output.accessors.length; output.accessors.push(a); cache.set(key, result); return result;
}
for (const skin of output.skins) skin.inverseBindMatrices = store(skin.inverseBindMatrices);
const records = [], geometry = new Map();
for (const [mi, mesh] of source.meshes.entries()) for (const [pi, primitive] of mesh.primitives.entries()) {
  const key = JSON.stringify([primitive.indices, primitive.attributes]);
  let result = geometry.get(key);
  if (!result) {
    const indices = Uint32Array.from(values(primitive.indices)), positions = values(primitive.attributes.POSITION);
    const weights = values(primitive.attributes.WEIGHTS_0), joints = values(primitive.attributes.JOINTS_0);
    const vertexCount = positions.length / 3, locks = new Uint8Array(vertexCount);
    const bone = new Int32Array(vertexCount).fill(-1);
    for (let i = 0; i < vertexCount; i++) {
      const active = [0, 1, 2, 3].filter(k => weights[i * 4 + k] > 0);
      if (active.length !== 1) locks[i] = 1; // Preserve every blended joint vertex.
      else bone[i] = joints[i * 4 + active[0]];
    }
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      if (bone[a] !== bone[b] || bone[a] !== bone[c]) locks[a] = locks[b] = locks[c] = 1;
    }
    const normals = values(primitive.attributes.NORMAL);
    let reduced = indices, error = 0;
    if (indices.length / 3 >= 600) [reduced, error] = simplify.simplifyWithAttributes(indices, positions, 3,
      normals, 3, [.01, .01, .01], locks, Math.floor(indices.length / 3 * .22) * 3, .008, ['ErrorAbsolute', 'LockBorder']);
    assert(error <= .00801 && reduced.length > 0);
    const retained = new Set(reduced);
    // Blended/transition vertices keep their original attributes and positions.
    for (let i = 0; i < locks.length; i++) if (locks[i]) assert(retained.has(i) || !indices.includes(i));
    const [remap, count] = simplify.compactMesh(reduced), attributes = {};
    for (const [name, index] of Object.entries(primitive.attributes)) {
      const original = bytes(index), size = original.length / vertexCount, compact = Buffer.alloc(count * size);
      for (const old of retained) original.copy(compact, remap[old] * size, old * size, (old + 1) * size);
      attributes[name] = store(index, compact, count);
    }
    const typedIndices = count <= 65535 ? Uint16Array.from(reduced) : reduced;
    const indexData = Buffer.from(typedIndices.buffer, typedIndices.byteOffset, typedIndices.byteLength);
    result = { attributes, indices: store(primitive.indices, indexData, reduced.length, count <= 65535 ? 5123 : 5125),
      geometryKey: hash(Buffer.from(JSON.stringify([attributes, hash(indexData)]))),
      sourceTriangles: indices.length / 3, farTriangles: reduced.length / 3, error, lockedVertices: locks.reduce((a, b) => a + b, 0) };
    geometry.set(key, result);
  }
  output.meshes[mi].primitives[pi] = { ...primitive, indices: result.indices, attributes: result.attributes };
  for (const node of output.nodes.filter(n => n.mesh === mi)) {
    node.extras.geometryKey = result.geometryKey;
    records.push({ part: node.extras.partId, name: node.extras.originalName, sourceTriangles: result.sourceTriangles,
      farTriangles: result.farTriangles, error: result.error, lockedVertices: result.lockedVertices });
  }
}
output.asset.generator = 'world-client far LOD / meshoptimizer 1.3.0';
output.buffers = [{ byteLength: offset }];
const doc = Buffer.from(JSON.stringify(output)), json = Buffer.concat([doc, Buffer.alloc((4 - doc.length % 4) % 4, 32)]);
const bin = Buffer.concat([...chunks, Buffer.alloc((4 - offset % 4) % 4)]);
const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8); header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length); binHeader.write('BIN\0', 4);
const packed = Buffer.concat([header, json, binHeader, bin]);
await writeFile(new URL('characters-far-lod.glb', folder), packed);
const report = { source: 'characters-lod.glb', sourceSha256: hash(raw), farSha256: hash(packed), generator: output.asset.generator,
  maximumError: Math.max(...records.map(r => r.error)), sourceTriangles: records.reduce((s, r) => s + r.sourceTriangles, 0),
  farTriangles: records.reduce((s, r) => s + r.farTriangles, 0), sourceBytes: raw.length, farBytes: packed.length,
  retainedAttributes: 'byte-identical original vertices; all blended vertices and bone boundaries locked', parts: records };
await writeFile(new URL('far-lod.json', folder), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, parts: undefined }, null, 2));
