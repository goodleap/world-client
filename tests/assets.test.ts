import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

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

test('soldier production leaves every base-human source and asset unchanged', () => {
  const record = JSON.parse(readFileSync(new URL('../studies/soldiers/base-source.json', import.meta.url), 'utf8'));
  for (const [name, expected] of Object.entries(record.sha256)) {
    const source = readFileSync(new URL('../studies/base-human/' + name, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), expected, name);
  }
});

for (const role of ['infantry', 'archer']) {
  const soldier = asset(`../studies/soldiers/${role}/${role}.glb`);
  test(`${role} retains the base human skin, skeleton and body geometry`, () => {
    const skeleton = (a: typeof base) => a.json.skins[0].joints.map(i => {
      const n = a.json.nodes[i];
      return { name: n.name, matrix: n.matrix, translation: n.translation, rotation: n.rotation, scale: n.scale,
        children: n.children?.map(j => a.json.nodes[j].name) };
    });
    assert.equal(skeleton(soldier).length, 20);
    assert.deepEqual(skeleton(soldier), skeleton(base));
    assert.deepEqual(soldier.bytes(soldier.json.skins[0].inverseBindMatrices), base.bytes(base.json.skins[0].inverseBindMatrices));
    for (const name of ['Head • shaped cranium cheeks and jaw', 'Torso skin', 'Continuous arm and fist.L',
      'Continuous arm and fist.R', 'T-shirt • connected shoulders', 'Shorts • shaped hip and separate legs']) {
      const positions = (a: typeof base) => a.bytes(a.json.meshes[a.json.nodes.find(n => n.name === name)!.mesh!].primitives[0].attributes.POSITION);
      assert.deepEqual(positions(soldier), positions(base), name);
    }
  });
  test(`${role} preserves the complete shared gait and timing with only carried-weapon arm adaptation`, () => {
    assert.deepEqual(soldier.json.animations.map(c => c.name).sort(), ['Run', 'Walk']);
    for (const clip of base.json.animations) {
      const target = soldier.json.animations.find(c => c.name === clip.name)!;
      assert.equal(target.channels.length, clip.channels.length);
      for (const channel of clip.channels) {
        const name = base.json.nodes[channel.target.node].name;
        const match = target.channels.find(c => soldier.json.nodes[c.target.node].name === name && c.target.path === channel.target.path)!;
        const original = clip.samplers[channel.sampler], adapted = target.samplers[match.sampler];
        const carriedArm = /^(upper_arm|forearm|hand)\./.test(name);
        const oldTimes = base.bytes(original.input), newTimes = soldier.bytes(adapted.input);
        if (!carriedArm) assert.deepEqual(newTimes, oldTimes);
        else {
          // Constant carry channels may be reduced to their two endpoints.
          assert.equal(newTimes.readFloatLE(0), oldTimes.readFloatLE(0));
          assert.equal(newTimes.readFloatLE(newTimes.length - 4), oldTimes.readFloatLE(oldTimes.length - 4));
        }
        if (!carriedArm) {
          assert.equal(adapted.interpolation, original.interpolation);
          assert.deepEqual(soldier.bytes(adapted.output), base.bytes(original.output), clip.name + '/' + name + '/' + channel.target.path);
        } else if (channel.target.path !== 'rotation') {
          // glTF decomposes the rotated joint matrices; preserve translation
          // and scale to float32 rounding rather than comparing their bytes.
          const expected = base.bytes(original.output), actual = soldier.bytes(adapted.output);
          assert.equal(actual.length, expected.length);
          for (let i = 0; i < actual.length; i += 4) {
            assert.ok(Math.abs(actual.readFloatLE(i) - expected.readFloatLE(i)) < 1e-6);
          }
        }
      }
    }
  });
}

const cavalry = asset('../studies/soldiers/cavalry/cavalry.glb');
test('mounted cavalry retains all original human bones, geometry and source Walk/Run channels', () => {
  const humanNames = new Set(base.json.skins[0].joints.map(i => base.json.nodes[i].name));
  const humanSkeleton = (a: typeof base) => a.json.skins[0].joints.filter(i => humanNames.has(a.json.nodes[i].name)).map(i => {
    const n = a.json.nodes[i];
    return { name: n.name, matrix: n.matrix, translation: n.translation, rotation: n.rotation, scale: n.scale,
      children: n.children?.map(j => a.json.nodes[j].name) };
  });
  assert.deepEqual(humanSkeleton(cavalry), humanSkeleton(base));
  assert.equal(cavalry.json.skins[0].joints.filter(i => cavalry.json.nodes[i].name.startsWith('Horse.')).length, 17);
  assert.deepEqual(cavalry.bytes(cavalry.json.skins[0].inverseBindMatrices).subarray(0, 20*16*4),
    base.bytes(base.json.skins[0].inverseBindMatrices));
  for (const name of ['Head • shaped cranium cheeks and jaw', 'Torso skin', 'Continuous arm and fist.L',
    'Continuous arm and fist.R', 'T-shirt • connected shoulders', 'Shorts • shaped hip and separate legs']) {
    const positions = (a: typeof base) => a.bytes(a.json.meshes[a.json.nodes.find(n => n.name === name)!.mesh!].primitives[0].attributes.POSITION);
    assert.deepEqual(positions(cavalry), positions(base), name);
  }
  for (const original of base.json.animations) {
    const retained = cavalry.json.animations.find(a => a.name === original.name)!;
    for (const channel of original.channels) {
      const name = base.json.nodes[channel.target.node].name;
      const match = retained.channels.find(c => cavalry.json.nodes[c.target.node].name === name && c.target.path === channel.target.path)!;
      const a = original.samplers[channel.sampler], b = retained.samplers[match.sampler];
      assert.deepEqual(cavalry.bytes(b.input), base.bytes(a.input));
      assert.deepEqual(cavalry.bytes(b.output), base.bytes(a.output), original.name + '/' + name);
      assert.equal(b.interpolation, a.interpolation);
    }
  }
});

test('cavalry adds distinct mounted idle, four-beat walk and airborne trot clips', () => {
  assert.deepEqual(cavalry.json.animations.map(c => c.name).sort(), ['RideIdle', 'RideRun', 'RideWalk', 'Run', 'Walk']);
  for (const [name, duration] of [['RideWalk', .60], ['RideRun', .50]] as const) {
    const clip = cavalry.json.animations.find(a => a.name === name)!;
    const time = cavalry.bytes(clip.samplers[0].input);
    assert.equal(time.readFloatLE(0), 0);
    assert.ok(Math.abs(time.readFloatLE(time.length - 4) - duration) < 1e-6);
    for (const bone of ['root', 'Horse.root', 'Horse.upper.FL', 'Horse.lower.FR', 'Horse.hoof.HL']) {
      assert.ok(clip.channels.some(c => cavalry.json.nodes[c.target.node].name === bone));
    }
  }
  const root = (clipName: string) => {
    const clip = cavalry.json.animations.find(a => a.name === clipName)!;
    const channel = clip.channels.find(c => cavalry.json.nodes[c.target.node].name === 'Horse.root' && c.target.path === 'translation')!;
    return cavalry.bytes(clip.samplers[channel.sampler].output);
  };
  assert.notDeepEqual(root('RideRun'), root('RideWalk'));
});
