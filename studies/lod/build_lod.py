"""Generate a geometry LOD from an in-memory copy; never overwrite source assets.

blender -b -t 8 --python studies/lod/build_lod.py -- --role farmer
The exported rig is only a binding reference. Runtime LODs share the original
character's Skeleton, materials and AnimationGroups; no second animation runs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--role', choices=['base', 'farmer', 'infantry', 'cavalry', 'archer'], required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
source = ROOT / ('base-human/base-human' if args.role == 'base' else 'farmer/farmer' if args.role == 'farmer' else f'soldiers/{args.role}/{args.role}')
output = Path(__file__).resolve().parent / f'{args.role}-lod.glb'
source_bytes = source.with_suffix('.glb').read_bytes()
source_sha = hashlib.sha256(source_bytes).hexdigest()

bpy.ops.wm.open_mainfile(filepath=str(source.with_suffix('.blend')))
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
rig.data.pose_position = 'REST'
bpy.context.scene.frame_set(0)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and not obj.hide_render
          and any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers)]
records = []
for obj in meshes:
    obj.data.calc_loop_triangles()
    before = len(obj.data.loop_triangles)
    # Keep small facial details, thin straps and fittings intact. Give the
    # large head more geometry than the less exposed clothing/body surfaces.
    # The farmer's closely spaced crown folds show shading changes before
    # the overall silhouette changes. Keep that surface exactly as authored.
    ratio = 1 if before < 1200 or obj.name.startswith('Headwrap ') else .35 if obj.name.startswith(('Head ', 'Helmet ')) else .22
    if ratio < 1:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('Map detail reduction', 'DECIMATE')
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        while obj.modifiers.find(modifier.name) > 0:
            bpy.ops.object.modifier_move_up(modifier=modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.calc_loop_triangles()
    records.append({'name': obj.name, 'sourceTriangles': before, 'lodTriangles': len(obj.data.loop_triangles)})

bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
    export_apply=False, export_animations=False, export_skins=True, export_extras=True,
    export_yup=True, export_all_influences=False)

def gltf(data):
    length, = struct.unpack_from('<I', data, 12)
    return json.loads(data[20:20 + length])

original, derived = gltf(source_bytes), gltf(output.read_bytes())
def joints(asset):
    return [[asset['nodes'][node]['name'] for node in skin['joints']] for skin in asset['skins']]

if joints(original) != joints(derived):
    raise RuntimeError('LOD joint ordering differs from the source; do not use this asset')
def accessor_bytes(asset, data, index):
    length, = struct.unpack_from('<I', data, 12)
    accessor = asset['accessors'][index]
    view = asset['bufferViews'][accessor['bufferView']]
    start = 28 + length + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return b''.join(data[start + i * view.get('byteStride', 64):start + i * view.get('byteStride', 64) + 64]
                    for i in range(accessor['count']))

derived_bytes = output.read_bytes()
for high, low in zip(original['skins'], derived['skins']):
    if accessor_bytes(original, source_bytes, high['inverseBindMatrices']) != accessor_bytes(derived, derived_bytes, low['inverseBindMatrices']):
        raise RuntimeError('LOD bind matrices differ from the source')
if [node['name'] for node in original['nodes'] if 'mesh' in node] != [node['name'] for node in derived['nodes'] if 'mesh' in node]:
    raise RuntimeError('LOD mesh part identities differ from the source')
if derived.get('animations'):
    raise RuntimeError('LOD must not carry a duplicate animation set')
if hashlib.sha256(source.with_suffix('.glb').read_bytes()).hexdigest() != source_sha:
    raise RuntimeError('Source GLB was unexpectedly modified')
report = {'source': str(source.with_suffix('.glb').relative_to(ROOT.parent)), 'sourceSha256': source_sha,
          'lodSha256': hashlib.sha256(derived_bytes).hexdigest(), 'jointOrderMatches': True, 'bindPoseMatches': True,
          'sourceTriangles': sum(item['sourceTriangles'] for item in records),
          'lodTriangles': sum(item['lodTriangles'] for item in records), 'parts': records}
output.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('LOD_RESULT', args.role, report['sourceTriangles'], report['lodTriangles'], output)
