"""Publish the approved Blender samples as shared native Babylon LOD meshes.

blender -b -t 2 --factory-startup --python tools/publish_environment.py
The near level retains the approved geometry; simplification only affects LODs.
"""
import bpy
import bmesh
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/environment'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
names = ['oak', 'sapling', 'fruit', 'blossom', 'pine', 'bush', 'reeds', 'grass', 'flowers', 'stone', 'cliff']
stats = {}
for name in names:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'studies/map-art/assets' / (name + '.glb')))
    parts = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    source = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    material = source.data.materials[0]
    source.data.materials.clear()
    source.data.materials.append(material)
    for face in source.data.polygons:
        face.material_index = 0
    source.name = name + '-near'
    source['asset'] = name
    source['detail'] = 'near'
    stats[name] = {}
    for level, ratio in [('near', 1), ('medium', .14), ('far', .025)]:
        if level == 'near':
            obj = source
        else:
            obj = source.copy()
            obj.data = source.data.copy()
            bpy.context.collection.objects.link(obj)
            obj.name = name + '-' + level
            obj['detail'] = level
            bpy.context.view_layer.objects.active = obj
            # glTF splits vertices at normal/color seams. Weld equal positions
            # before simplification so disconnected triangle corners do not
            # prevent Blender's edge-collapse operation.
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00001)
            bm.to_mesh(obj.data)
            bm.free()
            # Keep already inexpensive rocks and small grass intact.
            if len(obj.data.polygons) > 1200:
                modifier = obj.modifiers.new('Native LOD decimation', 'DECIMATE')
                modifier.ratio = (0.6 if level == 'medium' else 0.32) if name == 'cliff' else ratio
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        stats[name][level] = sum(len(p.vertices) - 2 for p in obj.data.polygons)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT / 'environment.glb'), export_format='GLB',
    use_selection=True, export_extras=True, export_materials='EXPORT',
    export_vertex_color='ACTIVE', export_attributes=False, export_animations=False)
(OUT / 'geometry.json').write_text(json.dumps(stats, indent=2) + '\n')
print('Published environment geometry:', stats)
