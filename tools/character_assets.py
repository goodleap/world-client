"""Read and audit the project's self-contained glTF 2.0 character exports.

No Blender re-export, decimation or float conversion is performed. Accessor
bytes include normals, colors, UVs, joints and weights, not just positions.
"""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'base': 'studies/base-human/base-human.glb',
    'farmer': 'studies/farmer/farmer.glb',
    **{role: f'studies/soldiers/{role}/{role}.glb' for role in ('infantry', 'archer', 'cavalry')},
}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Asset:
    def __init__(self, path: str | Path):
        self.path = ROOT / path
        self.raw = self.path.read_bytes()
        magic, version, length = struct.unpack_from('<4sII', self.raw)
        assert magic == b'glTF' and version == 2 and length == len(self.raw)
        size, kind = struct.unpack_from('<I4s', self.raw, 12)
        assert kind == b'JSON'
        self.g = json.loads(self.raw[20:20 + size])
        binary_size, kind = struct.unpack_from('<I4s', self.raw, 20 + size)
        assert kind == b'BIN\0'
        self.binary = self.raw[28 + size:28 + size + binary_size]
        assert len(self.g['buffers']) == 1 and 'uri' not in self.g['buffers'][0]
        assert not self.g.get('images'), 'Texture-bearing assets need an explicit audit extension'

    def accessor(self, index: int) -> bytes:
        a = self.g['accessors'][index]
        assert 'sparse' not in a
        view = self.g['bufferViews'][a['bufferView']]
        size = WIDTH[a['type']] * SIZE[a['componentType']]
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', size)
        if stride == size:
            return self.binary[start:start + a['count'] * size]
        return b''.join(self.binary[start + i * stride:start + i * stride + size] for i in range(a['count']))

    def signature(self, index: int) -> str:
        a = self.g['accessors'][index]
        return digest(json.dumps({k: a[k] for k in ('componentType', 'count', 'type', 'normalized') if k in a}, sort_keys=True).encode() + self.accessor(index))

    def parts(self):
        for node in self.g['nodes']:
            if 'mesh' in node:
                mesh = self.g['meshes'][node['mesh']]
                for primitive in mesh['primitives']:
                    yield node, primitive

    def geometry_key(self, primitive: dict) -> str:
        assert not primitive.get('targets')
        return digest(json.dumps({'mode': primitive.get('mode', 4), 'indices': self.signature(primitive['indices']),
            'attributes': {k: self.signature(v) for k, v in primitive['attributes'].items()}}, sort_keys=True).encode())


def audit() -> dict:
    files, unique_geometry, total_geometry = [], {}, 0
    for lod in (False, True):
        for role, path in SOURCES.items():
            asset = Asset(f'studies/lod/{role}-lod.glb' if lod else path)
            g, categories, referenced, geometry_views = asset.g, {}, set(), set()
            def record(category, ids):
                views = {g['accessors'][i]['bufferView'] for i in ids}
                categories.setdefault(category, set()).update(views)
                referenced.update(views)
            for node, primitive in asset.parts():
                for name, index in primitive['attributes'].items():
                    record(name, [index])
                record('indices', [primitive['indices']])
                ids = list(primitive['attributes'].values()) + [primitive['indices']]
                geometry_views.update(g['accessors'][i]['bufferView'] for i in ids)
                size = sum(len(asset.accessor(i)) for i in ids)
                total_geometry += size
                key = asset.geometry_key(primitive)
                entry = unique_geometry.setdefault(key, {'bytes': size, 'uses': []})
                entry['uses'].append({'role': role, 'lod': lod, 'node': node['name']})
            record('animations', [s[k] for a in g.get('animations', []) for s in a['samplers'] for k in ('input', 'output')])
            record('inverseBindMatrices', [s['inverseBindMatrices'] for s in g.get('skins', [])])
            reachable = set()
            def visit(i):
                if i in reachable:
                    return
                reachable.add(i)
                for child in g['nodes'][i].get('children', []):
                    visit(child)
            for scene in g['scenes']:
                for root in scene['nodes']:
                    visit(root)
            files.append({'path': str(asset.path.relative_to(ROOT)), 'bytes': len(asset.raw), 'sha256': digest(asset.raw),
                'categories': {k: sum(g['bufferViews'][i]['byteLength'] for i in v) for k, v in categories.items()},
                'geometryViewBytes': sum(g['bufferViews'][i]['byteLength'] for i in geometry_views),
                'referencedViewBytes': sum(g['bufferViews'][i]['byteLength'] for i in referenced),
                'unusedViews': sorted(set(range(len(g['bufferViews']))) - referenced),
                'unreachableNodes': [n['name'] for i, n in enumerate(g['nodes']) if i not in reachable],
                'unreachableMeshes': sorted(set(range(len(g['meshes']))) - {g['nodes'][i]['mesh'] for i in reachable if 'mesh' in g['nodes'][i]}),
                'images': len(g.get('images', [])), 'clips': [a['name'] for a in g.get('animations', [])]})
    unique_bytes = sum(entry['bytes'] for entry in unique_geometry.values())
    return {'files': files, 'totals': {'fileBytes': sum(f['bytes'] for f in files),
        'animationViewBytes': sum(f['categories']['animations'] for f in files),
        'geometryViewBytes': sum(f['geometryViewBytes'] for f in files),
        'primitiveReferencedBytesIncludingReuse': total_geometry, 'uniquePrimitiveAccessorBytes': unique_bytes,
        'repeatedPrimitiveReferencesBytes': total_geometry - unique_bytes},
        'duplicateGeometry': [entry for entry in unique_geometry.values() if len(entry['uses']) > 1],
        'limits': ['Category sizes are buffer-view unions within each category; categories can overlap.',
            'Geometry duplication compares complete primitives (all attributes and indices), regardless of material.',
            'Primitive-reference totals can count a shared accessor more than once; they are not physical file bytes or a predicted download saving. geometryViewBytes uses a physical buffer-view union per file.',
            'Reachability does not prove that every visible or occluded part is artistically necessary.',
            'File bytes are not HTTP transfer bytes or runtime GPU memory.']}


if __name__ == '__main__':
    result = audit()
    path = ROOT / 'docs/diagnostics/character-data-audit-2026-10-31.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['totals'], indent=2))
    print(f'Wrote {path.relative_to(ROOT)}')
