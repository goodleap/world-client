"""Bind the user-selected v9 geometry to a freshly placed chibi rig.
blender -b ../v9.blend -t 8 --python bind.py
All mesh edits are confined to a visually checked game export; v9 is untouched.
"""
import bpy, math, os, json, sys, argparse
from mathutils import Vector, Quaternion, Matrix
from mathutils.bvhtree import BVHTree

parser=argparse.ArgumentParser();parser.add_argument('--output',default=os.path.dirname(os.path.abspath(__file__)));parser.add_argument('--input')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=os.path.abspath(args.output);os.makedirs(OUT,exist_ok=True)
if args.input:bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.input))
scene=bpy.context.scene
characters=[ob for ob in scene.objects if ob.type in {'MESH','CURVE'} and ob.name!='Review floor']
bpy.ops.object.select_all(action='DESELECT')
for ob in characters:ob.select_set(True)
bpy.context.view_layer.objects.active=characters[0]
bpy.ops.object.convert(target='MESH')
characters=list(bpy.context.selected_objects)
for ob in characters:
    bpy.context.view_layer.objects.active=ob
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)

def bounds(objects):
    xyz=[ob.matrix_world@v.co for ob in objects for v in ob.data.vertices]
    return [[min(v[i] for v in xyz),max(v[i] for v in xyz)] for i in range(3)]
original_bounds=bounds(characters); reports=[]
# User-requested 8% reduction of the whole head, not individual facial features.
# The neck contact plane stays fixed so the smaller head does not float upward.
head_objects=[]
for ob in characters:
    if ob.name.startswith(('Continuous','T-shirt','Shorts •','Short hem','Shirt hem','Neck binding')) or ob.name in {'Neck','Torso skin'}:continue
    head_objects.append(ob.name)
    for v in ob.data.vertices:v.co=Vector((0,0,.85))+.92*(v.co-Vector((0,0,.85)))
head_scaled_bounds=bounds(characters)
for ob in characters:
    # Face and all facial details remain exact. Only dense voxel surfaces and
    # high-resolution trim tubes are simplified using quadric error collapse.
    if ob.name.startswith('Continuous'):target=10000
    elif ob.name.startswith(('T-shirt','Shorts •')):target=18000
    elif ob.name.startswith(('Short hem','Shirt hem','Neck binding')):target=2000
    else:continue
    before=len(ob.data.polygons)*2
    if before<target:continue
    source=BVHTree.FromObject(ob,bpy.context.evaluated_depsgraph_get())
    bpy.context.view_layer.objects.active=ob
    dec=ob.modifiers.new('Dense surface export cleanup','DECIMATE');dec.ratio=min(1,target/before);dec.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=dec.name)
    errors=[]
    for v in list(ob.data.vertices)[::max(1,len(ob.data.vertices)//1000)]:
        hit=source.find_nearest(v.co)
        if hit[0] is not None:errors.append(hit[3])
    reports.append({'object':ob.name,'before_triangles_estimate':before,'after_faces':len(ob.data.polygons),'sampled_surface_distance_max_H':max(errors,default=0)})

arm=bpy.data.armatures.new('BaseHumanSkeleton');rig=bpy.data.objects.new('BaseHumanRig',arm);bpy.context.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
    b=arm.edit_bones.new(name);b.head=head;b.tail=tail
    if parent:b.parent=arm.edit_bones[parent]
    return b
bone('root',(0,0,0),(0,0,.12))
bone('pelvis',(0,0,.35),(0,0,.48),'root')
bone('torso',(0,0,.48),(0,.01,.80),'pelvis')
bone('head',(0,.005,.82),(0,.0188,1.356),'torso')
for s,label in [(1,'L'),(-1,'R')]:
    bone('clavicle.'+label,(s*.075,.008,.775),(s*.245,.01,.745),'torso')
    bone('upper_arm.'+label,(s*.245,.01,.745),(s*.366,.006,.54),'clavicle.'+label)
    bone('forearm.'+label,(s*.366,.006,.54),(s*.401,-.005,.44),'upper_arm.'+label)
    bone('hand.'+label,(s*.401,-.005,.44),(s*.418,-.018,.34),'forearm.'+label)
    bone('thigh.'+label,(s*.143,.006,.38),(s*.163,.008,.215),'pelvis')
    bone('shin.'+label,(s*.163,.008,.215),(s*.18,-.012,.115),'thigh.'+label)
    bone('foot.'+label,(s*.18,-.012,.115),(s*.18,-.20,.045),'shin.'+label)
    # Half-angle deformation bone prevents a 50/50 LBS knee ring from collapsing.
    bone('knee_volume.'+label,(s*.163,.008,.215),(s*.18,-.012,.115),'thigh.'+label)
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True

def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def arm_weights(x,z,label):
    palm=1-smooth(.395,.465,z)
    lower=1-smooth(.49,.60,z)
    shoulder=smooth(.70,.785,z)
    return {'hand.'+label:palm,'forearm.'+label:(1-palm)*lower,'upper_arm.'+label:(1-palm)*(1-lower)*(1-shoulder),'clavicle.'+label:(1-palm)*(1-lower)*shoulder}
def leg_weights(x,y,z,label):
    pelvis=smooth(.30,.405,z)
    lower=1-smooth(.175,.260,z)
    # The entire forefoot/heel shell follows the foot, including its upper
    # surface. Only the upper ankle socket blends toward the shin.
    foot_roof=.120+.032*(1-smooth(-.045,.060,y))
    foot=1-smooth(foot_roof,foot_roof+.032,z)
    # The front kneecap follows a bisecting bone. The inside fold retains more
    # two-segment blending; it must compress rather than balloon into a bead.
    front=1-smooth(-.035,.075,y)
    knee=math.exp(-((z-.215)/.040)**2)*(.58+.35*front)*(1-foot)
    weights={'pelvis':pelvis,'thigh.'+label:(1-pelvis)*(1-knee)*(1-lower),
            'shin.'+label:(1-pelvis)*(1-knee)*lower*(1-foot),
            'foot.'+label:(1-pelvis)*(1-knee)*lower*foot,
            'knee_volume.'+label:(1-pelvis)*knee}
    # The waist skin and its covering shorts must share the same pelvis/thigh
    # field. This only changes the covered upper leg; knee/ankle weights remain.
    upper=smooth(.25,.29,z)
    if upper:
        weights={name:value*(1-upper) for name,value in weights.items()}
        for name,value in hip_weights(x,z).items():weights[name]=weights.get(name,0)+upper*value
    return weights

def hip_weights(x,z):
    influence=1-smooth(.27,.37,z);side=smooth(-.04,.04,x)
    return {'pelvis':1-influence,'thigh.L':influence*side,'thigh.R':influence*(1-side)}
body_surfaces={name:BVHTree.FromObject(bpy.data.objects[name],bpy.context.evaluated_depsgraph_get()) for name in ['Torso skin','Continuous arm and fist.L','Continuous arm and fist.R']}
for ob in characters:
    groups={b.name:ob.vertex_groups.new(name=b.name) for b in arm.bones}
    for v in ob.data.vertices:
        x,y,z=v.co;label='L' if x>=0 else 'R';name=ob.name
        if name.startswith('Continuous arm'):weights=arm_weights(x,z,label)
        elif name.startswith('Continuous leg'):weights=leg_weights(x,y,z,label)
        elif name.startswith(('Shorts •','Short hem')):
            weights=hip_weights(x,z)
        elif name.startswith('T-shirt'):
            # Transfer sleeve deformation from its underlying arm surface;
            # unlike a height-only mask this includes the cuff near the elbow.
            arm_hit=body_surfaces['Continuous arm and fist.'+label].find_nearest(v.co)
            torso_hit=body_surfaces['Torso skin'].find_nearest(v.co)
            lateral=(1-smooth(-.018,.018,arm_hit[3]-torso_hit[3]))*smooth(.53,.59,z)
            pelvis=1-smooth(.40,.56,z)
            weights={'pelvis':(1-lateral)*pelvis,'torso':(1-lateral)*(1-pelvis)}
            for group,w in arm_weights(arm_hit[0].x,arm_hit[0].z,label).items():weights[group]=weights.get(group,0)+lateral*w
        elif name=='Neck':
            head=smooth(.79,.865,z);weights={'torso':1-head,'head':head}
        elif name in {'Torso skin','Shirt hem piping','Neck binding'}:
            if name=='Torso skin' and z<.43:weights=hip_weights(x,z)
            else:
                pelvis=1-smooth(.40,.56,z);weights={'pelvis':pelvis,'torso':1-pelvis}
        else:weights={'head':1}
        total=sum(weights.values())
        for group,w in weights.items():
            if w>1e-6:groups[group].add([v.index],w/total,'REPLACE')
    mod=ob.modifiers.new('BaseHuman deformation','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=False
    ob.parent=rig
    ob['source_revision']='v9';ob['status']='user-selected demo preview'

def clear_pose():
    for p in rig.pose.bones:p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion();p.location=(0,0,0)
def rotate(name,axis,angle):
    p=rig.pose.bones[name];axis=p.bone.matrix_local.to_3x3().inverted()@Vector(axis);p.rotation_quaternion=Quaternion(axis,angle)
def world_location(name,vector):rig.pose.bones[name].location=rig.pose.bones[name].bone.matrix_local.to_3x3().inverted()@Vector(vector)
def floor_height():
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    return min((ob.matrix_world@v.co).z for ob in characters if ob.name.startswith('Continuous leg') for v in ob.evaluated_get(dg).data.vertices)

# 0.5 second loop: short chibi legs need a brisk cadence at the demo speed.
# It is an in-place animation; navigation remains responsible for displacement.
scene.render.fps=120;scene.frame_start=0;scene.frame_end=60
for frame in range(0,61):
    phase=frame/60*2*math.pi;clear_pose()
    for label,sign in [('L',1),('R',-1)]:
        swing=sign*math.sin(phase)
        thigh=.40*swing;knee=.20*max(0,-swing)**2
        rotate('thigh.'+label,(1,0,0),thigh)
        rotate('shin.'+label,(1,0,0),knee)
        rotate('knee_volume.'+label,(1,0,0),knee*.5)
        rotate('foot.'+label,(1,0,0),-thigh-knee)
        rotate('upper_arm.'+label,(1,0,0),-.18*swing)
        rotate('forearm.'+label,(1,0,0),-.06*max(0,swing))
    world_location('root',(0,0,.008-floor_height()))
    for p in rig.pose.bones:
        p.keyframe_insert(data_path='rotation_quaternion',frame=frame)
        p.keyframe_insert(data_path='location',frame=frame)
walk_action=rig.animation_data.action;walk_action.name='Walk';walk_action.use_fake_user=True
for f in walk_action.fcurves:
    for key in f.keyframe_points:key.interpolation='LINEAR'
scene.frame_set(0)

# The independently reviewed skeleton/rigid-foot motion is the single source
# of truth. No second foot trajectory, per-frame fitting, pelvis roll, or floor
# snapping is applied when the approved proxy is bound to the character mesh.
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import rig_motion as motion
motion.review()
RUN_DURATION=motion.DURATION;RUN_SPEED=motion.SPEED;RUN_FRAMES=54
run_action=bpy.data.actions.new('Run');run_action.use_fake_user=True;rig.animation_data.action=run_action
run_floor_samples=[];run_phase_report=[]
for frame in range(RUN_FRAMES+1):
    t=frame/RUN_FRAMES;sample=motion.pose(t);clear_pose()
    world_location('root',(0,0,sample['hip_z']-.38))
    rotate('torso',(1,0,0),math.radians(12)+math.radians(1)*math.sin(4*math.pi*t-.6))
    rotate('head',(1,0,0),-math.radians(4)-math.radians(.5)*math.sin(4*math.pi*t-.85))
    for label,offset in [('L',0),('R',.5)]:
        leg=sample[label]
        if 'unreachable' in leg:raise RuntimeError('Reviewed proxy became unreachable')
        thigh=leg['thigh_world'];shin=leg['shin_world'];foot=leg['foot_pitch']
        rotate('thigh.'+label,(1,0,0),thigh)
        rotate('shin.'+label,(1,0,0),shin-thigh)
        rotate('foot.'+label,(1,0,0),foot-shin)
        rotate('knee_volume.'+label,(1,0,0),.5*(shin-thigh))
        phase=(t+offset)%1
        arm_swing=motion.curve([(0,.34),(.24,-.12),(.43,-.46),(.62,-.26),(.82,.30),(1,.34)],phase)
        rotate('upper_arm.'+label,(1,0,0),arm_swing)
        rotate('forearm.'+label,(1,0,0),-math.radians(60)+math.radians(4)*math.sin(2*math.pi*phase))
    floor=floor_height();run_floor_samples.append(floor)
    run_phase_report.append({'phase':t,'frame':frame,'root_z':sample['hip_z']-.38,'floor_H':floor,'knees_degrees':{label:sample[label]['knee_flexion_deg'] for label in ['L','R']}})
    for p in rig.pose.bones:
        p.keyframe_insert(data_path='rotation_quaternion',frame=frame)
        p.keyframe_insert(data_path='location',frame=frame)
for f in run_action.fcurves:
    for key in f.keyframe_points:key.interpolation='LINEAR'
rig.animation_data.action=walk_action;scene.frame_set(0)

# Export the model with the actual skin and animation, no studio lights/floor.
bpy.ops.object.select_all(action='DESELECT')
for ob in characters+[rig]:ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'base-human-v4-rig.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'base-human-v4-rig.glb'),export_format='GLB',use_selection=True,export_apply=False,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_frame_range=True,export_force_sampling=True,export_skins=True,export_extras=True,export_yup=True,export_anim_slide_to_zero=True)

scene.cycles.samples=16;scene.cycles.use_denoising=False;scene.cycles.adaptive_threshold=.03
scene.render.resolution_x=600;scene.render.resolution_y=736
cam=scene.camera
def render(name,pos,target=(0,0,.93),scale=2.16):
    cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale
    scene.render.filepath=os.path.join(OUT,name+'.png');bpy.ops.render.render(write_still=True)
views=set(os.environ.get('RIG_REVIEW_VIEWS','rest-front,rest-side').split(','))
scene.frame_set(0)
if 'rest-front' in views:render('rest-front',(0,-7,1.08))
if 'rest-side' in views:render('rest-side',(7,-1.88,1.08))
scene.frame_set(7)
if 'walk-side' in views:render('walk-side',(7,-1.88,1.08))
if 'walk-game' in views:render('walk-game',(3,-7,4.3),scale=2.35)
rig.animation_data.action=run_action;scene.frame_set(5)
if 'run-side' in views:render('run-side',(7,-1.88,1.08))
if 'run-game' in views:render('run-game',(3,-7,4.3),scale=2.35)
scene.frame_set(0)
if 'run-landing' in views:render('run-landing',(7,-1.88,1.08))
rig.animation_data.action=None;clear_pose()
for label,sign in [('L',1),('R',-1)]:
    rotate('clavicle.'+label,(0,1,0),-sign*.10)
    rotate('upper_arm.'+label,(0,1,0),-sign*1.22)
    rotate('forearm.'+label,(0,1,0),-sign*.20)
if 'arms-raised' in views:render('arms-raised',(0,-7,1.08),scale=2.4)
clear_pose();rotate('upper_arm.L',(1,0,0),-.25);rotate('forearm.L',(1,0,0),-1.0);rotate('thigh.L',(1,0,0),.40);rotate('shin.L',(1,0,0),.80)
if 'elbow-knee' in views:render('elbow-knee',(7,-3.2,1.12))
clear_pose();rig.animation_data.action=walk_action;scene.frame_set(0)
triangles=0
for ob in characters:
    ob.data.calc_loop_triangles();triangles+=len(ob.data.loop_triangles)
report={'revision':'binding-4-candidate-6-waist-upper-body','bone_count':len(arm.bones),'bones':[b.name for b in arm.bones],
'animations':{'Walk':{'duration_seconds':.5,'navigation_speed_reference':1.15,'starts_at_rest':True,'change':'Knee flexion sign corrected, knee volume helpers added.'},
'Run':{'duration_seconds':RUN_DURATION,'navigation_speed_reference':RUN_SPEED,'starts_at_rest':False,'stop_restore':'Stop Run, then reset Walk to its neutral first frame.','stance_fraction_per_leg':motion.SUPPORT,'authored_stance_foot_speed':RUN_SPEED,'flight_floor_range_H':[min(run_floor_samples),max(run_floor_samples)]}},
'head':{'scale':.92,'anchor':[0,0,.85],'objects':head_objects},'original_bounds':original_bounds,'head_scaled_bounds':head_scaled_bounds,'runtime_rest_bounds':bounds(characters),
'run_phases':run_phase_report,'motion_source':'rig_motion.py','ik_reach_clamps':[],'triangles':triangles,'simplification':reports,
'note':'Head reduced uniformly. Run binds the independently reviewed fixed-branch skeleton/rigid-foot plan, sampled at 120 fps; full skinned-motion review is separate. No dual-quaternion assumption.'}
with open(os.path.join(OUT,'rig-report.json'),'w') as f:json.dump(report,f,indent=2)
with open(os.path.join(OUT,'animation-metadata.json'),'w') as f:json.dump({'revision':report['revision'],'animations':report['animations']},f,indent=2)
print('RIG_COMPLETE',json.dumps(report))
