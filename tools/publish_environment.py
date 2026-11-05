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
names = ['oak-small', 'oak', 'oak-large', 'pine-small', 'pine', 'pine-large', 'bush', 'reeds', 'grass', 'flowers', 'stone', 'cliff']
stats = {}
for name in names:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'studies/map-art/assets' / (name + '.glb')))
    parts = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    # Keep wood and foliage separate so palette variants share native Geometry
    # and change only their crown's material. Static scenery stays one mesh.
    groups = [[p] for p in parts] if name.startswith(('oak','pine')) else [parts]
    stats[name] = {level:0 for level in ('near','medium','far')}
    for group in groups:
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group)>1:bpy.ops.object.join()
        source = bpy.context.object
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        material = source.data.materials[0]
        source.data.materials.clear()
        source.data.materials.append(material)
        for face in source.data.polygons:face.material_index = 0
        stem = name + ('-' + source['treePart'] if 'treePart' in source else '')
        source.name = stem + '-near'
        source['asset'] = name
        source['detail'] = 'near'
        for level, ratio in [('near', 1), ('medium', .14), ('far', .025)]:
            if level == 'near':
                obj = source
            else:
                obj = source.copy()
                obj.data = source.data.copy()
                bpy.context.collection.objects.link(obj)
                obj.name = stem + '-' + level
                obj['detail'] = level
                bpy.context.view_layer.objects.active = obj
                # Weld only coincident vertices; independent lobes stay separate.
                bm = bmesh.new();bm.from_mesh(obj.data)
                bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00001)
                bm.to_mesh(obj.data);bm.free()
                if len(obj.data.polygons) > 1200:
                    modifier = obj.modifiers.new('Native LOD decimation', 'DECIMATE')
                    modifier.ratio = (.6 if level == 'medium' else .32) if name == 'cliff' else (.25 if level == 'medium' else .065) if source.get('treePart')=='crown' else ratio
                    bpy.ops.object.modifier_apply(modifier=modifier.name)
            stats[name][level] += sum(len(p.vertices) - 2 for p in obj.data.polygons)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT / 'environment.glb'), export_format='GLB',
    use_selection=True, export_extras=True, export_materials='EXPORT',
    export_vertex_color='ACTIVE', export_attributes=False, export_animations=False)
(OUT / 'geometry.json').write_text(json.dumps(stats, indent=2) + '\n')
print('Published environment geometry:', stats)
