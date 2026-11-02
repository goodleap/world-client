"""Inspect evaluated Blender skin and rig across the entire exported source cycle."""
import bpy, json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'studies/wolf/wolf.blend'))
rig=bpy.data.objects['Wolf'];scene=bpy.context.scene
rig.animation_data.action=bpy.data.actions['Run']
settings=json.loads((ROOT/'studies/wolf/wolf.json').read_text())
duration=settings['motion']['duration']; samples=[]; min_height=1; max_length_error=0
paws=[o for o in bpy.data.objects if o.name.startswith('Paw ')]
for i in range(121):
    phase=i/120;frame=phase*duration*30
    scene.frame_set(math.floor(frame),subframe=frame%1)
    dg=bpy.context.evaluated_depsgraph_get()
    for ob in paws:
        evaluated=ob.evaluated_get(dg);me=evaluated.to_mesh()
        height=min((evaluated.matrix_world @ v.co).z for v in me.vertices)
        min_height=min(min_height,height);evaluated.to_mesh_clear()
    for bone in rig.pose.bones:
        a=rig.matrix_world@bone.head;b=rig.matrix_world@bone.tail
        max_length_error=max(max_length_error,abs((b-a).length-bone.bone.length*settings['scale']))
    samples.append({b.name:list(rig.matrix_world@b.head) for b in rig.pose.bones})
seam=max(abs(a-b) for name in samples[0] for a,b in zip(samples[0][name],samples[-1][name]))
report={'samples':len(samples),'minPawHeight':min_height,'maxBoneLengthError':max_length_error,'loopSeam':seam,
    'reachClamp':settings['maxReachClamp'],'referenceSpeed':settings['motion']['referenceSpeed']}
(ROOT/'studies/wolf/motion-check.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
assert min_height>-.006, 'paw penetrates the floor'
assert max_length_error<.00001, 'bone length changed'
assert seam<.0001, 'loop does not close'
assert settings['maxReachClamp']==0, 'gait exceeds fixed bone reach'
