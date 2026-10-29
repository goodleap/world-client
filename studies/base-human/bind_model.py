"""Bind the user-selected v9 geometry to a freshly placed chibi rig.
blender -b ../v9.blend -t 8 --python bind.py
All mesh edits are confined to a visually checked game export; v9 is untouched.
"""
import bpy, math, os, json, sys, argparse
from mathutils import Vector, Quaternion
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
bone('head',(0,.005,.82),(0,.02,1.40),'torso')
for s,label in [(1,'L'),(-1,'R')]:
    bone('clavicle.'+label,(s*.075,.008,.775),(s*.245,.01,.745),'torso')
    bone('upper_arm.'+label,(s*.245,.01,.745),(s*.366,.006,.54),'clavicle.'+label)
    bone('forearm.'+label,(s*.366,.006,.54),(s*.401,-.005,.44),'upper_arm.'+label)
    bone('hand.'+label,(s*.401,-.005,.44),(s*.418,-.018,.34),'forearm.'+label)
    bone('thigh.'+label,(s*.143,.006,.38),(s*.163,.008,.20),'pelvis')
    bone('shin.'+label,(s*.163,.008,.20),(s*.18,-.020,.08),'thigh.'+label)
    bone('foot.'+label,(s*.18,-.020,.08),(s*.18,-.20,.045),'shin.'+label)
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True

def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def arm_weights(x,z,label):
    palm=1-smooth(.395,.465,z)
    lower=1-smooth(.49,.60,z)
    shoulder=smooth(.70,.785,z)
    return {'hand.'+label:palm,'forearm.'+label:(1-palm)*lower,'upper_arm.'+label:(1-palm)*(1-lower)*(1-shoulder),'clavicle.'+label:(1-palm)*(1-lower)*shoulder}
def leg_weights(z,label):
    pelvis=smooth(.30,.405,z)
    shin=1-smooth(.15,.235,z)
    foot=1-smooth(.065,.125,z)
    return {'pelvis':pelvis,'thigh.'+label:(1-pelvis)*(1-shin),'shin.'+label:(1-pelvis)*shin*(1-foot),'foot.'+label:(1-pelvis)*shin*foot}
def hip_weights(x,z):
    influence=1-smooth(.27,.37,z);side=smooth(-.04,.04,x)
    return {'pelvis':1-influence,'thigh.L':influence*side,'thigh.R':influence*(1-side)}
body_surfaces={name:BVHTree.FromObject(bpy.data.objects[name],bpy.context.evaluated_depsgraph_get()) for name in ['Torso skin','Continuous arm and fist.L','Continuous arm and fist.R']}
for ob in characters:
    groups={b.name:ob.vertex_groups.new(name=b.name) for b in arm.bones}
    for v in ob.data.vertices:
        x,y,z=v.co;label='L' if x>=0 else 'R';name=ob.name
        if name.startswith('Continuous arm'):weights=arm_weights(x,z,label)
        elif name.startswith('Continuous leg'):weights=leg_weights(z,label)
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
scene.render.fps=48;scene.frame_start=1;scene.frame_end=25
for frame in range(1,26):
    phase=(frame-1)/24*2*math.pi;clear_pose()
    for label,sign in [('L',1),('R',-1)]:
        swing=sign*math.sin(phase)
        thigh=.40*swing;knee=.20*max(0,-swing)**2
        rotate('thigh.'+label,(1,0,0),thigh)
        rotate('shin.'+label,(1,0,0),-knee)
        rotate('foot.'+label,(1,0,0),-thigh+knee)
        rotate('upper_arm.'+label,(1,0,0),-.18*swing)
        rotate('forearm.'+label,(1,0,0),-.06*max(0,swing))
    world_location('root',(0,0,.008-floor_height()))
    for p in rig.pose.bones:
        p.keyframe_insert(data_path='rotation_quaternion',frame=frame)
        p.keyframe_insert(data_path='location',frame=frame)
walk_action=rig.animation_data.action;walk_action.name='Walk';walk_action.use_fake_user=True
for f in walk_action.fcurves:
    for key in f.keyframe_points:key.interpolation='LINEAR'
scene.frame_set(1)

# Run is an independent gait, not a faster Walk: forward torso lean, flexed
# elbows, stronger alternating knee recovery, and brief flight between supports.
run_action=bpy.data.actions.new('Run');run_action.use_fake_user=True;rig.animation_data.action=run_action
run_floor_samples=[]
for frame in range(1,18):
    phase=(frame-1)/16*2*math.pi;clear_pose()
    rotate('torso',(1,0,0),.12)
    rotate('head',(1,0,0),-.05)
    for label,sign in [('L',1),('R',-1)]:
        swing=sign*math.sin(phase);recovery=max(0,-sign*math.cos(phase))
        thigh=.60*swing;knee=.12+.90*recovery**2+.25*max(0,swing)**2
        rotate('thigh.'+label,(1,0,0),thigh)
        rotate('shin.'+label,(1,0,0),knee)
        ankle=max(-.60,min(.55,-thigh-knee+.35*max(0,swing)))
        rotate('foot.'+label,(1,0,0),ankle)
        rotate('upper_arm.'+label,(1,0,0),-.34*swing-.06)
        rotate('forearm.'+label,(1,0,0),-.66-.12*max(0,swing))
    flight=.05*(max(0,math.sin(phase)**2-.45)/.55)**1.2
    world_location('root',(0,0,.008-floor_height()+flight))
    run_floor_samples.append(.008+flight)
    for p in rig.pose.bones:
        p.keyframe_insert(data_path='rotation_quaternion',frame=frame)
        p.keyframe_insert(data_path='location',frame=frame)
for f in run_action.fcurves:
    for key in f.keyframe_points:key.interpolation='LINEAR'
rig.animation_data.action=walk_action;scene.frame_set(1)

# Export the model with the actual skin and animation, no studio lights/floor.
bpy.ops.object.select_all(action='DESELECT')
for ob in characters+[rig]:ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'base-human-v9-rig.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'base-human-v9-rig.glb'),export_format='GLB',use_selection=True,export_apply=False,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_frame_range=True,export_force_sampling=True,export_skins=True,export_extras=True,export_yup=True)

scene.cycles.samples=64;scene.cycles.adaptive_threshold=.03
scene.render.resolution_x=600;scene.render.resolution_y=736
cam=scene.camera
def render(name,pos,target=(0,0,.93),scale=2.16):
    cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale
    scene.render.filepath=os.path.join(OUT,name+'.png');bpy.ops.render.render(write_still=True)
views=set(os.environ.get('RIG_REVIEW_VIEWS','rest-front,rest-side,walk-side,walk-game,run-side,run-game,run-landing,arms-raised,elbow-knee').split(','))
scene.frame_set(1)
if 'rest-front' in views:render('rest-front',(0,-7,1.08))
if 'rest-side' in views:render('rest-side',(7,-1.88,1.08))
scene.frame_set(7)
if 'walk-side' in views:render('walk-side',(7,-1.88,1.08))
if 'walk-game' in views:render('walk-game',(3,-7,4.3),scale=2.35)
rig.animation_data.action=run_action;scene.frame_set(5)
if 'run-side' in views:render('run-side',(7,-1.88,1.08))
if 'run-game' in views:render('run-game',(3,-7,4.3),scale=2.35)
scene.frame_set(1)
if 'run-landing' in views:render('run-landing',(7,-1.88,1.08))
rig.animation_data.action=None;clear_pose()
for label,sign in [('L',1),('R',-1)]:
    rotate('clavicle.'+label,(0,1,0),-sign*.10)
    rotate('upper_arm.'+label,(0,1,0),-sign*1.22)
    rotate('forearm.'+label,(0,1,0),-sign*.20)
if 'arms-raised' in views:render('arms-raised',(0,-7,1.08),scale=2.4)
clear_pose();rotate('upper_arm.L',(1,0,0),-.25);rotate('forearm.L',(1,0,0),-1.0);rotate('thigh.L',(1,0,0),.40);rotate('shin.L',(1,0,0),-.80)
if 'elbow-knee' in views:render('elbow-knee',(7,-3.2,1.12))
clear_pose();rig.animation_data.action=walk_action;scene.frame_set(1)
triangles=0
for ob in characters:
    ob.data.calc_loop_triangles();triangles+=len(ob.data.loop_triangles)
report={'revision':'binding-3.1-run','bone_count':len(arm.bones),'bones':[b.name for b in arm.bones],'animations':{'Walk':{'duration_seconds':.5,'navigation_speed_reference':1.15,'starts_at_rest':True},'Run':{'duration_seconds':1/3,'navigation_speed_reference':2.1,'starts_at_rest':False,'stop_restore':'Stop Run, then reset Walk to its neutral first frame.','flight_floor_range_H':[min(run_floor_samples),max(run_floor_samples)]}},'original_bounds':original_bounds,'runtime_rest_bounds':bounds(characters),'triangles':triangles,'simplification':reports,'note':'Static geometry accepted by user for demo; rig is newly positioned from v9, no old mesh or rig imported.'}
with open(os.path.join(OUT,'rig-report.json'),'w') as f:json.dump(report,f,indent=2)
print('RIG_COMPLETE',json.dumps(report))
