"""Initialize the single DCC source from the reviewed, lossless shared GLB.

Run only for initial migration: blender -b -t 4 --python
tools/create_character_authoring.py. Future editing uses characters.blend;
re-running this initializer would discard those later authored changes.
"""
import json
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1]
folder = root / 'studies/characters'
output = folder / 'characters.blend'
if output.exists():
    raise RuntimeError('The shared authoring source exists; do not overwrite later edits with historical exports')
catalog = json.loads((folder / 'roles.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(folder / 'characters.glb'))
scene = bpy.context.scene
imported_actions = list(bpy.data.actions)
rigs = [o for o in scene.objects if o.type == 'ARMATURE']
if len(rigs) == 1 and len(rigs[0].data.bones) == 37:
    # Blender 4.3 merges glTF skins beneath a common root when importing.
    # Separate its authoring armatures without changing rest transforms.
    bpy.ops.object.select_all(action='DESELECT')
    rigs[0].select_set(True)
    bpy.context.view_layer.objects.active = rigs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in rigs[0].data.edit_bones:
        bone.select = bone.select_head = bone.select_tail = bone.name.startswith('Horse.')
    bpy.ops.armature.separate()
    bpy.ops.object.mode_set(mode='OBJECT')
    rigs = [o for o in scene.objects if o.type == 'ARMATURE']
assert sorted(len(o.data.bones) for o in rigs) == [17, 20], [(o.name, len(o.data.bones)) for o in rigs]
human = next(o for o in rigs if len(o.data.bones) == 20)
horse = next(o for o in rigs if len(o.data.bones) == 17)
human.name = 'BaseHumanRig'
horse.name = 'HorseRig'
for part_id, info in catalog['parts'].items():
    obj = bpy.data.objects[part_id]
    rig = horse if info['horse'] else human
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world
    for modifier in obj.modifiers:
        if modifier.type == 'ARMATURE':
            modifier.object = rig
# glTF material variants can refer to identical accessor data. Preserve that
# sharing in the DCC source as well, with materials overridden per object.
geometry = {}
for part_id in catalog['parts']:
    obj = bpy.data.objects[part_id]
    key = obj.get('geometryKey')
    assert key, part_id
    materials = [slot.material for slot in obj.material_slots]
    if key in geometry:
        original = geometry[key]
        assert [g.name for g in obj.vertex_groups] == [g.name for g in original.vertex_groups]
        obj.data = original.data
    else:
        geometry[key] = obj
    for slot, material in zip(obj.material_slots, materials):
        slot.link = 'OBJECT'
        slot.material = material
for rig in rigs:
    if rig.animation_data:
        for track in list(rig.animation_data.nla_tracks):
            belongs_to_horse = any('HorseRide' in strip.action.name for strip in track.strips if strip.action)
            if belongs_to_horse != (rig == horse):
                rig.animation_data.nla_tracks.remove(track)
            else:
                track.mute = True
        rig.animation_data.action = None
# Separation may duplicate the current action. Keep only the original imported
# library actions, redirecting any copied stash before removing the extra ID.
for action in list(bpy.data.actions):
    if action in imported_actions:
        continue
    original = next(a for a in imported_actions if action.name.startswith(a.name + '.'))
    action.user_remap(original)
    bpy.data.actions.remove(action)
for action in imported_actions:
    action.name = action.name.removesuffix('_CharacterLibrary')
actions = [a.name for a in bpy.data.actions]
expected = ['Walk', 'Run', 'Hammer', 'CarryWalk', 'CarryRun', 'RideIdle', 'RideWalk', 'RideRun']
for name in expected:
    assert any(a == name or a.startswith(name + '_') for a in actions), (name, actions)
for name in ['HorseRideIdle', 'HorseRideWalk', 'HorseRideRun']:
    assert any(a == name or a.startswith(name + '_') for a in actions), (name, actions)
collections = {}
for role in catalog['roles']:
    collection = bpy.data.collections.new('Role.' + role)
    scene.collection.children.link(collection)
    collections[role] = collection
for part_id, info in catalog['parts'].items():
    obj = bpy.data.objects.get(part_id)
    assert obj and obj.type == 'MESH', part_id
    obj['partId'] = part_id
    obj['originalName'] = info['name']
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    for role, config in catalog['roles'].items():
        if part_id in config['parts']:
            collections[role].objects.link(obj)
# One object can belong to several role collections; edits remain shared.
for layer in bpy.context.view_layer.layer_collection.children:
    if layer.name.startswith('Role.'):
        layer.exclude = layer.name != 'Role.base'
for action in bpy.data.actions:
    action.use_fake_user = True
scene['authoring_policy'] = 'One human rig/action source; role collections reference shared objects. Horse has its own rig/actions. Do not edit historical dressed exports.'
scene['human_actions'] = ','.join(expected)
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
import hashlib
(folder / 'authoring.json').write_text(json.dumps({
    'sourceGLBSha256': hashlib.sha256((folder / 'characters.glb').read_bytes()).hexdigest(),
    'blendSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'rigs': {o.name: len(o.data.bones) for o in rigs},
    'actions': actions,
    'roleCollectionsShareObjects': True,
    'uniqueMeshData': len(geometry),
    'note': 'Canonical DCC source initialized from the lossless runtime library. No re-export from Blender replaces the byte-verified runtime GLBs in this migration. Future exports still require engine validation.'
}, ensure_ascii=False, indent=2) + '\n')
print('CANONICAL_AUTHORING', output, [(o.name, len(o.data.bones)) for o in rigs], actions)
