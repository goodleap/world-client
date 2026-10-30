"""One reusable work clip for the existing BaseHumanRig; no rig/body edits.

Imported by dressed-character builders. The fixed plan is reviewed first on
rigid bone/foot proxies, then on the exported dressed GLB in Babylon.
"""
import json
from pathlib import Path
import bpy
from mathutils import Quaternion, Vector

PLAN = json.loads((Path(__file__).parent / 'hammer-motion-plan.json').read_text())

def pose_at(phase):
    keys = PLAN['keys']
    left, right = next(((a,b) for a,b in zip(keys, keys[1:]) if a['phase'] <= phase <= b['phase']), (keys[-2], keys[-1]))
    t = (phase-left['phase'])/(right['phase']-left['phase'])
    t = t*t*t*(10+t*(-15+6*t))
    return {key: left[key] + (right[key]-left[key])*t for key in ['upper','forearm','wrist','lean']}

def add_hammer_action(rig):
    if bpy.data.actions.get('Hammer'):
        raise RuntimeError('A shared Hammer action already exists; do not duplicate it')
    previous = rig.animation_data.action
    bpy.context.scene.frame_set(0)
    neutral = {p.name: p.location.copy() for p in rig.pose.bones}
    action = bpy.data.actions.new('Hammer')
    action.use_fake_user = True
    rig.animation_data.action = action
    scene = bpy.context.scene
    scene.render.fps = PLAN['fps']
    frames = round(PLAN['duration_seconds']*PLAN['fps'])
    scene.frame_start = 0
    scene.frame_end = max(scene.frame_end, frames)
    def rotate(name, x=0, y=0):
        p = rig.pose.bones[name]
        inverse = p.bone.matrix_local.to_3x3().inverted()
        p.rotation_quaternion = Quaternion(inverse @ Vector((0,1,0)), y) @ Quaternion(inverse @ Vector((1,0,0)), x)
    for frame in range(frames+1):
        q = pose_at(frame/frames)
        for p in rig.pose.bones:
            p.rotation_mode = 'QUATERNION'
            p.rotation_quaternion = Quaternion()
            p.location = neutral[p.name]
        rotate('torso', q['lean'])
        rotate('head', -q['lean']*.65)
        rotate('upper_arm.R', q['upper'], PLAN['upper_arm_outward_radians'])
        rotate('forearm.R', q['forearm'])
        rotate('hand.R', q['wrist'])
        rotate('upper_arm.L', -.10, -.04)
        rotate('forearm.L', -.22)
        for p in rig.pose.bones:
            p.keyframe_insert(data_path='rotation_quaternion', frame=frame)
            p.keyframe_insert(data_path='location', frame=frame)
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    rig.animation_data.action = previous
    scene.frame_set(0)
    return action
