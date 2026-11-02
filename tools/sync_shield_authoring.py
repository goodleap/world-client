"""Replace only named shield action variants in the maintained Blender source."""
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1]
path = root / 'studies/characters/characters.blend'
bpy.ops.wm.open_mainfile(filepath=str(path))
collections = [bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.collections, bpy.data.images]
original = [set(c) for c in collections]; actions = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=str(root / 'studies/characters/characters.glb'))
new = [a for a in bpy.data.actions if a not in actions]
names = ['ShieldWalk', 'ShieldRun', 'SwordSlash']
rig = bpy.data.objects['BaseHumanRig']
for name in names:
    matches = [a for a in new if a.name.startswith(name + '_')]
    assert len(matches) == 1, (name, [a.name for a in new])
    for track in list(rig.animation_data.nla_tracks):
        if track.name == name: rig.animation_data.nla_tracks.remove(track)
    old = bpy.data.actions.get(name)
    if old in actions:
        if rig.animation_data.action == old: rig.animation_data.action = None
        bpy.data.actions.remove(old)
    action = matches[0]; action.name = name; action.use_fake_user = True
    track = rig.animation_data.nla_tracks.new(); track.name = name; track.mute = True
    track.strips.new(name, 0, action)
for obj in list(bpy.data.objects):
    if obj not in original[0]: bpy.data.objects.remove(obj, do_unlink=True)
for action in new:
    if action.name not in names: bpy.data.actions.remove(action)
for collection, retained in zip(collections[1:], original[1:]):
    for item in list(collection):
        if item not in retained and item.users == 0: collection.remove(item)
assert len(rig.data.bones) == 20 and len(bpy.data.objects['HorseRig'].data.bones) == 17
bpy.context.scene['shield_hold'] = '25 degrees outward, -8 degrees tilt; ShieldWalk, ShieldRun, SwordSlash'
bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
print('Shared Blender shield actions synchronized.')
