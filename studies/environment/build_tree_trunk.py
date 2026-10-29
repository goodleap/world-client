"""Blender 4.3: build the continuous trunk used by src/game/tree.ts.

Reference: approved terrain/plant sheet, rounded broadleaf tree.
Run: blender --background --factory-startup --python studies/environment/build_tree_trunk.py
No third-party asset or add-on is used. Output uses Babylon's Y-up coordinates.
"""
import bpy
import json
import math
from pathlib import Path

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
parts = []

def branch(points, radii):
    curve = bpy.data.curves.new('branch', 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 12
    curve.bevel_depth = 1
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, co, radius in zip(spline.bezier_points, points, radii):
        point.co = (co[0], -co[2], co[1])
        point.radius = radius
        point.handle_left_type = point.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new('branch', curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    parts.append(bpy.context.object)
    obj.select_set(False)

branch([[0, .04, 0], [-.06, .38, 0], [.02, .95, .03], [-.1, 1.52, .07], [.04, 2.3, .06], [.19, 2.9, .08]], [.37, .29, .23, .2, .14, .07])
branch([[0, .95, .04], [-.25, 1.39, .01], [-.65, 1.7, .02], [-1.03, 2.22, .06]], [.22, .18, .14, .06])
branch([[-.03, 1.37, .06], [.33, 1.63, .09], [.7, 1.98, .15], [1.05, 2.48, .18]], [.2, .17, .12, .05])
for i in range(5):
    a = i * math.tau / 5 + .2
    dx, dz = math.cos(a), math.sin(a)
    branch([[dx*.07, .46, dz*.07], [dx*.25, .18, dz*.25], [dx*.48, .045, dz*.48]], [.18, .15, .065])
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
trunk = bpy.context.object
trunk.name = 'Continuous reference tree trunk'
remesh = trunk.modifiers.new('Fuse roots and forks', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = .042
bpy.ops.object.modifier_apply(modifier=remesh.name)
smooth = trunk.modifiers.new('Round junctions', 'SMOOTH')
smooth.factor = 1.25
smooth.iterations = 7
bpy.ops.object.modifier_apply(modifier=smooth.name)
for poly in trunk.data.polygons:
    poly.use_smooth = True
trunk.data.calc_loop_triangles()

def yup(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]

data = {
    'positions': [n for v in trunk.data.vertices for n in yup(v.co)],
    'normals': [n for v in trunk.data.vertices for n in yup(v.normal)],
    'indices': [i for tri in trunk.data.loop_triangles for i in (tri.vertices[0], tri.vertices[2], tri.vertices[1])],
}
out = Path(__file__).resolve().parents[2] / 'src/game/tree-trunk.json'
out.write_text(json.dumps(data, separators=(',', ':')) + '\n')
print(f'Trunk: {len(trunk.data.vertices)} vertices; saved {out}')
