"""Offline glTF animation editing. Retain geometry/rig bytes and compact only
unreferenced accessors/views; repeated action builds never grow dead buffers.
"""
import copy, json, struct
import numpy as np
from scipy.spatial.transform import Rotation as R
from character_assets import Asset


class AnimationAsset:
    def __init__(self, path):
        self.asset = Asset(path)
        self.g = copy.deepcopy(self.asset.g)
        self.binary = bytearray(self.asset.binary)
        self.names = {n['name']: i for i, n in enumerate(self.g['nodes'])}
        self.parents = {child: i for i, n in enumerate(self.g['nodes']) for child in n.get('children', [])}
        self.joints = [j for s in self.g['skins'] for j in s['joints']]

    def pose(self, name):
        clip = next(a for a in self.asset.g['animations'] if a['name'] == name)
        out = {}
        for c in clip['channels']:
            s = clip['samplers'][c['sampler']]
            width = 4 if c['target']['path'] == 'rotation' else 3
            out[c['target']['node'], c['target']['path']] = np.frombuffer(self.asset.accessor(s['output']), dtype='<f4')[:width].astype(float)
        return out

    def world(self, pose):
        result = {}
        def node(i):
            if i in result: return result[i]
            n = self.g['nodes'][i]
            m = np.eye(4)
            m[:3, :3] = R.from_quat(pose.get((i, 'rotation'), n.get('rotation', [0, 0, 0, 1]))).as_matrix()
            m[:3, 3] = pose.get((i, 'translation'), n.get('translation', [0, 0, 0]))
            result[i] = (node(self.parents[i]) if i in self.parents else np.eye(4)) @ m
            return result[i]
        for i in self.joints: node(i)
        return result

    def rotation(self, pose, name, rotation):
        i = self.names[name]
        parent = self.world(pose).get(self.parents.get(i), np.eye(4))
        pose[i, 'rotation'] = (R.from_matrix(parent[:3, :3]).inv() * rotation).as_quat()

    def delta(self, pose, name, rotation):
        self.rotation(pose, name, rotation * R.from_matrix(self.world(pose)[self.names[name]][:3, :3]))

    def accessor(self, data, kind):
        raw = np.asarray(data, dtype='<f4').tobytes()
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        offset = len(self.binary); self.binary.extend(raw)
        views = self.g['bufferViews']; accessors = self.g['accessors']
        item = {'bufferView': len(views), 'componentType': 5126, 'count': len(data), 'type': kind}
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw)})
        if kind == 'SCALAR': item.update(min=[float(min(data))], max=[float(max(data))])
        accessors.append(item)
        return len(accessors) - 1

    def animation(self, name, frames, duration):
        time = self.accessor(np.linspace(0, duration, len(frames)), 'SCALAR')
        clip = {'name': name, 'samplers': [], 'channels': []}
        for node, prop in frames[0]:
            data = np.array([frame[node, prop] for frame in frames])
            if prop == 'rotation':
                for i in range(1, len(data)):
                    if data[i-1] @ data[i] < 0: data[i] *= -1
            output = self.accessor(data, 'VEC4' if prop == 'rotation' else 'VEC3')
            clip['channels'].append({'sampler': len(clip['samplers']), 'target': {'node': node, 'path': prop}})
            clip['samplers'].append({'input': time, 'output': output, 'interpolation': 'LINEAR'})
        self.g['animations'] = [a for a in self.g['animations'] if a['name'] != name] + [clip]

    def save(self, path):
        # glTF accessor owners in these self-contained, non-morph assets.
        refs = []
        for mesh in self.g['meshes']:
            for p in mesh['primitives']:
                assert not p.get('targets')
                refs.extend((p['attributes'], key) for key in p['attributes'])
                if 'indices' in p: refs.append((p, 'indices'))
        refs.extend((s, 'inverseBindMatrices') for s in self.g['skins'])
        refs.extend((s, key) for a in self.g['animations'] for s in a['samplers'] for key in ('input', 'output'))
        used = sorted({owner[key] for owner, key in refs})
        accessors = [self.g['accessors'][i] for i in used]
        assert all('sparse' not in a for a in accessors) and not self.g.get('images')
        mapping = {old: i for i, old in enumerate(used)}
        for owner, key in refs: owner[key] = mapping[owner[key]]
        used_views = sorted({a['bufferView'] for a in accessors})
        mapping = {old: i for i, old in enumerate(used_views)}
        views, binary = [], bytearray()
        for old in used_views:
            v = copy.deepcopy(self.g['bufferViews'][old]); start = v.get('byteOffset', 0)
            binary.extend(b'\0' * (-len(binary) % 4)); v['byteOffset'] = len(binary)
            binary.extend(self.binary[start:start + v['byteLength']]); views.append(v)
        for a in accessors: a['bufferView'] = mapping[a['bufferView']]
        self.g['accessors'], self.g['bufferViews'] = accessors, views
        self.g.get('extras', {}).pop('combatBase', None)
        self.g['buffers'][0]['byteLength'] = len(binary)
        encoded = json.dumps(self.g, separators=(',', ':')).encode(); encoded += b' ' * (-len(encoded) % 4)
        binary += b'\0' * (-len(binary) % 4)
        path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(binary)) + struct.pack('<I4s', len(encoded), b'JSON') + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary)
