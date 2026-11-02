"""Chinese village dog from 角色原型图/角色原型图-待评审-v1.png.

Blender +Y forward/+Z up, metres. Rebuild: blender -b -t 2 -P this_file.
Geometry is newly sculpted; only the generic volume/export tooling is shared
with the wolf. The navigation and gameplay remain in TypeScript.
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

HERE=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
parts=[];binding={}
def material(name,rgb):
    m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=.88;p.inputs['Metallic'].default_value=0
    return m
fur=material('Honey orange',(.72,.285,.045));cream=material('Warm ivory',(.96,.82,.57))
pink=material('Coral ear',(.66,.27,.19));tongue=material('Tongue',(.77,.12,.09))
black=material('Warm black',(.018,.012,.009));glint=material('Eye glint',(.99,.97,.86))
def remember(ob,mat,bone='body'):
    ob.data.materials.clear();ob.data.materials.append(mat)
    for p in ob.data.polygons:p.use_smooth=True
    parts.append(ob);binding[ob.name]=bone;return ob
def oval(name,c,r,mat,bone='body'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=c)
    ob=bpy.context.object;ob.name=name;ob.scale=r
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return remember(ob,mat,bone)
def fuse(name,objects,mat,bone='body',voxel=.016):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True);parts.remove(ob);binding.pop(ob.name,None)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();ob=objects[0];ob.name=name
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    ob.data.remesh_voxel_size=voxel;bpy.ops.object.voxel_remesh()
    sm=ob.modifiers.new('Continuous soft volume','SMOOTH');sm.factor=.55;sm.iterations=5
    bpy.ops.object.modifier_apply(modifier=sm.name)
    return remember(ob,mat,bone)
def sweep(name,rows,mat,bone='head'):
    vs=[];fs=[];n=20
    for j,(x,y,z,w,d) in enumerate(rows):
        tangent=Vector(rows[min(j+1,len(rows)-1)][:3])-Vector(rows[max(0,j-1)][:3]);tangent.normalize()
        a=Vector((1,0,0));a=(a-tangent*tangent.dot(a)).normalized();b=tangent.cross(a)
        for i in range(n):
            t=2*math.pi*i/n;vs.append(tuple(Vector((x,y,z))+a*w*math.cos(t)+b*d*math.sin(t)))
    for j in range(len(rows)-1):
        for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    fs.extend([tuple(reversed(range(n))),tuple((len(rows)-1)*n+i for i in range(n))])
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active=ob;sub=ob.modifiers.new('Rounded silhouette','SUBSURF');sub.levels=2
    bpy.ops.object.modifier_apply(modifier=sub.name);return remember(ob,mat,bone)
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)

# Proportions and joint locations are shared by geometry, rig and offline IK.
joints={}
for s in [-1,1]:
    for front in [True,False]:
        tag=('front' if front else 'hind')+('.L' if s<0 else '.R');x=s*.205
        joints[tag]=[(x,.24 if front else -.32,.59),(x,.20 if front else -.18,.34),(x,.29 if front else -.32,.11)]

body=fuse('Full chest belly and rump',[
    oval('Compact trunk',(0,-.045,.625),(.305,.49,.295),fur),
    oval('Rounded shoulder',(0,.23,.65),(.285,.27,.31),fur),
    oval('Full rump',(0,-.35,.605),(.285,.28,.285),fur),
],fur)
limbs=[]
for tag,(hip,knee,ankle) in joints.items():
    x,y,z=hip
    limbs.append(fuse('Limb '+tag,[
        oval('Upper',(x,(y+knee[1])/2,.46),(.145,.16,.245),fur),
        oval('Lower',(x,(knee[1]+ankle[1])/2,.25),(.10,.115,.20),fur),
    ],fur,tag,.012))
    foot=fuse('Paw '+tag,[oval('Paw',(x,ankle[1]+.035,.09),(.125,.175,.09),cream),
        *[oval('Toe',(x+k*.068,ankle[1]+.145,.072),(.048,.071,.062),cream) for k in [-1,0,1]]],cream,'paw-'+tag,.009)
body=fuse('Continuous body and legs',[body,*limbs],fur,'anatomy',.012)
# Broad skull and cheeks form one organic volume, with a short forward muzzle.
head=fuse('Broad forehead and rounded cheeks',[
    oval('Skull',(0,.40,.96),(.345,.30,.31),fur,'head'),
    *[oval('Full cheek',(s*.205,.46,.84),(.17,.24,.18),fur,'head') for s in [-1,1]]],fur,'head',.012)
face=fuse('Cream cheeks and short muzzle',[
    *[oval('Cheek',(s*.16,.635,.845),(.183,.145,.143),cream,'head') for s in [-1,1]],
    oval('Muzzle',(0,.725,.87),(.19,.135,.108),cream,'head')],cream,'head',.010)
oval('Lower smiling jaw',(0,.696,.735),(.145,.136,.065),cream,'jaw')
oval('Open smile',(0,.762,.785),(.138,.063,.068),black,'head')
oval('Rounded tongue',(0,.81,.738),(.065,.036,.073),tongue,'jaw')
nose=oval('Soft triangular nose',(0,.839,.917),(.091,.062,.055),black,'head')
for v in nose.data.vertices:v.co.x*=.72+.28*smooth(-.04,.04,v.co.z)
oval('Nose sheen',(-.025,.893,.934),(.024,.008,.009),glint,'head')
for s in [-1,1]:
    sweep('Rounded upright ear '+str(s),[(s*.22,.34,1.12,.16,.105),(s*.245,.35,1.25,.137,.09),
        (s*.28,.34,1.41,.065,.048),(s*.29,.33,1.455,.015,.018)],fur)
    sweep('Inset pink ear '+str(s),[(s*.235,.424,1.215,.082,.018),(s*.257,.427,1.30,.076,.018),
        (s*.28,.383,1.40,.023,.012),(s*.282,.37,1.415,.007,.008)],pink)
    eye=oval('Oval black eye '+str(s),(s*.163,.675,1.047),(.054,.027,.070),black,'head');eye.rotation_euler.z=-s*.22
    oval('Eye glint '+str(s),(s*.163-.012,.701,1.072),(.015,.010,.019),glint,'head')
    brow=oval('Friendly eyebrow '+str(s),(s*.166,.639,1.145),(.035,.012,.015),black,'head');brow.rotation_euler.y=s*.14
# A thick, smoothly swept closed curl, cream on its terminal arc.
rows=[]
for i in range(33):
    t=i/32;angle=-math.pi/2-t*math.pi*1.65
    r=.105*(1-.28*t);rows.append((.025*t,-.54+.195*math.cos(angle),.985+.195*math.sin(angle),r,r))
rows=[(x*.78,-.48+(y+.48)*.78,.76+(z-.76)*.78,w*.78,d*.78) for x,y,z,w,d in rows]
tail=sweep('Full curled tail',rows,fur,'tail')

# Coat colours follow curved surface vertices (one shared matte material).
coat=material('Village dog matte coat',(1,1,1))
c=coat.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name='Coat'
coat.node_tree.links.new(c.outputs['Color'],coat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
for ob in [body,tail]:
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    colors=ob.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
    for v in ob.data.vertices:
        x,y,z=v.co
        if ob==body:
            sock=1-smooth(.17,.24,z)
            bib=smooth(.30,.43,y)*(1-smooth(.77,.90,z))*(1-smooth(.17,.27,abs(x)))
            belly=(1-smooth(.41,.49,z))*(1-smooth(.18,.25,abs(x)))
            t=max(sock,bib,belly)
        else:t=smooth(-.50,-.43,y)*smooth(.87,.98,z)
        colors.data[v.index].color=tuple(a+(b-a)*t for a,b in zip(fur.diffuse_color,cream.diffuse_color))
    ob.data.materials.clear();ob.data.materials.append(coat)

arm=bpy.data.armatures.new('Village dog rig');rig=bpy.data.objects.new('Village dog',arm);bpy.context.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
def bone(name,a,b,parent=None):
    ob=arm.edit_bones.new(name);ob.head=a;ob.tail=b
    if parent:ob.parent=arm.edit_bones[parent]
bone('body',(0,0,.59),(0,.3,.59));bone('head',(0,.22,.84),(0,.5,.84),'body')
bone('jaw',(0,.61,.755),(0,.78,.755),'head');bone('tail',(0,-.48,.76),(0,-.61,.95),'body')
for tag,(hip,knee,ankle) in joints.items():
    bone('upper-'+tag,hip,knee,'body');bone('lower-'+tag,knee,ankle,'upper-'+tag)
    bone('paw-'+tag,ankle,(ankle[0],ankle[1]+.13,ankle[2]),'lower-'+tag)
bpy.ops.object.mode_set(mode='OBJECT')
for ob in parts:
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    tag=binding[ob.name]
    if tag=='anatomy':
        excluded=[b for b in arm.bones if b.name!='body' and not b.name.startswith(('upper-','lower-'))]
        for b in excluded:b.use_deform=False
        rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        for b in excluded:b.use_deform=True
        bpy.context.view_layer.objects.active=ob;rig.select_set(False)
        bpy.ops.object.vertex_group_limit_total(limit=4);bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        assert all(sum(g.weight for g in v.groups)>.99 for v in ob.data.vertices),'unweighted vertices'
    else:ob.vertex_groups.new(name=tag).add(list(range(len(ob.data.vertices))),1,'REPLACE')
    ob.parent=rig
    if not any(m.type=='ARMATURE' for m in ob.modifiers):ob.modifiers.new('Native skin','ARMATURE').object=rig
    ob['dogPart']=ob.name

scene=bpy.context.scene;scene.render.fps=30;rig.animation_data_create();reach_errors=[]
motion={'Walk':{'duration':.8,'stride':.72,'referenceSpeed':.9,'stance':.58,'lift':.09,'phases':{'front.L':0,'front.R':.5,'hind.L':.65,'hind.R':.15}},
        'Run':{'duration':.50,'stride':1.05,'referenceSpeed':2.1,'stance':.25,'lift':.18,'phases':{'front.L':.48,'front.R':.55,'hind.L':0,'hind.R':.08}}}
def start(name):
    for p in rig.pose.bones:p.rotation_mode='QUATERNION';p.location=(0,0,0);p.rotation_quaternion=Quaternion();p.scale=(1,1,1)
    a=bpy.data.actions.new(name);rig.animation_data.action=a;return a
def finish(a,end):
    for curve in a.fcurves:
        for key in curve.keyframe_points:key.interpolation='LINEAR'
    track=rig.animation_data.nla_tracks.new();track.name=a.name;track.mute=True
    strip=track.strips.new(a.name,0,a);strip.action_frame_start=0;strip.action_frame_end=end;rig.animation_data.action=None
def keys(f):
    for p in rig.pose.bones:p.keyframe_insert('location',frame=f);p.keyframe_insert('rotation_quaternion',frame=f)
def segment(name,start,end):
    rest=arm.bones[name];old=rest.tail_local-rest.head_local;new=end-start
    angle=math.atan2(new.z,new.y)-math.atan2(old.z,old.y)
    m=Matrix.Rotation(angle,4,'X')@rest.matrix_local.to_3x3().to_4x4();m.translation=start;rig.pose.bones[name].matrix=m;bpy.context.view_layer.update()
def legs(phase=None,settings=None):
    bpy.context.view_layer.update();transform=rig.pose.bones['body'].matrix@arm.bones['body'].matrix_local.inverted()
    for tag,points in joints.items():
        hip,knee,ankle=map(Vector,points);l1=(knee-hip).length;l2=(ankle-knee).length;hip=transform@hip;goal=ankle.copy();tilt=0
        if phase is not None:
            t=(phase-settings['phases'][tag])%1;d=settings['stance'];span=settings['stride']*d;goal.z+=.005
            if t<d:goal.y+=span*(.5-t/d)
            else:
                q=(t-d)/(1-d);e=q*q*(3-2*q);goal.y+=span*(-.5+e);goal.z+=settings['lift']*math.sin(math.pi*q)**2
                tilt=.24*math.sin(2*math.pi*q)*math.sin(math.pi*q)**2
        v=goal-hip;distance=v.length;limit=l1+l2-.0001
        if distance>limit:reach_errors.append(distance-limit);goal=hip+v*(limit/distance);v=goal-hip;distance=limit
        along=(l1*l1-l2*l2+distance*distance)/(2*distance);h=math.sqrt(max(0,l1*l1-along*along));perp=Vector((0,-v.z,v.y)).normalized()
        joint=hip+v/distance*along+perp*h*(-1 if tag.startswith('front') else 1)
        segment('upper-'+tag,hip,joint);segment('lower-'+tag,joint,goal)
        foot=Matrix.Rotation(tilt,4,'X')@arm.bones['paw-'+tag].matrix_local.to_3x3().to_4x4();foot.translation=goal
        rig.pose.bones['paw-'+tag].matrix=foot;bpy.context.view_layer.update()
for name,duration in [('Idle',2.4),('Walk',.8),('Run',.5),('Feed',1.2)]:
    a=start(name)
    for i in range(61):
        t=i/60;wave=math.sin(2*math.pi*t);body_pose=rig.pose.bones['body'];head_pose=rig.pose.bones['head']
        if name in motion:
            body_pose.location.z=(-.067+.015*math.cos(4*math.pi*t)) if name=='Walk' else (-.077+.04*wave)
            body_pose.rotation_quaternion=Quaternion((1,0,0),(.02 if name=='Walk' else .04)*wave)
            head_pose.rotation_quaternion=Quaternion((1,0,0),-.025*wave);legs(t,motion[name])
        else:
            body_pose.location.z=-.025+.006*wave
            head_pose.rotation_quaternion=Quaternion((1,0,0),(-.55+.04*wave) if name=='Feed' else .015*wave)
            if name=='Feed':head_pose.location.z=-.07;rig.pose.bones['jaw'].rotation_quaternion=Quaternion((1,0,0),-.12*(.5+.5*math.sin(4*math.pi*t)))
            legs()
        rig.pose.bones['tail'].rotation_quaternion=Quaternion((0,1,0),.10*math.sin(4*math.pi*t));keys(t*duration*30)
    finish(a,duration*30)
for p in rig.pose.bones:p.location=(0,0,0);p.rotation_quaternion=Quaternion()
rig.rotation_euler.z=math.pi;scene.frame_set(0)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'dog.blend'))
report={'reference':'角色原型图/角色原型图-待评审-v1.png','height':1.455,'bones':len(arm.bones),'joints':joints,'motion':motion,'maxReachClamp':max(reach_errors,default=0),'parts':[o.name for o in parts]}
# Use the existing native GLB/vertex-colour publication path, parameterized here
# to keep three geometries with one skeleton and one action library.
sys.path.insert(0,str(HERE.parent/'wolf'))
from publish import export_game
report['levels']=export_game(rig,parts,coat,HERE,name='dog',ratios=(.085,.035,.012))
(HERE/'dog.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
