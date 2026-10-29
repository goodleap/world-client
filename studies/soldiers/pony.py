"""Reference-based rounded pony, saddle and mounted equipment.

Geometry uses the already reviewed mount_motion dimensions and trajectories.
The horse skin is one voxel-fused surface, not a set of visible body spheres.
"""
import bpy
import math
from math import sin, cos, pi
from mathutils import Vector
import dressing as d
import mount_motion as motion


def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)


def sweep(name, rows, mat, sub=2):
    vertices,faces,n=[],[],32
    for j,(point,rx,ry) in enumerate(rows):
        p=Vector(point)
        tangent=Vector(rows[min(j+1,len(rows)-1)][0])-Vector(rows[max(0,j-1)][0])
        tangent.normalize()
        side=Vector((1,0,0))
        if abs(tangent.dot(side))>.9:side=Vector((0,1,0))
        normal=tangent.cross(side).normalized()
        side=normal.cross(tangent).normalized()
        for i in range(n):
            a=2*pi*i/n
            vertices.append(p+rx*cos(a)*side+ry*sin(a)*normal)
    for j in range(len(rows)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.extend([tuple(reversed(range(n))),tuple((len(rows)-1)*n+i for i in range(n))])
    return d.mesh(name,vertices,faces,mat,sub=sub)


def horse(rig,mats):
    coat=d.material('Horse • warm chestnut coat',(.72,.43,.20))
    mane=d.material('Horse • dark chocolate mane',(.22,.13,.08))
    dark=d.material('Horse • soft dark hooves',(.17,.17,.18))
    black=d.material('Horse • eyes',(.055,.044,.030),.52)
    glint=d.material('Horse • eye glints',(.99,.97,.89))
    pink=d.material('Horse • inner ears',(.79,.44,.30))
    bridle=d.material('Horse • bridle leather',(.40,.24,.13))
    nose=d.material('Horse • nostrils and mouth',(.31,.20,.14))
    skin=[d.oval('Pony barrel source',(0,.10,.72),(.24,.58,.26),coat),
          d.oval('Pony continuous shoulders source',(0,-.31,.68),(.295,.31,.27),coat),
          d.oval('Pony continuous haunches source',(0,.44,.68),(.295,.29,.26),coat),
          sweep('Pony neck source',[((0,-.30,.67),.19,.20),((0,-.40,.84),.19,.20),
              ((0,-.51,1.04),.17,.19),((0,-.61,1.19),.19,.21)],coat),
          d.oval('Pony cranium source',(0,-.64,1.17),(.29,.27,.29),coat),
          d.oval('Pony muzzle source',(0,-.88,1.005),(.232,.25,.17),coat)]
    for leg,(x,y,_) in motion.LEGS.items():
        knee=motion.REST[leg]
        ky=y-knee['knee_f']
        skin.append(d.rings('Pony leg source '+leg,[(.103,x,y,.071,.080),(.15,x,y,.070,.078),
            (.21,x,y+(ky-y)*.42,.070,.082),(.29,x,y+(ky-y)*.92,.078,.09),
            (knee['knee_z'],x,ky,.083,.095),(.42,x,y+(ky-y)*.82,.090,.107),
            (.53,x,y+(ky-y)*.35,.108,.124),(.62,x,y,.130,.145),
            (.70,x*.85,y,.12,.13),(.76,x*.65,y,.09,.10)],coat))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in skin:
        obj.select_set(True);bpy.context.view_layer.objects.active=obj
        for mod in list(obj.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active=skin[0]
    bpy.ops.object.join()
    body=bpy.context.object;body.name='Horse • continuous body neck head and legs'
    remesh=body.modifiers.new('Continuous pony volume','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.012
    remesh.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=remesh.name)
    mod=body.modifiers.new('Soft coat surface','SMOOTH');mod.factor=.65;mod.iterations=4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for face in body.data.polygons:face.use_smooth=True
    # A beige muzzle patch is vertex colour on the continuous skin, avoiding
    # a separate ball joined to the head or a floating face plate.
    body.data.materials.clear();body.data.materials.append(coat)
    attr=body.data.color_attributes.new(name='Horse coat',type='FLOAT_COLOR',domain='CORNER')
    node=coat.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name='Horse coat'
    coat.node_tree.links.new(node.outputs['Color'],coat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    def linear(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
    for loop in body.data.loops:
        v=body.data.vertices[loop.vertex_index].co
        t=smooth(.83,.91,-v.y)*(1-smooth(1.115,1.20,v.z))
        rgb=[a*(1-t)+b*t for a,b in zip((.72,.43,.20),(.94,.80,.62))]
        attr.data[loop.index].color=tuple(linear(c) for c in rgb)+(1,)
    groups={b.name:body.vertex_groups.new(name=b.name) for b in rig.data.bones if b.name.startswith('Horse.')}
    for vertex in body.data.vertices:
        x,y,z=vertex.co
        neck=smooth(.65,.87,z)*(1-smooth(-.40,-.23,y))
        head=smooth(.88,1.08,z-.4*(y+.55))*neck
        weights={'Horse.body':1-neck,'Horse.neck':neck-head,'Horse.head':head}
        leg=('F' if y<.1 else 'H')+('L' if x>=0 else 'R')
        lx,ly,_=motion.LEGS[leg];rest=motion.REST[leg]
        ky=ly-rest['knee_f']
        distance=abs(y-(ky if z<.42 else ly))
        limb=(1-smooth(.51,.66,z))*smooth(.08,.17,abs(x))*(1-smooth(.20,.32,distance))
        if limb:
            weights={n:w*(1-limb) for n,w in weights.items()}
            upper=smooth(rest['knee_z']-.06,rest['knee_z']+.06,z)
            hoof=1-smooth(.12,.18,z)
            weights['Horse.upper.'+leg]=limb*upper
            weights['Horse.lower.'+leg]=limb*(1-upper)*(1-hoof)
            weights['Horse.hoof.'+leg]=limb*(1-upper)*hoof
        total=sum(weights.values())
        for name,w in weights.items():
            if w>1e-7:groups[name].add([vertex.index],w/total,'REPLACE')
    mod=body.modifiers.new('Reviewed pony deformation','ARMATURE');mod.object=rig;body.parent=rig
    for leg,(x,y,_) in motion.LEGS.items():
        d.bind(d.rings('Hoof.'+leg,[(.008,x,y-.02,.09,.13),(.018,x,y-.02,.105,.15),
            (.075,x,y-.015,.102,.14),(.125,x,y,.075,.08)],dark),bone='Horse.hoof.'+leg)
    face_tree=d.surface_tree(body)
    def eye_patch(name,cx,cz,rx,rz,offset,mat):
        vertices,faces,n=[],[],48
        for j in range(9):
            radius=.001+(1-.001)*j/8
            for i in range(n):
                a=2*pi*i/n;x=cx+radius*rx*cos(a);z=cz+radius*rz*sin(a)
                hit=face_tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))[0]
                vertices.append((x,hit.y-offset-.003*(1-radius*radius),z))
        for j in range(8):
            for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
        faces.append(tuple(reversed(range(n))))
        d.bind(d.mesh(name,vertices,faces,mat),bone='Horse.head')
    for s in [-1,1]:
        eye_patch('Horse eye.'+str(s),s*.216,1.235,.042,.063,.005,black)
        eye_patch('Horse eye glint.'+str(s),s*.211,1.255,.011,.015,.010,glint)
        d.bind(d.oval('Horse nostril.'+str(s),(s*.102,-1.109,1.027),(.027,.013,.034),nose),bone='Horse.head')
        d.bind(d.rings('Horse ear.'+str(s),[(1.36,s*.18,-.55,.055,.042),
            (1.43,s*.19,-.54,.071,.047),(1.52,s*.22,-.535,.061,.037),
            (1.59,s*.25,-.53,.028,.019),(1.615,s*.25,-.53,.003,.004)],coat),bone='Horse.head')
        # The ears use a separate solid coat material because the fused body
        # alone owns the muzzle colour attribute.
        ear=bpy.data.objects['Horse ear.'+str(s)]
        if s==-1:ear_coat=d.material('Horse • ear outer coat',(.72,.43,.20))
        ear.data.materials.clear();ear.data.materials.append(ear_coat)
        d.bind(d.mesh('Horse inner ear.'+str(s),[(s*.18-.038,-.585,1.43),(s*.18+.038,-.585,1.43),
            (s*.25+.010,-.548,1.58),(s*.25-.010,-.548,1.58)],[(0,1,2,3)],pink,sub=2,thick=.005),bone='Horse.head')
    d.bind(d.tube('Horse muzzle smile',[(-.08,-1.104,.970),(0,-1.119,.951),(.08,-1.104,.970)],.004,nose),bone='Horse.head')
    mane_obj=sweep('Horse • flowing mane',[((0,-.55,1.43),.115,.080),((0,-.44,1.38),.125,.10),
        ((0,-.35,1.26),.115,.09),((0,-.28,1.13),.105,.085),((0,-.19,1.0),.090,.070),((0,-.11,.88),.018,.015)],mane)
    d.bind(mane_obj,bone='Horse.neck')
    for i,s in enumerate([-1,1]):
        d.bind(sweep('Horse • swept forelock '+str(i),[((s*.06,-.65,1.45),.105,.045),
            ((s*.09,-.79,1.40),.11,.051),((s*.16,-.855,1.33),.070,.035),
            ((s*.19,-.85,1.28),.008,.006)],mane),bone='Horse.head')
    d.bind(sweep('Horse • continuous flowing tail',[((0,.61,.79),.08,.08),((0,.80,.75),.11,.11),
        ((0,.97,.60),.12,.105),((0,1.01,.39),.105,.08),((0,.91,.28),.050,.04),
        ((0,.85,.31),.008,.008)],mane),bone='Horse.tail')
    # Bridle follows the head, with a noseband and brow/poll straps.
    for s in [-1,1]:
        d.bind(d.tube('Horse cheek strap.'+str(s),[(s*.23,-1.00,1.035),(s*.266,-.83,1.12),
            (s*.253,-.66,1.35),(s*.17,-.49,1.40)],.016,bridle),bone='Horse.head')
        d.bind(d.oval('Horse bit ring.'+str(s),(s*.242,-.98,1.04),(.028,.014,.028),mats['gold']),bone='Horse.head')
    d.bind(d.tube('Horse brow band',[(-.25,-.77,1.31),(-.14,-.88,1.32),(0,-.912,1.32),
        (.14,-.88,1.32),(.25,-.77,1.31)],.015,bridle),bone='Horse.head')
    d.bind(d.tube('Horse noseband',[(-.24,-.98,1.035),(-.15,-1.055,1.12),(0,-1.076,1.145),
        (.15,-1.055,1.12),(.24,-.98,1.035)],.014,bridle),bone='Horse.head')
    saddle(body,mats,bridle)
    return body


def saddle(body,mats,bridle):
    tree=d.surface_tree(body)
    def panel(name,angle,y0,y1,offset,mat):
        vertices,faces,n,m=[],[],40,24
        for j in range(m+1):
            y=y0+(y1-y0)*j/m
            for i in range(n+1):
                a=angle*(2*i/n-1);direction=Vector((sin(a),0,cos(a)))
                hit=tree.ray_cast(Vector((0,y,.72)),direction)[0]
                if hit is None:raise ValueError('Saddle missed the pony barrel')
                vertices.append(hit+direction*offset)
        for j in range(m):
            for i in range(n):k=j*(n+1)+i;faces.append((k,k+1,k+n+2,k+n+1))
        d.bind(d.mesh(name,vertices,faces,mat,sub=1,thick=.017),bone='Horse.body')
    panel('Saddle • blue fitted blanket',1.45,-.13,.43,.019,mats['plume'])
    panel('Saddle • curved leather seat',.95,-.07,.34,.049,mats['leather'])
    d.bind(d.oval('Saddle • rounded cantle',(0,.35,1.003),(.22,.053,.058),mats['edge']),bone='Horse.body')
    d.bind(d.oval('Saddle • rounded pommel',(0,-.09,1.012),(.17,.040,.036),mats['edge']),bone='Horse.body')
    vertices,faces,n=[],[],96
    for y in [.055,.095,.135]:
        for i in range(n):
            a=2*pi*i/n;direction=Vector((cos(a),0,sin(a)))
            hit=tree.ray_cast(Vector((0,y,.72)),direction)[0]
            vertices.append(hit+direction*.022)
    for j in range(2):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    d.bind(d.mesh('Saddle • belly girth',vertices,faces,bridle,thick=.012),bone='Horse.body')


def rider_equipment(rig,mats):
    # The cape is authored in the human's unchanged rest coordinates.
    vertices,faces,n,m=[],[],32,24
    for j in range(m+1):
        t=j/m
        for i in range(n+1):
            u=2*i/n-1
            vertices.append((u*(.20+.12*sin(.65*pi*t)),.15+.12*sin(pi*t)+.28*t*t+.02*cos(u*pi*2)*t,
                .77-.42*t+.02*u*u+.015*cos(u*pi*3)*t*t))
    for j in range(m):
        for i in range(n):k=j*(n+1)+i;faces.append((k,k+1,k+n+2,k+n+1))
    d.bind(d.mesh('Rider • curved blue cape',vertices,faces,mats['plume'],sub=1,thick=.012),bone='torso')
    origin=Vector((-.421,-.015,.385));up=Vector((-.20,-.02,.98)).normalized()
    across=Vector((up.z,0,-up.x)).normalized();depth=Vector((0,1,0))
    def at(x,y,z):return origin+across*x+depth*y+up*z
    d.bind(d.tube('Lance • wooden shaft',[at(0,0,-.16),at(0,0,.65),at(0,0,1.35)],.018,mats['edge']),bone='hand.R')
    d.bind(d.tube('Lance • steel socket',[at(0,0,1.25),at(0,0,1.38)],.024,mats['silver']),bone='hand.R')
    vertices=[at(0,0,1.64),at(-.067,0,1.40),at(0,0,1.32),at(.067,0,1.40),
              at(0,-.025,1.42),at(0,.025,1.42)]
    faces=[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(1,0,5),(2,1,5),(3,2,5),(0,3,5)]
    d.bind(d.mesh('Lance • leaf steel point',vertices,faces,mats['silver'],bevel=.003),bone='hand.R')
    for side,label in [(1,'L'),(-1,'R')]:
        x=side*.20
        d.bind(d.tube('Rider stirrup.'+label,[(x-.145,-.09,.105),(x-.16,-.09,.035),
            (x-.14,-.09,.016),(x+.14,-.09,.016),(x+.16,-.09,.035),(x+.145,-.09,.105)],.009,mats['silver']),bone='foot.'+label)


def fitted_tack(rig,mats):
    # Called in RideIdle after the pose is reviewed: both the reins and saddle
    # follow the same body bob as the rider. Head motion stays inside bit rings.
    hand=rig.pose.bones['hand.L'].matrix@rig.pose.bones['hand.L'].bone.matrix_local.inverted()@Vector((.418,-.018,.37))
    points=[(.242,-.98,1.04),(.31,-.63,1.015),(.34,-.26,1.02),tuple(hand)]
    d.bind(d.tube('Rein • near hand',points,.009,mats['edge']),bone='Horse.body')
    points=[(-.242,-.98,1.04),(-.31,-.63,1.035),(-.31,-.23,1.065),(0,-.04,hand.z),tuple(hand)]
    d.bind(d.tube('Rein • far hand',points,.009,mats['edge']),bone='Horse.body')
    for side,label in [(1,'L'),(-1,'R')]:
        foot=rig.pose.bones['foot.'+label].matrix@rig.pose.bones['foot.'+label].bone.matrix_local.inverted()@Vector((side*.20,-.09,.15))
        d.bind(d.tube('Saddle stirrup strap.'+label,[(side*.23,.09,.95),tuple(foot)],.018,mats['edge']),bone='Horse.body')
