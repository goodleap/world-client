"""One-time, lossless migration of historical dressed exports to one library.

The output is ordinary glTF 2.0, loaded by Babylon's built-in loader. Historical
files remain comparison fixtures, not the new library's animation sources.
Run explicitly after reviewing sources; normal app builds never run migration.
"""
from copy import deepcopy
import argparse
import json
import struct
from pathlib import Path

from character_assets import ROOT, SOURCES, Asset, digest


class Writer:
    def __init__(self):
        self.g = {'asset': {'version': '2.0', 'generator': 'world-client lossless library migration'},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': 'CharacterLibrary', 'children': []}],
            'meshes': [], 'materials': [], 'skins': [], 'animations': [], 'accessors': [], 'bufferViews': [],
            'extensionsUsed': ['KHR_materials_specular']}
        self.binary = bytearray()
        self.accessors, self.materials, self.nodes = {}, {}, {}

    def accessor(self, asset, index, data=None, count=None):
        a = deepcopy(asset.g['accessors'][index])
        for key in ('bufferView', 'byteOffset', 'name'):
            a.pop(key, None)
        if count is not None:
            a['count'] = count
        data = asset.accessor(index) if data is None else data
        key = digest(json.dumps(a, sort_keys=True).encode() + data)
        if key not in self.accessors:
            self.binary.extend(b'\0' * (-len(self.binary) % 4))
            a['bufferView'] = len(self.g['bufferViews'])
            self.g['bufferViews'].append({'buffer': 0, 'byteOffset': len(self.binary), 'byteLength': len(data)})
            self.binary.extend(data)
            self.accessors[key] = len(self.g['accessors'])
            self.g['accessors'].append(a)
        return self.accessors[key]

    def rig(self, source, horse=False):
        joint_ids = [i for i in source.g['skins'][0]['joints'] if source.g['nodes'][i]['name'].startswith('Horse.') == horse]
        start = len(self.g['nodes'])
        ids = {old: start + i for i, old in enumerate(joint_ids)}
        for old in joint_ids:
            node = deepcopy(source.g['nodes'][old])
            if node.get('children'):
                node['children'] = [ids[i] for i in node['children']]
            self.nodes[node['name']] = len(self.g['nodes'])
            self.g['nodes'].append(node)
        self.g['nodes'][0]['children'].append(start)
        ibm = source.g['skins'][0]['inverseBindMatrices']
        original = source.accessor(ibm)
        data = b''.join(original[i * 64:(i + 1) * 64] for i, node in enumerate(source.g['skins'][0]['joints']) if node in ids)
        self.g['skins'].append({'name': 'HorseRig' if horse else 'BaseHumanRig',
            'joints': list(ids.values()), 'inverseBindMatrices': self.accessor(source, ibm, data, len(ids))})

    def material(self, source, index):
        m = source.g['materials'][index]
        key = json.dumps(m, sort_keys=True)
        if key not in self.materials:
            self.materials[key] = len(self.g['materials'])
            self.g['materials'].append(deepcopy(m))
        return self.materials[key]

    def part(self, source, node, primitive, part_id, horse):
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale'))
        p = deepcopy(primitive)
        p['indices'] = self.accessor(source, p['indices'])
        p['material'] = self.material(source, p['material'])
        p['attributes'] = {key: self.accessor(source, index,
            bytes(max(0, joint - 20) for joint in source.accessor(index)) if horse and key == 'JOINTS_0' else None)
            for key, index in primitive['attributes'].items()}
        if horse:
            assert source.g['accessors'][primitive['attributes']['JOINTS_0']]['componentType'] == 5121
        self.g['nodes'][0]['children'].append(len(self.g['nodes']))
        self.g['nodes'].append({'name': part_id, 'mesh': len(self.g['meshes']), 'skin': int(horse),
            'extras': {'partId': part_id, 'originalName': node['name'], 'geometryKey': source.geometry_key(primitive), 'horse': horse}})
        self.g['meshes'].append({'name': part_id, 'primitives': [p]})

    def animation(self, source, old_name, name, horse=False):
        old = next(a for a in source.g['animations'] if a['name'] == old_name)
        clip = {'name': name, 'channels': [], 'samplers': []}
        for c in old['channels']:
            node = source.g['nodes'][c['target']['node']]['name']
            if node.startswith('Horse.') != horse:
                continue
            s = old['samplers'][c['sampler']]
            clip['channels'].append({'sampler': len(clip['samplers']), 'target': {'node': self.nodes[node], 'path': c['target']['path']}})
            clip['samplers'].append({**s, 'input': self.accessor(source, s['input']), 'output': self.accessor(source, s['output'])})
        self.g['animations'].append(clip)

    def write(self, path):
        if not self.g['animations']:
            del self.g['animations']
        self.g['buffers'] = [{'byteLength': len(self.binary)}]
        doc = json.dumps(self.g, ensure_ascii=False, separators=(',', ':')).encode()
        doc += b' ' * (-len(doc) % 4)
        binary = bytes(self.binary) + b'\0' * (-len(self.binary) % 4)
        data = struct.pack('<4sII', b'glTF', 2, 28 + len(doc) + len(binary)) + struct.pack('<I4s', len(doc), b'JSON') + doc
        data += struct.pack('<I4s', len(binary), b'BIN\0') + binary
        path.write_bytes(data)
        return {'bytes': len(data), 'sha256': digest(data)}


def horse_part(source, primitive):
    joints = source.accessor(primitive['attributes']['JOINTS_0'])
    weights = struct.iter_unpack('<f', source.accessor(primitive['attributes']['WEIGHTS_0']))
    kinds = {j >= 20 for j, (w,) in zip(joints, weights) if w > 0}
    assert len(kinds) == 1, 'A mesh spans human and horse rigs; splitting requires a separate review'
    return kinds.pop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Use a separate directory when reproducing the historical migration')
    args = parser.parse_args()
    out = args.output or ROOT / 'studies/characters'
    if (out / 'characters.glb').exists():
        raise RuntimeError('Output exists. Do not overwrite the maintained library from historical exports; use a fresh --output directory.')
    high = {role: Asset(path) for role, path in SOURCES.items()}
    low = {role: Asset(f'studies/lod/{role}-lod.glb') for role in SOURCES}
    writers = [Writer(), Writer()]
    for writer in writers:
        writer.rig(high['base'])
        writer.rig(high['cavalry'], horse=True)
    roles, registry, parts, origin = {}, {}, {}, []
    for role, source in high.items():
        roles[role] = {'parts': [], 'walk': 'CarryWalk' if role in ('infantry', 'archer') else 'RideWalk' if role == 'cavalry' else 'Walk',
            'run': 'CarryRun' if role in ('infantry', 'archer') else 'RideRun' if role == 'cavalry' else 'Run', 'mounted': role == 'cavalry'}
        high_parts, low_parts = list(source.parts()), list(low[role].parts())
        assert len(high_parts) == len(low_parts)
        for ordinal, ((node, primitive), (lod_node, lod_primitive)) in enumerate(zip(high_parts, low_parts)):
            assert node['name'] == lod_node['name']
            horse = horse_part(source, primitive)
            assert horse_part(low[role], lod_primitive) == horse
            material = source.g['materials'][primitive['material']]
            assert material == low[role].g['materials'][lod_primitive['material']]
            key = (source.geometry_key(primitive), low[role].geometry_key(lod_primitive), json.dumps(material, sort_keys=True), horse, node['name'])
            if key not in registry:
                part_id = f'part-{len(registry):03d}'
                registry[key] = part_id
                parts[part_id] = {'name': node['name'], 'horse': horse}
                for writer, asset, part_node, p in zip(writers, (source, low[role]), (node, lod_node), (primitive, lod_primitive)):
                    writer.part(asset, part_node, p, part_id, horse)
            part_id = registry[key]
            roles[role]['parts'].append(part_id)
            origin.append({'role': role, 'ordinal': ordinal, 'part': part_id})
    clips = [('base', 'Walk', 'Walk'), ('base', 'Run', 'Run'), ('farmer', 'Hammer', 'Hammer'),
        ('infantry', 'Walk', 'CarryWalk'), ('infantry', 'Run', 'CarryRun'),
        *[('cavalry', name, name) for name in ('RideIdle', 'RideWalk', 'RideRun')]]
    for role, old, name in clips:
        writers[0].animation(high[role], old, name)
    for name in ('RideIdle', 'RideWalk', 'RideRun'):
        writers[0].animation(high['cavalry'], name, 'Horse' + name, horse=True)
    out.mkdir(exist_ok=True, parents=True)
    outputs = {name: writer.write(out / name) for name, writer in zip(('characters.glb', 'characters-lod.glb'), writers)}
    (out / 'roles.json').write_text(json.dumps({'roles': roles, 'parts': parts}, ensure_ascii=False, indent=2) + '\n')
    manifest = {'method': 'Lossless accessor reuse; separate 20-bone human and 17-bone horse skins. No geometry simplification or animation resampling.',
        'sources': {str(a.path.relative_to(ROOT)): digest(a.raw) for a in [*high.values(), *low.values()]},
        'outputs': outputs, 'origin': origin, 'humanActions': [name for _, _, name in clips]}
    (out / 'migration.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(outputs, indent=2))
    print('Original bytes:', sum(len(a.raw) for a in [*high.values(), *low.values()]))
    print('Library bytes:', sum(o['bytes'] for o in outputs.values()), 'parts:', len(parts))


if __name__ == '__main__':
    main()
