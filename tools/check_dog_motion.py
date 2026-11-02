"""Check evaluated paws, fixed bone lengths and seams over all exported cycles."""
import bpy,json,math
from pathlib import Path
root=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'studies/dog/dog.blend'))
rig=bpy.data.objects['Village dog'];scene=bpy.context.scene
settings=json.loads((root/'studies/dog/dog.json').read_text());report={}
paws=[o for o in bpy.data.objects if o.name.startswith('Paw ')]
for name,seconds in [('Idle',2.4),('Walk',.8),('Run',.5),('Feed',1.2)]:
    rig.animation_data.action=bpy.data.actions[name];samples=[];min_height=1;length_error=0
    for i in range(121):
        frame=i/120*seconds*30;scene.frame_set(math.floor(frame),subframe=frame%1)
        dg=bpy.context.evaluated_depsgraph_get()
        for ob in paws:
            evaluated=ob.evaluated_get(dg);me=evaluated.to_mesh()
            min_height=min(min_height,min((evaluated.matrix_world@v.co).z for v in me.vertices));evaluated.to_mesh_clear()
        for b in rig.pose.bones:length_error=max(length_error,abs((b.tail-b.head).length-b.bone.length))
        samples.append({b.name:list(b.head) for b in rig.pose.bones})
    seam=max(abs(a-b) for name in samples[0] for a,b in zip(samples[0][name],samples[-1][name]))
    report[name]={'samples':121,'minPawHeight':min_height,'maxBoneLengthError':length_error,'loopSeam':seam}
(root/'studies/dog/motion-check.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
assert all(r['minPawHeight']>-.006 for r in report.values()),'paw penetrates floor'
assert all(r['maxBoneLengthError']<.00001 for r in report.values()),'bone length changed'
assert all(r['loopSeam']<.0001 for r in report.values()),'loop does not close'
assert settings['maxReachClamp']==0,'gait exceeds fixed bone reach'
