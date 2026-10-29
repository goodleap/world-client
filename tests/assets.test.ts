import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Accessor = { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string };
type GLTF = {
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  nodes: { name: string; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  skins: { joints: number[]; inverseBindMatrices: number }[];
  animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation: string }[] }[];
};
function asset(path: string) {
  const data = readFileSync(new URL(path, import.meta.url));
  assert.equal(data.toString('ascii', 0, 4), 'glTF');
  const length = data.readUInt32LE(12);
  const json: GLTF = JSON.parse(data.toString('utf8', 20, 20 + length));
  const binary = data.subarray(28 + length);
  const bytes = (id: number) => {
    const a = json.accessors[id], v = json.bufferViews[a.bufferView];
    const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]! * ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType]!));
    assert.ok(size > 0);
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return Buffer.concat(Array.from({ length: a.count }, (_, i) => binary.subarray(start + i * (v.byteStride ?? size), start + i * (v.byteStride ?? size) + size)));
  };
  return { json, bytes };
}
const base = asset('../studies/base-human/base-human.glb');
const farmer = asset('../studies/farmer/farmer.glb');

test('farmer uses the base skeleton, bind pose and unchanged head geometry', () => {
  assert.equal(base.json.skins.length, 1); assert.equal(farmer.json.skins.length, 1);
  const skeleton = (a: typeof base) => a.json.skins[0].joints.map(i => {
    const n = a.json.nodes[i];
    return { name: n.name, matrix: n.matrix, translation: n.translation, rotation: n.rotation, scale: n.scale,
      children: n.children?.map(j => a.json.nodes[j].name) };
  });
  assert.equal(skeleton(base).length, 20);
  assert.deepEqual(skeleton(farmer), skeleton(base));
  assert.deepEqual(farmer.bytes(farmer.json.skins[0].inverseBindMatrices), base.bytes(base.json.skins[0].inverseBindMatrices));
  const head = (a: typeof base) => a.bytes(a.json.meshes[a.json.nodes.find(n => n.name.startsWith('Head •'))!.mesh!].primitives[0].attributes.POSITION);
  assert.deepEqual(head(farmer), head(base));
});

test('farmer reuses every Walk and Run channel, including timing, instead of sped-up walking', () => {
  const clips = (a: typeof base) => Object.fromEntries(a.json.animations.map(clip => [clip.name,
    Object.fromEntries(clip.channels.map(c => {
      const s = clip.samplers[c.sampler];
      return [a.json.nodes[c.target.node].name + '/' + c.target.path,
        { input: a.bytes(s.input), output: a.bytes(s.output), interpolation: s.interpolation }];
    })),
  ]));
  assert.deepEqual(Object.keys(clips(farmer)).sort(), ['Run', 'Walk']);
  assert.deepEqual(clips(farmer), clips(base));
  for (const [name, duration] of [['Walk', .5], ['Run', .45]] as const) {
    const clip = base.json.animations.find(c => c.name === name)!;
    const times = base.bytes(clip.samplers[0].input);
    assert.equal(times.readFloatLE(0), 0);
    assert.ok(Math.abs(times.readFloatLE(times.length - 4) - duration) < 1e-6);
  }
});
