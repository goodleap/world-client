"""Reference-driven base human study. H=1, front -Y, Z up.

Fresh geometry from 基础人物原型图-v1.png; not derived from the old demo.
Run in Blender: MODEL_OUTPUT=/tmp/base-human-volume REVIEW_VIEWS=front,profile,game blender -b -t 8 --python build_model.py -- v10
"""
import bpy, bmesh, math, os, sys, json
from math import sin, cos, pi, sqrt, exp
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT=os.path.abspath(os.environ.get('MODEL_OUTPUT',os.path.dirname(os.path.abspath(__file__))))
os.makedirs(OUT,exist_ok=True)
REV=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'v10'
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for data in bpy.data.materials: bpy.data.materials.remove(data)

def linear(c): return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def material(name, rgb, rough=.62, subsurface=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    col=tuple(linear(c) for c in rgb)+(1,)
    p.inputs['Base Color'].default_value=col
    p.inputs['Roughness'].default_value=rough
    p.inputs['Specular IOR Level'].default_value=.27
    p.inputs['Subsurface Weight'].default_value=subsurface
    p.inputs['Subsurface Radius'].default_value=(.8,.35,.18)
    p.inputs['Subsurface Scale'].default_value=.065
    m.diffuse_color=col
    return m

skin=material('Skin • warm peach',(.995,.785,.635),.67,.085)
skin_color=skin.copy(); skin_color.name='Face • peach with subtle cheek tint'
attr=skin_color.node_tree.nodes.new('ShaderNodeVertexColor'); attr.layer_name='Tint'
skin_color.node_tree.links.new(attr.outputs['Color'],skin_color.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
ear_mat=material('Ear inner soft peach',(.94,.50,.32),.7,.04)
cloth=material('Warm ivory cotton',(.95,.95,.95),.82)
cloth_edge=material('Cotton hems',(.97,.97,.965),.8)
black=material('Eyes • deep brown',(.067,.041,.022),.20)
black.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.38
brow=material('Eyebrows • warm brown',(.27,.12,.055),.68)
white=material('Eyes • warm white',(.99,.975,.93),.27)
glint=material('Eye catchlight', (1,1,.99),.2)
lip=material('Smile crease',(.65,.20,.075),.72)
smile_inner=material('Warm smile highlight',(.99,.95,.88),.72)

def mesh(name, verts, faces, mat, sub=0):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob)
    if mat: me.materials.append(mat)
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(me); bm.free()
    for f in me.polygons: f.use_smooth=True
    if sub:
        mod=ob.modifiers.new('Surface subdivision','SUBSURF'); mod.levels=sub; mod.render_levels=sub
    return ob

def oval(name, pos, scale, mat, seg=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=pos)
    ob=bpy.context.object; ob.name=name; ob.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(mat)
    for f in ob.data.polygons: f.use_smooth=True
    return ob

def curve(name, points, radius, mat, radii=None):
    cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='3D'; cu.resolution_u=16
    cu.bevel_depth=radius; cu.bevel_resolution=4; cu.use_fill_caps=True
    sp=cu.splines.new('BEZIER'); sp.bezier_points.add(len(points)-1)
    for i,(p,co) in enumerate(zip(sp.bezier_points,points)):
        p.co=co; p.handle_left_type='AUTO'; p.handle_right_type='AUTO'
        if radii: p.radius=radii[i]
    ob=bpy.data.objects.new(name,cu); bpy.context.collection.objects.link(ob); cu.materials.append(mat)
    return ob

def sample(rows,z):
    # Monotone cubic Hermite per coordinate, prevents ring-profile overshoot.
    if z<=rows[0][0]:return rows[0][1:]
    if z>=rows[-1][0]:return rows[-1][1:]
    for j in range(len(rows)-1):
        if rows[j][0]<=z<=rows[j+1][0]:break
    x0,x1=rows[j][0],rows[j+1][0]; t=(z-x0)/(x1-x0); vals=[]
    for k in range(1,len(rows[0])):
        d=(rows[j+1][k]-rows[j][k])/(x1-x0)
        a=(rows[j][k]-rows[j-1][k])/(x0-rows[j-1][0]) if j else d
        b=(rows[j+2][k]-rows[j+1][k])/(rows[j+2][0]-x1) if j+2<len(rows) else d
        m0=0 if a*d<=0 else 2*a*d/(a+d)
        m1=0 if b*d<=0 else 2*b*d/(b+d)
        vals.append((2*t**3-3*t*t+1)*rows[j][k]+(t**3-2*t*t+t)*(x1-x0)*m0+(-2*t**3+3*t*t)*rows[j+1][k]+(t**3-t*t)*(x1-x0)*m1)
    return vals

# Keep the approved front silhouette and reduced runtime head height. Depth is
# sculpted independently: convex forehead, full cheeks and a rounded occiput.
head_profile=[
 (.850,.006,.020,.020,.000),(.858,.110,.145,.132,.000),
 (.877,.221,.250,.217,.000),(.908,.310,.328,.299,.000),
 (.956,.371,.389,.369,.000),(1.030,.414,.434,.438,.000),
 (1.130,.458,.458,.504,.000),(1.260,.490,.484,.549,.000),
 (1.400,.511,.492,.558,.000),(1.510,.501,.474,.543,.000),
 (1.610,.458,.430,.501,.000),(1.710,.373,.346,.406,.000),
 (1.785,.262,.239,.286,.000),(1.830,.145,.132,.157,.000),
 (1.849,.024,.020,.025,.000),(1.850,.001,.001,.001,.000)]

def head_front(x,z):
    w,f,b,y=sample(head_profile,z)
    q=min(.999999,abs(x)/max(w,.001)); blend=max(0,min(1,(z-1.06)/.35));blend=blend*blend*(3-2*blend)
    power=2.04*(1-blend)+2.0*blend
    depth=f*max(0,1-q**power)**(1/power)
    # Cheek volume is sculpted into one surface, not added cheek spheres.
    depth+=.052*exp(-((abs(x)-.28)/.15)**2-((z-1.035)/.12)**2)*sqrt(max(0,1-q*q))
    depth-=.007*exp(-((abs(x)-.21)/.085)**2-((z-1.16)/.11)**2)
    return y-depth

verts=[]; faces=[]; N=128; NZ=136
for j in range(NZ+1):
    # More samples near crown and chin for continuous curvature.
    z=.85+(1-cos(pi*j/NZ))*.5
    w,f,b,y=sample(head_profile,z)
    for i in range(N):
        t=2*pi*i/N; x=w*sin(t)
        yy=head_front(x,z) if cos(t)>=0 else y-b* cos(t)
        verts.append((x,yy,z))
for j in range(NZ):
    for i in range(N): faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
faces.extend([tuple(reversed(range(N))),tuple(NZ*N+i for i in range(N))])
head=mesh('Head • shaped cranium cheeks and jaw',verts,faces,skin_color)
colors=head.data.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='POINT')
base=(1.0,.820,.700); tint=(.99,.650,.480)
for v,c in zip(head.data.vertices,colors.data):
    x,y,z=v.co
    a=.38*exp(-((abs(x)-.285)/.12)**2-((z-1.018)/.075)**2)*max(0,min(1,(-y-.10)/.15))
    crown=.45*max(0,min(1,(z-1.55)/.30))**1.5
    warm_crown=(1.0,.755,.655)
    col=[base[k]*(1-crown)+warm_crown[k]*crown for k in range(3)]
    c.color=tuple(linear(col[k]*(1-a)+tint[k]*a) for k in range(3))+(1,)

def face_patch(name,cx,cz,rx,rz,mat,offset=.003,bulge=.009):
    n=64; nr=12; vs=[(cx,head_front(cx,cz)-offset-bulge,cz)]; fs=[]
    for j in range(1,nr+1):
        r=j/nr
        for i in range(n):
            t=2*pi*i/n; x=cx+rx*r*cos(t); z=cz+rz*r*sin(t)
            vs.append((x,head_front(x,z)-offset-bulge*(1-r*r),z))
    for i in range(n): fs.append((0,1+i,1+(i+1)%n))
    for j in range(nr-1):
        a=1+j*n;b=a+n
        for i in range(n):fs.append((a+i,b+i,b+(i+1)%n,a+(i+1)%n))
    return mesh(name,vs,fs,mat)

for s,label in [(-1,'R'),(1,'L')]:
    # Rounded continuous ear shell with an actual bowl and a softly raised helix.
    def ear_position(x,y,z):
        angle=s*math.radians(40);dx=x-s*.445;dy=y-.020
        return (s*.407+dx*cos(angle)-dy*sin(angle),.065+dx*sin(angle)+dy*cos(angle),z)
    vs=[]; fs=[]; n=72; nr=24
    for side in [-1,1]:
        for j in range(nr+1):
            r=max(.0001,j/nr)
            for i in range(n):
                t=2*pi*i/n
                x=s*(.505+r*(.113*cos(t)+.020*sin(t)))
                z=1.100+r*(.138*sin(t)+.006*cos(t))
                if side==-1:
                    y=-.070-.047*exp(-((r-.76)/.24)**2)+.006*exp(-(r/.32)**2)
                    y-=.025*exp(-((r-.42)/.43)**2)*max(0,-sin(t))
                    # Continuous inner fold connected to the root, rather than
                    # an isolated pearl inside a uniformly round cup.
                    u,v=r*cos(t),r*sin(t);fold=[(-.80,-.42),(-.35,-.22),(-.27,.04),(-.42,.28),(-.72,.36)]
                    distance=2
                    for a,b in zip(fold,fold[1:]):
                        dx,dz=b[0]-a[0],b[1]-a[1]
                        f=max(0,min(1,((u-a[0])*dx+(v-a[1])*dz)/(dx*dx+dz*dz)))
                        distance=min(distance,math.hypot(u-a[0]-f*dx,v-a[1]-f*dz))
                    y-=.025*exp(-(distance/.16)**2)
                else:y=-.070+.084*sqrt(max(0,1-r*r))
                vs.append(ear_position(x,y,z))
    layer=(nr+1)*n
    for k in [0,layer]:
        for j in range(nr):
            for i in range(n):fs.append((k+j*n+i,k+j*n+(i+1)%n,k+(j+1)*n+(i+1)%n,k+(j+1)*n+i))
    for i in range(n):fs.append((nr*n+i,nr*n+(i+1)%n,layer+nr*n+(i+1)%n,layer+nr*n+i))
    fs.extend([tuple(reversed(range(n))),tuple(layer+i for i in range(n))])
    mesh('Ear.'+label,vs,fs,skin)
    # The inner fold is part of the shell above, not a separate bead.
    cx=s*.210
    face_patch('Eye white.'+label,cx,1.160,.077,.098,white,.003,.007)
    face_patch('Eye iris.'+label,cx-s*.003,1.158,.070,.094,black,.009,.014)
    gx=cx-.021;gz=1.207
    face_patch('Eye glint.'+label,gx,gz,.015,.018,glint,.028,.001)
    pts=[]
    for x,z in [(.143,1.341),(.167,1.354),(.210,1.354),(.257,1.339),(.286,1.315)]:
        pts.append((s*x,head_front(s*x,z)-.014,z))
    curve('Brow.'+label,pts,.026,brow,[.43,.95,1.05,.86,.2])

oval('Small rounded nose',(0,head_front(0,1.070)-.008,1.070),(.044,.033,.031),skin)
pts=[]
for x,z in [(-.085,1.003),(-.064,.984),(-.030,.974),(0,.972),(.030,.974),(.064,.984),(.085,1.003)]:
    pts.append((x,head_front(x,z)-.002,z))
curve('Smile',pts,.0049,lip,[.35,.8,1,1,1,.8,.35])
vs=[];fs=[]
for i in range(65):
    t=-1+2*i/64;x=.082*t
    upper=1.001-.011*(1-t*t);lower=1.001-.025*(1-t*t)
    for z in [lower,upper]:vs.append((x,head_front(x,z)-.0035,z))
for i in range(64):fs.append((i*2,i*2+1,i*2+3,i*2+2))
mesh('Subtle open smile',vs,fs,smile_inner)

def loft(name,rows,mat,n=64,step=4,cap=True):
    # z, center x, center y, half width, half depth
    vs=[];fs=[];count=(len(rows)-1)*step+1
    for j in range(count):
        z=rows[0][0]+(rows[-1][0]-rows[0][0])*j/(count-1)
        x,y,rx,ry=sample(rows,z)
        for i in range(n):
            t=2*pi*i/n;vs.append((x+rx*cos(t),y+ry*sin(t),z))
    for j in range(count-1):
        for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    if cap:fs.extend([tuple(reversed(range(n))),tuple((count-1)*n+i for i in range(n))])
    return mesh(name,vs,fs,mat)

def fuse(name,objects,voxel=.005,iterations=3):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();ob=bpy.context.object;ob.name=name
    bpy.ops.object.transform_apply(location=True,rotation=False,scale=True)
    ob.data.remesh_voxel_size=voxel;bpy.ops.object.voxel_remesh()
    sm=ob.modifiers.new('Continuous volume smoothing','SMOOTH');sm.factor=.6;sm.iterations=iterations
    bpy.ops.object.modifier_apply(modifier=sm.name)
    for f in ob.data.polygons:f.use_smooth=True
    return ob

def cut(ob,plane_co,plane_no):
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=plane_co,plane_no=plane_no,clear_outer=True,clear_inner=False)
    bm.to_mesh(ob.data);bm.free();ob.data.update()

# Anatomical base uses continuous sweeps, with no elbow/knee bead primitives.
torso=loft('Torso skin',[
    (.35,0,0,.20,.17),(.44,0,-.006,.254,.215),
    (.54,0,-.016,.255,.233),(.64,0,-.010,.235,.215),
    (.73,0,.003,.217,.186),(.78,0,.008,.173,.145),
    (.85,0,.015,.12,.12)],skin)
neck=oval('Neck',(0,.005,.825),(.125,.12,.09),skin)
bodyparts=[torso,neck]
arms=[]; feet=[]
for s,label in [(-1,'R'),(1,'L')]:
    arm=loft('Arm volume.'+label,[
      (.353,s*.401,-.005,.072,.070),(.400,s*.407,-.005,.080,.078),
      (.47,s*.395,.001,.090,.088),(.54,s*.366,.006,.093,.091),
      (.61,s*.322,.010,.098,.093),(.68,s*.282,.012,.104,.101),
      (.745,s*.245,.010,.100,.100),(.78,s*.223,.01,.070,.075)],skin)
    # Back of a closed fist: broad knuckles, fingers curled inward, not hanging.
    palm=loft('Fist volume.'+label,[
      (.322,s*.414,-.015,.025,.025),(.336,s*.420,-.018,.064,.061),
      (.369,s*.420,-.018,.092,.084),(.412,s*.410,-.014,.096,.089),
      (.450,s*.400,-.009,.087,.082),(.490,s*.397,-.004,.060,.060),
      (.508,s*.394,0,.020,.025)],skin)
    handparts=[arm,palm]
    thumb=oval('Thumb volume',(s*.337,-.066,.403),(.035,.045,.047),skin,32,24)
    thumb.rotation_euler.y=s*.38;handparts.append(thumb)
    arm=fuse('Continuous arm and fist.'+label,handparts,.0035,3)
    # Curl the lower palm edge into soft knuckle lobes in side view. Displace
    # the existing surface continuously instead of attaching finger spheres.
    for v in arm.data.vertices:
        x,y,z=v.co
        if z<.380 and s*x>.355:
            weight=exp(-((z-.337)/.031)**2)*min(1,(s*x-.355)/.045)
            lobes=sum(exp(-((y-center)/.017)**2) for center in [-.070,-.030,.010,.047])
            v.co.z-=.012*weight*lobes
    # A shallow sculpted fold around the curled thumb, not a seam between beads.
    fold=[(.343,.421),(.351,.405),(.363,.384),(.382,.382)]
    for v in arm.data.vertices:
        x,y,z=v.co
        if y>-.045 or z>.46 or z<.35:continue
        distance=1
        for a,b in zip(fold,fold[1:]):
            dx,dz=b[0]-a[0],b[1]-a[1]
            t=max(0,min(1,((s*x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)))
            distance=min(distance,math.hypot(s*x-a[0]-t*dx,z-a[1]-t*dz))
        v.co.y+=.008*exp(-(distance/.005)**2)*min(1,(-y-.045)/.025)
    arms.append(arm)
    # Feet: broad instep taper, integrated toes, shallow dorsum transition.
    leg=loft('Leg volume.'+label,[
      (.006,s*.193,-.050,.140,.148),(.022,s*.193,-.054,.154,.157),
      (.065,s*.190,-.047,.153,.161),(.105,s*.177,-.024,.131,.136),
      (.150,s*.165,.002,.108,.112),(.20,s*.163,.008,.113,.107),
      (.255,s*.153,.006,.119,.112),
      (.33,s*.143,.002,.124,.116),(.40,s*.128,.000,.120,.125)],skin)
    parts=[leg]
    for j in range(5):
        rad=[.046,.041,.035,.030,.025][j]
        parts.append(oval('Toe volume',(s*(.105+j*.052),-.190+j*.013,.043), (rad,.073-j*.003,.044-j*.003),skin,32,20))
    leg=fuse('Continuous leg and foot.'+label,parts,.0034,8)
    # Flat weight-bearing soles (only below the contact plane).
    for v in leg.data.vertices:
        if v.co.z+leg.location.z<.008:v.co.z=.008-leg.location.z
    feet.append(leg)

# Build cotton shirt as one continuous shoulder/torso surface; cut clean cuffs.
# A compact, rounded belly and back; the waist and collar taper into them.
# Keep shoulder/arm placement fixed so fullness does not close the armpit gap.
shirt_profile=[
    (.400,0,-.008,.270,.224),(.445,0,-.012,.280,.240),
    (.535,0,-.020,.283,.257),(.625,0,-.010,.266,.243),
    (.715,0,.003,.243,.211),(.780,0,.009,.208,.161),
    (.824,0,.01,.140,.117),(.837,0,.01,.116,.104)]
shirt=loft('Shirt torso',shirt_profile,cloth)
parts=[shirt]
for s in [-1,1]:
    sleeve=loft('Sleeve shaping volume',[
      (.58,s*.339,.012,.101,.100),(.65,s*.306,.010,.108,.107),
      (.71,s*.268,.010,.113,.119),(.762,s*.233,.010,.102,.112),
      (.795,s*.215,.010,.084,.096),(.818,s*.188,.010,.035,.058)],cloth)
    parts.append(sleeve)
shirt=fuse('T-shirt • connected shoulders',parts,.0038,4)
cut(shirt,(0,0,.418),(0,0,-1))
for s in [-1,1]:
    # Restrict cuff cutting to the corresponding outer sleeve, away from torso.
    bm=bmesh.new();bm.from_mesh(shirt.data)
    chosen=[v for v in bm.verts if s*v.co.x>.278 and v.co.z>.55]
    chosen_set=set(chosen)
    edges=[e for e in bm.edges if all(v in chosen_set for v in e.verts)]
    faces_sel=[f for f in bm.faces if all(v in chosen_set for v in f.verts)]
    bmesh.ops.bisect_plane(bm,geom=chosen+edges+faces_sel,dist=.00001,plane_co=(s*.327,.01,.620),plane_no=(s*.53,0,-.848),clear_outer=True,clear_inner=False)
    bm.to_mesh(shirt.data);bm.free()
# Cut a true round neckline into the shaped shoulder surface. Its front edge
# follows the chest lower than its back edge, exposing a short natural neck.
bpy.context.view_layer.update()
bvh=BVHTree.FromObject(shirt,bpy.context.evaluated_depsgraph_get())
neckline=[]
for i in range(97):
    t=2*pi*i/96;x=.137*cos(t);y=-.007+.147*sin(t)
    hit=bvh.ray_cast(Vector((x,y,1.1)),Vector((0,0,-1)))[0]
    if hit is not None:neckline.append((x,y,hit.z+.002))
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=1,depth=1,location=(0,-.007,1.25))
cutter=bpy.context.object;cutter.name='Neck opening cutter';cutter.scale=(.135,.145,1)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
bpy.context.view_layer.objects.active=shirt
boolean=shirt.modifiers.new('Round neckline opening','BOOLEAN');boolean.operation='DIFFERENCE';boolean.object=cutter
bpy.ops.object.modifier_apply(modifier=boolean.name);bpy.data.objects.remove(cutter,do_unlink=True)
solid=shirt.modifiers.new('Cotton fabric thickness','SOLIDIFY');solid.thickness=.006;solid.offset=-.5
bev=shirt.modifiers.new('Soft cut edges','BEVEL');bev.width=.002;bev.segments=2

# Thin circular neckline and hem track the actual garment, not large donut trims.
curve('Neck binding',neckline,.0055,cloth_edge)
_,hem_y,hem_w,hem_d=sample(shirt_profile,.430)
coords=[((hem_w+.001)*cos(2*pi*i/96),hem_y+(hem_d+.001)*sin(2*pi*i/96),.430) for i in range(97)]
curve('Shirt hem piping',coords,.008,cloth_edge)

# Shorts: join the hip to two real separated leg tubes, then cut each opening.
hip=oval('Shorts hip',(0,.002,.390),(.279,.218,.116),cloth)
parts=[hip]
parts.append(loft('Shorts waist overlap',[
    (.355,0,.002,.253,.194),(.385,0,.001,.272,.224),
    (.415,0,-.002,.278,.234),(.448,0,-.002,.270,.229)],cloth))
for s in [-1,1]:
    parts.append(loft('Short leg tube',[(.208,s*.157,0,.130,.143),(.27,s*.156,.001,.135,.159),(.34,s*.138,.002,.145,.172),(.42,s*.12,0,.13,.157)],cloth))
shorts=fuse('Shorts • shaped hip and separate legs',parts,.0038,12)
cut(shorts,(0,0,.433),(0,0,1));cut(shorts,(0,0,.242),(0,0,-1))
solid=shorts.modifiers.new('Cotton fabric thickness','SOLIDIFY');solid.thickness=.006;solid.offset=-.5
bev=shorts.modifiers.new('Soft cut edges','BEVEL');bev.width=.002;bev.segments=2
for s,label in [(-1,'R'),(1,'L')]:
    coords=[(s*.156+.134*cos(2*pi*i/80),.001+.153*sin(2*pi*i/80),.252) for i in range(81)]
    curve('Short hem.'+label,coords,.008,cloth_edge)

# Studio is strictly a review rig, not a replacement scene or game style work.
ground=material('Review background',(.96,.943,.907),.9)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,0));floor=bpy.context.object;floor.name='Review floor';floor.data.materials.append(ground)
floor.is_shadow_catcher=True
world=bpy.data.worlds.new('Neutral review world');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(1,.98,.95,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.38;bpy.context.scene.world=world
def area(name,pos,power,size,color):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
area('Large soft key',(-3,-4,6),300,3.5,(1,.97,.94))
area('Front fill',(3,-4,3),65,3,(.96,.98,1))
area('Soft rear light',(1,3,4),100,3,(1,.97,.93))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=int(os.environ.get('REVIEW_SAMPLES','48'));scene.cycles.use_denoising=False
scene['model_revision']=REV
scene.cycles.use_adaptive_sampling=True;scene.cycles.adaptive_threshold=.025;scene.cycles.adaptive_min_samples=16
scene.cycles.max_bounces=6;scene.cycles.diffuse_bounces=3;scene.cycles.glossy_bounces=3
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.film_transparent=True
scene.use_nodes=True;nodes=scene.node_tree.nodes;nodes.clear()
rl=nodes.new('CompositorNodeRLayers');over=nodes.new('CompositorNodeAlphaOver');output=nodes.new('CompositorNodeComposite')
over.inputs[1].default_value=tuple(linear(c) for c in (.985,.978,.956))+(1,)
scene.node_tree.links.new(rl.outputs['Image'],over.inputs[2]);scene.node_tree.links.new(over.outputs[0],output.inputs[0])
scene.render.image_settings.file_format='PNG';scene.render.resolution_x=720;scene.render.resolution_y=880;scene.render.resolution_percentage=100
camd=bpy.data.cameras.new('Review camera');cam=bpy.data.objects.new('Review camera',camd);bpy.context.collection.objects.link(cam);scene.camera=cam
camd.type='ORTHO';camd.ortho_scale=2.16;camd.lens=60
def render(name,pos,target=(0,0,.93),scale=2.16,size=None):
    cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();camd.ortho_scale=scale
    if size:scene.render.resolution_x,scene.render.resolution_y=size
    scene.render.filepath=os.path.join(OUT,REV+'-'+name+'.png');bpy.ops.render.render(write_still=True)
cam.location=(0,-7,1.08);cam.rotation_euler=(Vector((0,0,.93))-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,REV+'.blend'))
views=os.environ.get('REVIEW_VIEWS','front,side,back,game').split(',')
for name in views:
    if name=='front':render(name,(0,-7,1.08))
    elif name=='side':render(name,(7,-1.88,1.08))
    elif name=='profile':render(name,(7,0,.98))
    elif name=='back':render(name,(0,7,1.08))
    elif name=='game':render(name,(3,-7,4.3),scale=2.35)
    elif name=='game_front':render(name,(0,-7,4.3),scale=2.35)
    elif name=='mobile':render(name,(0,-7,4.3),scale=2.35,size=(180,220))
    elif name=='hand':render(name,(3,-3,1.0),target=(.4,-.02,.43),scale=.45,size=(600,600))
print('SAVED_REFERENCE_STUDY',REV)
