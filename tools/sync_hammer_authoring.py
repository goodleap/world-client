"""Sync only the generated Hammer action into the maintained Blender
source; preserve all original geometry, rigs, actions and role collections.
Run: blender -b -t 2 --python tools/sync_hammer_authoring.py
"""
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1]
path = root / 'studies/characters/characters.blend'
bpy.ops.wm.open_mainfile(filepath=str(path))
collections = [bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.collections, bpy.data.images]
original = [set(collection) for collection in collections]
original_actions = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=str(root / 'studies/characters/characters.glb'))
new_actions = [a for a in bpy.data.actions if a not in original_actions]
replaced = {'Hammer': 'BaseHumanRig'}
for name, rig_name in replaced.items():
    rig = bpy.data.objects[rig_name]
    matches = [a for a in new_actions if a.name.startswith(name + '_')]
    assert len(matches) == 1, (name, [a.name for a in new_actions])
    for track in list(rig.animation_data.nla_tracks):
        if track.name == name: rig.animation_data.nla_tracks.remove(track)
    old = bpy.data.actions.get(name)
    if old in original_actions:
        if rig.animation_data.action == old: rig.animation_data.action = None
        bpy.data.actions.remove(old)
    action = matches[0]; action.name = name; action.use_fake_user = True
    track = rig.animation_data.nla_tracks.new(); track.name = name; track.mute = True
    track.strips.new(name, 0, action)
for obj in list(bpy.data.objects):
    if obj not in original[0]: bpy.data.objects.remove(obj, do_unlink=True)
for action in new_actions:
    if action.name not in replaced: bpy.data.actions.remove(action)
for collection, retained in zip(collections[1:], original[1:]):
    for item in list(collection):
        if item not in retained and item.users == 0: collection.remove(item)
assert len(bpy.data.objects['BaseHumanRig'].data.bones) == 20
assert len(bpy.data.objects['HorseRig'].data.bones) == 17
for name in replaced:
    action = bpy.data.actions[name]
    assert abs(float(action.frame_range[1] - action.frame_range[0]) / bpy.context.scene.render.fps - 1) < 1e-4
bpy.ops.wm.save_as_mainfile(filepath=str(path))
print('Shared human source updated: Hammer')
