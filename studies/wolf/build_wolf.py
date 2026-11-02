"""Grey wolf, authored from the user-approved 2026-11-02 concept.

Blender: +Y forward, +Z up. Measurements below are author units; 0.72 m/unit.
No previous animal mesh or geometry recipe is used. Rebuild with Blender 4.3.
"""
import bpy, math, json, sys
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCALE = .72
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials): bpy.data.materials.remove(data)

def material(name, rgb):
    m=bpy.data.materials.new(name); m.diffuse_color=(*rgb,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*rgb,1)
    bs.inputs['Roughness'].default_value=.9; bs.inputs['Metallic'].default_value=0
    return m

# Linear reflectance, not the shaded values sampled in the concept image.
grey=material('Wolf slate',(.23,.215,.21))
dark=material('Wolf dark fur',(.125,.116,.11))
cream=material('Wolf ivory',(.76,.66,.48))
pink=material('Wolf inner ear',(.48,.28,.19))
black=material('Wolf nose and pupil',(.026,.023,.022))
white=material('Wolf eye white',(.87,.83,.69))
amber=material('Wolf amber',(.61,.255,.025))
glint=material('Wolf eye glint',(1,1,.97))
parts=[]; binding={}

def remember(ob, mat, bone='body'):
    ob.data.materials.clear(); ob.data.materials.append(mat)
    for p in ob.data.polygons: p.use_smooth=True
    parts.append(ob); binding[ob.name]=bone
    return ob

def oval(name, center, radii, mat, bone='body', segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=center)
    ob=bpy.context.object; ob.name=name; ob.scale=radii
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return remember(ob,mat,bone)

def tube(name, rows, mat, bone='head', n=20, wide_axis=(1,0,0)):
    # Smooth rounded tapered leaf/sweep: [x,y,z,width,depth], axis along rows.
    vs=[]; fs=[]; previous=None
    for j,r in enumerate(rows):
        c=Vector(r[:3]); tangent=Vector(rows[min(j+1,len(rows)-1)][:3])-Vector(rows[max(0,j-1)][:3])
        tangent.normalize(); a=previous.copy() if previous is not None else Vector(wide_axis)
        if abs(tangent.dot(a))>.9: a=Vector((0,1,0))
        a=(a-tangent*tangent.dot(a)).normalized(); previous=a; b=tangent.cross(a).normalized()
        for i in range(n):
            t=2*math.pi*i/n; vs.append(tuple(c+a*r[3]*math.cos(t)+b*r[4]*math.sin(t)))
    for j in range(len(rows)-1):
        for i in range(n): fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    fs.extend([tuple(reversed(range(n))),tuple((len(rows)-1)*n+i for i in range(n))])
    me=bpy.data.meshes.new(name); me.from_pydata(vs,[],fs); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob)
    sub=ob.modifiers.new('Rounded contour','SUBSURF'); sub.levels=1
    bpy.context.view_layer.objects.active=ob; bpy.ops.object.modifier_apply(modifier=sub.name)
    return remember(ob,mat,bone)

def fuse(name, objects, mat, bone='body', voxel=.028):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects: ob.select_set(True); parts.remove(ob); binding.pop(ob.name,None)
    bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); ob=objects[0]; ob.name=name
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    ob.data.remesh_voxel_size=voxel; bpy.ops.object.voxel_remesh()
    sm=ob.modifiers.new('Volume continuity','SMOOTH'); sm.factor=.55; sm.iterations=4
    bpy.ops.object.modifier_apply(modifier=sm.name)
    return remember(ob,mat,bone)

body=fuse('Continuous torso',[
    oval('trunk',(0,-.40,.82),(.43,.84,.45),grey),
    oval('shoulders',(0,.19,.89),(.43,.50,.52),grey),
    oval('rump',(0,-.96,.77),(.43,.43,.44),grey),
    oval('chest',(0,.38,.88),(.37,.39,.56),grey),
],grey)
# Soft belly is a shaped inset mass, not a flat chest board.

leg_joints={}
for side in [-1,1]:
    for front in [True,False]:
        tag=('front' if front else 'hind')+('.L' if side<0 else '.R')
        x=side*.30
        hip=(x,.30 if front else -.90,.80)
        knee=(x,.28 if front else -.69,.46)
        ankle=(x,.43 if front else -.95,.16)
        leg_joints[tag]=[hip,knee,ankle]
        limb=fuse('Limb '+tag,[
            oval('upper',(x,(hip[1]+knee[1])/2,.66),(.175,.22 if front else .26,.29),grey),
            oval('lower',(x,(knee[1]+ankle[1])/2,.30),(.13,.14,.24),cream),
        ],grey,tag,voxel=.022)
        # The lower limb uses the concept's light sock, following its volume.
        limb.data.materials.append(cream)
        for p in limb.data.polygons:
            if p.center.z<.39: p.material_index=1
        foot=fuse('Paw '+tag,[
            oval('paw',(x,ankle[1]+.045,.125),(.19,.25,.13),dark),
            *[oval('toe',(x+k*.10,ankle[1]+.20,.11),(.069,.10,.10),dark) for k in [-1,0,1]],
        ],dark,'paw-'+tag,voxel=.018)

head=oval('Full skull',(0,.64,1.38),(.46,.43,.45),grey,'head',48,32)
face=fuse('Ivory muzzle and cheeks',[
    oval('jaw-base',(0,.88,1.18),(.35,.34,.23),cream,'head'),
    tube('Tapering muzzle',[(0,.94,1.22,.28,.20),(0,1.10,1.22,.27,.19),
        (0,1.29,1.235,.18,.135),(0,1.38,1.24,.12,.08)],cream,'head'),
    *[oval('cheek',(s*.29,.87,1.22),(.22,.25,.27),cream,'head') for s in [-1,1]],
],cream,'head',voxel=.018)
for v in face.data.vertices:
    # Leave a real lip opening for the separate lower jaw, rather than a solid
    # muzzle with an extra tongue-like piece moving beneath it.
    x,y,z=v.co
    blend=max(0,min(1,(y-.95)/.16))*max(0,min(1,(.29-abs(x))/.08))
    if z<1.16:v.co.z=z+(1.16-z)*blend
face.data.update()
face_surface=BVHTree.FromPolygons([v.co for v in face.data.vertices],[list(p.vertices) for p in face.data.polygons])
def face_front(x,z):
    hit=face_surface.ray_cast(Vector((x,2,z)),Vector((0,-1,0)))[0]
    if hit is None: raise ValueError('Mouth contour misses the authored muzzle')
    return hit.y+.003
oval('Lower jaw',(0,1.04,1.095),(.235,.265,.098),cream,'jaw')
oval('Mouth interior',(0,1.06,1.153),(.205,.225,.018),black,'head')
oval('Inner lower jaw',(0,1.055,1.16),(.18,.21,.016),pink,'jaw')
for s in [-1,1]:
    tube('Canine '+str(s),[(s*.15,1.21,1.161,.026,.024),(s*.15,1.22,1.12,.020,.017),
        (s*.15,1.23,1.085,.004,.004)],white,'head',12)
oval('Nose',(0,1.353,1.285),(.145,.106,.094),black,'head')
oval('Nose highlight',(-.038,1.437,1.318),(.040,.012,.015),dark,'head',20,12)
# Neck ruff and cheeks have broad overlapping swept locks, not hair strands.
for side in [-1,1]:
    for i,(x,y,z,dx,dy,dz,w) in enumerate([
        (.31,.81,1.38,.24,-.06,-.10,.19),
        (.34,.76,1.22,.24,-.04,-.15,.18),
        (.29,.69,1.07,.21,-.08,-.19,.18),
    ]):
        tube('Ruff cheek '+str(side)+' '+str(i),[(side*x,y,z,w,.10),
            (side*(x+dx*.45),y+dy*.4,z+dz*.3,w*.85,.085),
            (side*(x+dx*.9),y+dy*.9,z+dz*.8,w*.32,.040),
            (side*(x+dx),y+dy,z+dz,.008,.008)],cream if i<3 else grey)
    for i in range(3):
        x=side*(.07+i*.115); y=.81-i*.04; z=1.15-i*.035
        tube('Chest ruff '+str(side)+' '+str(i),[(x,y,z,.15,.13),
            (x+side*.035,y+.04,z-.19,.15,.13),(x+side*.025,y+.04,z-.38,.065,.065),
            (x,y+.01,z-.48,.009,.009)],cream,'body')
    # Ears are closed curved wedges with thickness and an inset pink cavity.
    tube('Ear '+str(side),[(side*.30,.61,1.63,.18,.12),
        (side*.36,.61,1.77,.18,.115),(side*.405,.60,1.96,.095,.075),
        (side*.43,.58,2.08,.02,.025)],dark)
    tube('Inner ear '+str(side),[(side*.32,.719,1.70,.104,.025),
        (side*.37,.716,1.80,.10,.025),(side*.405,.675,1.95,.032,.018),
        (side*.415,.65,1.99,.006,.009)],pink)
    tube('Inner ear tuft '+str(side),[(side*.31,.75,1.69,.08,.035),
        (side*.32,.76,1.80,.075,.035),(side*.33,.74,1.87,.005,.008)],cream)
    # Eyes sit on the forward skull surface with an outward tilt.
    for name,off,rx,rz,mat in [('Eye',0,.133,.151,white),('Iris',.023,.080,.113,amber),('Pupil',.038,.044,.087,black)]:
        ob=oval(name+' '+str(side),(side*.255,1.003+off,1.455),(rx,.025,rz),mat,'head')
        ob.rotation_euler.z=-side*.19
    oval('Eye glint '+str(side),(side*.247-.023,1.075,1.49),(.019,.009,.024),glint,'head',20,12)
    tube('Brow '+str(side),[(side*.09,1.04,1.514,.027,.025),(side*.20,1.035,1.571,.067,.055),
        (side*.32,.976,1.59,.065,.049),(side*.402,.91,1.54,.013,.012)],grey)
    tube('Mouth corner '+str(side),[(side*x,face_front(side*x,z),z,r,r)
        for x,z,r in [(.18,1.16,.004),(.23,1.15,.006),(.28,1.17,.005),(.30,1.19,.003)]],black)

# Only the crown/cheek silhouette carries small authored fur tips. The approved
# body's grey patches are COLOUR, not raised armour-like flakes (user review).
for i in range(3):
    tube('Crown '+str(i),[(-.20+i*.17,.56,1.72,.12,.09),(-.13+i*.16,.63,1.83,.11,.08),
        (-.22+i*.16,.75,1.73,.008,.01)],grey)
tail=tube('Bushy tail',[(0,-1.10,.88,.22,.21),(.02,-1.35,.76,.27,.25),(.05,-1.61,.56,.27,.22),
    (.08,-1.87,.36,.20,.17),(.11,-2.04,.34,.10,.10),(.10,-2.15,.40,.005,.005)],grey,'tail')
tail.data.materials.append(cream)
for p in tail.data.polygons:
    if p.center.y < -1.83: p.material_index=1

# Unite anatomical transitions before skinning; colour islands remain curved
# surface volumes rather than coarse polygon-centre masks.
face=fuse('Ivory face ruff',[face,*[o for o in parts if o.name.startswith('Ruff cheek') and o.data.materials[0]==cream]],cream,'head',.018)
chest=fuse('Continuous ivory chest',[oval('Bib volume',(0,.72,.94),(.33,.18,.33),cream),
    *[o for o in parts if o.name.startswith('Chest ruff')]],cream,'body',.018)
head=fuse('Skull and brow',[head,*[o for o in parts if o.name.startswith(('Brow ','Crown '))]],grey,'head',.017)
body=fuse('Torso and limbs',[body,*[o for o in parts if o.name.startswith('Limb ')]],grey,'anatomy',.022)
coat=material('Wolf continuous coat',(1,1,1)); color=coat.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name='Coat'
coat.node_tree.links.new(color.outputs['Color'],coat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
body.data.materials.clear();body.data.materials.append(coat)
colors=body.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
def smooth(a,b,v):
    t=max(0,min(1,(v-a)/(b-a)));return t*t*(3-2*t)
for v in body.data.vertices:
    x,y,z=v.co; sock=1-smooth(.29,.39,z)
    belly=(1-smooth(.53,.67,z))*(1-smooth(.25,.34,abs(x)))
    # Broad softly scalloped slate saddle over mid-grey sides. No raised mesh,
    # normal map or fur effect is used for the coat's colour boundaries.
    boundary=.89+.065*math.sin(y*6)+.028*math.cos(y*11)
    saddle=smooth(boundary-.045,boundary+.045,z)
    mid=(.34,.31,.275); back=(.205,.193,.185)
    base=tuple(a+(b-a)*saddle for a,b in zip(mid,back)); t=max(sock,belly)
    colors.data[v.index].color=tuple(a+(b-a)*t for a,b in zip(base,cream.diffuse_color[:3]))+(1,)
tail.data.materials.clear();tail.data.materials.append(coat)
tail_colors=tail.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
for v in tail.data.vertices:
    x,y,z=v.co; boundary=-1.83+.035*math.sin(x*19)
    t=1-smooth(boundary-.035,boundary+.035,y)
    tail_colors.data[v.index].color=tuple(a+(b-a)*t for a,b in zip(grey.diffuse_color,cream.diffuse_color))
# The approved side view has a compact back and large deep head.
for ob in parts:
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    if binding[ob.name] in ['head','jaw']:
        pivot=Vector((0,.58,1.23))
        for v in ob.data.vertices:v.co=pivot+(v.co-pivot)*1.13
    for v in ob.data.vertices:
        if v.co.y<.30:v.co.y=.30+(v.co.y-.30)*.78
for tag,joints in leg_joints.items():
    leg_joints[tag]=[(x,.30+(y-.30)*.78 if y<.30 else y,z) for x,y,z in joints]

# Armature and actions are generated from the same joint coordinates as skin.
bpy.ops.object.select_all(action='DESELECT')
arm=bpy.data.armatures.new('Wolf rig'); rig=bpy.data.objects.new('Wolf',arm); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
def bone(name, head, tail, parent=None):
    b=arm.edit_bones.new(name); b.head=head; b.tail=tail
    if parent: b.parent=arm.edit_bones[parent]
bone('body',(0,0,.80),(0,.4,.80))
bone('head',(0,.35,1.19),(0,.75,1.19),'body')
bone('jaw',(0,.91,1.12),(0,1.23,1.12),'head')
bone('tail',(0,-.792,.88),(0,-1.182,.56),'body')
for tag,(hip,knee,ankle) in leg_joints.items():
    bone('upper-'+tag,hip,knee,'body'); bone('lower-'+tag,knee,ankle,'upper-'+tag)
    bone('paw-'+tag,ankle,(ankle[0],ankle[1]+.20,ankle[2]),'lower-'+tag)
bpy.ops.object.mode_set(mode='OBJECT')
for ob in parts:
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    tag=binding[ob.name]
    if tag=='anatomy':
        # Native bone-heat weighting respects the connected volume around the
        # groin. Spatial masks pulled small abdominal folds into the rear legs.
        deform=[b for b in arm.bones if b.name!='body' and not b.name.startswith(('upper-','lower-'))]
        for b in deform:b.use_deform=False
        rig.select_set(True);bpy.context.view_layer.objects.active=rig
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        for b in deform:b.use_deform=True
        bpy.context.view_layer.objects.active=ob;rig.select_set(False)
        bpy.ops.object.vertex_group_limit_total(limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        if any(sum(g.weight for g in v.groups)<.99 for v in ob.data.vertices):
            raise ValueError('Native bone heat left unweighted wolf vertices')
    elif tag in leg_joints:
        hip,knee,ankle=leg_joints[tag]
        groups={name:ob.vertex_groups.new(name=name) for name in ['body','upper-'+tag,'lower-'+tag]}
        for v in ob.data.vertices:
            lower=max(0,min(1,(.57-v.co.z)/.23)); torso=max(0,min(1,(v.co.z-.73)/.25))
            weights={'body':torso,'upper-'+tag:(1-lower)*(1-torso),'lower-'+tag:lower*(1-torso)}
            for name,w in weights.items():
                if w>0:groups[name].add([v.index],w,'REPLACE')
    else:
        vg=ob.vertex_groups.new(name=tag);vg.add(list(range(len(ob.data.vertices))),1,'REPLACE')
    ob.parent=rig
    if not any(m.type=='ARMATURE' for m in ob.modifiers):
        mod=ob.modifiers.new('Wolf deformation','ARMATURE');mod.object=rig
    ob['wolfPart']=ob.name

scene=bpy.context.scene;scene.render.fps=30
rig.animation_data_create()
def start_action(name):
    for p in rig.pose.bones:p.rotation_mode='QUATERNION';p.location=(0,0,0);p.rotation_quaternion=Quaternion();p.scale=(1,1,1)
    a=bpy.data.actions.new(name);rig.animation_data.action=a;return a
def finish_action(a, end):
    for curve in a.fcurves:
        for key in curve.keyframe_points:key.interpolation='LINEAR'
    track=rig.animation_data.nla_tracks.new();track.name=a.name
    strip=track.strips.new(a.name,0,a);strip.action_frame_start=0;strip.action_frame_end=end
    track.mute=True
    rig.animation_data.action=None
def keys(frame):
    for p in rig.pose.bones:
        p.keyframe_insert('location',frame=frame);p.keyframe_insert('rotation_quaternion',frame=frame)
a=start_action('Idle');keys(0);keys(30);finish_action(a,30)

motion={'duration':.60,'stride':1.75,'referenceSpeed':1.75*SCALE/.60,'stance':.36,
    'phases':{'hind.L':0,'hind.R':.10,'front.L':.48,'front.R':.58},'lift':.31,
    'attackDuration':.55,'contact':.24}
reach_errors=[]
def place_segment(name, start, end):
    rest=arm.bones[name]; old=rest.tail_local-rest.head_local; new=end-start
    angle=math.atan2(new.z,new.y)-math.atan2(old.z,old.y)
    m=Matrix.Rotation(angle,4,'X') @ rest.matrix_local.to_3x3().to_4x4();m.translation=start
    rig.pose.bones[name].matrix=m;bpy.context.view_layer.update()
def legs(phase=None):
    bpy.context.view_layer.update()
    transform=rig.pose.bones['body'].matrix @ arm.bones['body'].matrix_local.inverted()
    for tag,points in leg_joints.items():
        hip,knee,ankle=map(Vector,points);l1=(knee-hip).length;l2=(ankle-knee).length
        hip=transform @ hip; goal=ankle.copy(); tilt=0
        if phase is not None:
            goal.z+=.008
            t=(phase-motion['phases'][tag])%1;d=motion['stance'];span=motion['stride']*d
            if t<d: goal.y+=span*(.5-t/d)
            else:
                q=(t-d)/(1-d);e=q*q*(3-2*q)
                goal.y+=span*(-.5+e);goal.z+=motion['lift']*math.sin(math.pi*q)**2
                tilt=.30*math.sin(2*math.pi*q)*math.sin(math.pi*q)**2
        v=goal-hip;distance=v.length;limit=l1+l2-.0001
        if distance>limit:
            reach_errors.append(distance-limit);goal=hip+v*(limit/distance);v=goal-hip;distance=limit
        along=(l1*l1-l2*l2+distance*distance)/(2*distance)
        h=math.sqrt(max(0,l1*l1-along*along));perp=Vector((0,-v.z,v.y)).normalized()
        joint=hip+v/distance*along+perp*h*(-1 if tag.startswith('front') else 1)
        place_segment('upper-'+tag,hip,joint);place_segment('lower-'+tag,joint,goal)
        foot=arm.bones['paw-'+tag].matrix_local.to_3x3().to_4x4()
        foot=Matrix.Rotation(tilt,4,'X')@foot;foot.translation=goal;rig.pose.bones['paw-'+tag].matrix=foot
        bpy.context.view_layer.update()

a=start_action('Run')
for i in range(37):
    p=i/36;wave=math.sin(2*math.pi*p)
    rig.pose.bones['body'].location.z=-.13+.045*wave
    rig.pose.bones['body'].rotation_quaternion=Quaternion((1,0,0),.045*math.cos(2*math.pi*p))
    rig.pose.bones['head'].rotation_quaternion=Quaternion((1,0,0),-.045*math.cos(2*math.pi*p))
    rig.pose.bones['tail'].rotation_quaternion=Quaternion((1,0,0),.13*wave)
    legs(p);keys(p*motion['duration']*30)
finish_action(a,motion['duration']*30)

for name,seconds in [('Bite',.55),('Hurt',.26),('Feed',1.1)]:
    a=start_action(name)
    for i in range(31):
        p=i/30;body=rig.pose.bones['body'];head=rig.pose.bones['head'];jaw=rig.pose.bones['jaw']
        if name=='Bite':
            attack=math.sin(math.pi*p)**2
            head.location.y=.085*attack;head.rotation_quaternion=Quaternion((1,0,0),.13*math.sin(2*math.pi*p)-.15*attack)
            opening=math.sin(math.pi*min(1,p/.46))**1.2 if p<.46 else 0
            jaw.rotation_quaternion=Quaternion((1,0,0),-.55*opening)
        elif name=='Hurt':
            recoil=math.sin(math.pi*p)**2;head.rotation_quaternion=Quaternion((1,0,0),.18*recoil)
            body.location.y=-.07*recoil
        else:
            dip=math.sin(math.pi*p)**2
            head.location.z=-.27*dip;head.rotation_quaternion=Quaternion((1,0,0),-.40*dip)
            jaw.rotation_quaternion=Quaternion((1,0,0),-.18*dip*(.5+.5*math.sin(6*math.pi*p)))
        legs();keys(p*seconds*30)
    finish_action(a,seconds*30)
for p in rig.pose.bones:p.location=(0,0,0);p.rotation_quaternion=Quaternion()
rig.scale=(SCALE,)*3
rig.rotation_euler.z=math.pi
bpy.context.view_layer.objects.active=rig;bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for ob in parts:ob.select_set(True)
scene.frame_set(0)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'wolf.blend'))
report={'scale':SCALE,'forward':'+Y author / +Z game','bones':len(arm.bones),'parts':len(parts),
    'joints':leg_joints,'motion':motion,'maxReachClamp':max(reach_errors,default=0),
    'vertices':sum(len(o.data.vertices) for o in parts),'actions':[a.name for a in bpy.data.actions]}
sys.path.insert(0,str(HERE))
from publish import export_game
report['levels']=export_game(rig,parts,coat,HERE)
(HERE/'wolf.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
