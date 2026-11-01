"""Sync generated shared GLB attacks into the existing common Blender source.
Run: blender -b -t 2 --python tools/sync_combat_authoring.py
Only SwordSlash/BowShot actions are replaced. Geometry, rigs and other actions
in characters.blend are preserved. Author recipe stays in combat-actions.json.
"""
from pathlib import Path
import bpy
root=Path(__file__).resolve().parents[1]
path=root/'studies/characters/characters.blend'
bpy.ops.wm.open_mainfile(filepath=str(path))
original_objects=set(bpy.data.objects);original_actions=set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=str(root/'studies/characters/characters.glb'))
new_actions=[a for a in bpy.data.actions if a not in original_actions]
rig=bpy.data.objects['BaseHumanRig']
for name in ('SwordSlash','BowShot'):
    matches=[a for a in new_actions if a.name.startswith(name+'_')]
    assert len(matches)==1, (name,[a.name for a in new_actions])
    for track in list(rig.animation_data.nla_tracks):
        if track.name==name:rig.animation_data.nla_tracks.remove(track)
    old=bpy.data.actions.get(name)
    if old in original_actions:bpy.data.actions.remove(old)
    action=matches[0];action.name=name;action.use_fake_user=True
    track=rig.animation_data.nla_tracks.new();track.name=name;track.mute=True
    track.strips.new(name,0,action)
for obj in list(bpy.data.objects):
    if obj not in original_objects:bpy.data.objects.remove(obj,do_unlink=True)
for action in new_actions:
    if action.name not in ('SwordSlash','BowShot'):bpy.data.actions.remove(action)
bpy.ops.outliner.orphans_purge(do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(path))
print('Common authoring rig now includes SwordSlash and BowShot')
