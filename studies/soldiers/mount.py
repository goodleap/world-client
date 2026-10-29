"""Mounted poses and a separate pony skeleton appended to the copied rig.

The original 20 human bones, their rest matrices, body meshes and original
Walk/Run actions remain intact. Horse.* bones and Ride* clips are additions.
"""
import bpy
import math
from mathutils import Vector, Matrix, Quaternion
import dressing as d
import mount_motion as motion


def add_bones(rig):
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones=rig.data.edit_bones
    def bone(name,head,tail,parent=None):
        b=bones.new(name);b.head=head;b.tail=tail
        if parent:b.parent=bones[parent]
    bone('Horse.root',(0,0,0),(0,0,.2))
    bone('Horse.body',(0,.10,.60),(0,-.1,.84),'Horse.root')
    bone('Horse.neck',(0,-.35,.76),(0,-.57,1.10),'Horse.body')
    bone('Horse.head',(0,-.57,1.10),(0,-.82,1.12),'Horse.neck')
    bone('Horse.tail',(0,.62,.78),(0,.91,.48),'Horse.body')
    for leg,(x,y,_) in motion.LEGS.items():
        rest=motion.REST[leg]
        knee=(x,y-rest['knee_f'],rest['knee_z'])
        ankle=(x,y,motion.ANKLE_Z)
        bone('Horse.upper.'+leg,(x,y,motion.HIP_Z),knee,'Horse.body')
        bone('Horse.lower.'+leg,knee,ankle,'Horse.upper.'+leg)
        bone('Horse.hoof.'+leg,ankle,(x,y-.12,.06),'Horse.lower.'+leg)
    bpy.ops.object.mode_set(mode='OBJECT')


def location(rig,name,xyz):
    bone=rig.pose.bones[name]
    bone.location=bone.bone.matrix_local.to_3x3().inverted()@Vector(xyz)


def world_rotation(rig,name,rotation):
    bone=rig.pose.bones[name]
    rest=bone.bone.matrix_local.to_3x3()
    if bone.parent:
        parent_rest=bone.parent.bone.matrix_local.to_3x3()
        parent_pose=bone.parent.matrix.to_3x3()
        local=rest.inverted()@parent_rest@parent_pose.inverted()@rotation@rest
    else:local=rest.inverted()@rotation@rest
    bone.rotation_mode='QUATERNION'
    bone.rotation_quaternion=local.to_quaternion()
    bpy.context.view_layer.update()


def apply_pose(rig,name,phase):
    s=motion.pose(name,phase)
    for bone in rig.pose.bones:
        bone.rotation_mode='QUATERNION';bone.rotation_quaternion=Quaternion();bone.location=(0,0,0)
    location(rig,'Horse.root',(0,0,s['bob']))
    location(rig,'root',(0,motion.RIDER_OFFSET[1],motion.RIDER_OFFSET[2]+s['bob']))
    bpy.context.view_layer.update()
    # Short legs straddle the saddle; never stretch or scale the base bones.
    for side,sign in [('L',1),('R',-1)]:
        world_rotation(rig,'thigh.'+side,Matrix.Rotation(-sign*math.radians(65),3,'Y')@Matrix.Rotation(-.24,3,'X'))
        world_rotation(rig,'shin.'+side,Matrix.Rotation(-sign*math.radians(30),3,'Y')@Matrix.Rotation(.08,3,'X'))
        world_rotation(rig,'knee_volume.'+side,Matrix.Rotation(-sign*math.radians(47.5),3,'Y')@Matrix.Rotation(-.08,3,'X'))
        world_rotation(rig,'foot.'+side,Matrix.Rotation(sign*.18,3,'Y'))
    for leg in motion.LEGS:
        current,rest=s['legs'][leg],motion.REST[leg]
        world_rotation(rig,'Horse.upper.'+leg,Matrix.Rotation(current['upper_angle']-rest['upper_angle'],3,'X'))
        world_rotation(rig,'Horse.lower.'+leg,Matrix.Rotation(current['lower_angle']-rest['lower_angle'],3,'X'))
        world_rotation(rig,'Horse.hoof.'+leg,Matrix.Identity(3))
    if name!='RideIdle':
        world_rotation(rig,'Horse.neck',Matrix.Rotation(.016*math.sin(4*math.pi*phase),3,'X'))
        world_rotation(rig,'Horse.head',Matrix.Rotation(.025*math.sin(4*math.pi*phase-.4),3,'X'))
        world_rotation(rig,'Horse.tail',Matrix.Rotation(.07*math.sin(2*math.pi*phase),3,'Z'))
    return s


def actions(rig):
    scene=bpy.context.scene
    scene.render.fps=120
    for name in ['RideIdle','RideWalk','RideRun']:
        action=bpy.data.actions.new(name);action.use_fake_user=True
        rig.animation_data.action=action
        end=1 if name=='RideIdle' else round(motion.GAITS[name]['duration']*120)
        for frame in range(end+1):
            scene.frame_set(frame)
            apply_pose(rig,name,frame/end)
            for bone in rig.pose.bones:
                bone.keyframe_insert(data_path='rotation_quaternion',frame=frame)
                bone.keyframe_insert(data_path='location',frame=frame)
        for curve in action.fcurves:
            for key in curve.keyframe_points:key.interpolation='LINEAR'
    rig.animation_data.action=bpy.data.actions['RideIdle']
    scene.frame_start=0;scene.frame_end=72;scene.frame_set(0)


def proxy(rig):
    orange=d.material('Mount proxy • pony volume',(.73,.46,.24))
    joint=d.material('Mount proxy • limb segments',(.28,.48,.58))
    hoof=d.material('Mount proxy • full hoof volume',(.18,.18,.19))
    d.bind(d.oval('Horse proxy barrel',(0,.10,.72),(.24,.58,.26),orange),bone='Horse.body')
    d.bind(d.oval('Horse proxy head',(0,-.64,1.17),(.29,.27,.29),orange),bone='Horse.head')
    d.bind(d.tube('Horse proxy neck',[(0,-.36,.73),(0,-.50,.98),(0,-.60,1.17)],.15,orange),bone='Horse.neck')
    for leg,(x,y,_) in motion.LEGS.items():
        rest=motion.REST[leg]
        knee=(x,y-rest['knee_f'],rest['knee_z'])
        d.bind(d.tube('Horse proxy upper '+leg,[(x,y,.60),knee],.075,joint),bone='Horse.upper.'+leg)
        d.bind(d.tube('Horse proxy lower '+leg,[knee,(x,y,.12)],.065,joint),bone='Horse.lower.'+leg)
        d.bind(d.rings('Hoof.'+leg,[(.008,x,y-.02,.09,.13),(.018,x,y-.02,.105,.15),(.075,x,y-.015,.102,.14),(.125,x,y,.075,.08)],hoof),bone='Horse.hoof.'+leg)
