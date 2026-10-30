"""Dress the shared base asset; never generate another body, rig or action.
blender -b -t 8 --python studies/farmer/build_farmer.py -- --output /tmp/farmer-review
"""
import bpy, bmesh, math, os, argparse, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
from math import sin, cos, pi, sqrt
p=argparse.ArgumentParser();p.add_argument('--output',default=str(Path(__file__).parent));a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(Path(__file__).resolve().parents[1]/'base-human/base-human.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['BaseHumanRig'];rig.animation_data.action=bpy.data.actions['Walk'];scene.frame_set(0)
original=[o for o in scene.objects if o.type=='MESH' and o.parent==rig]
added=[]
def linear(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def material(name,rgb,rough=.8,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;q=m.node_tree.nodes['Principled BSDF'];rgba=tuple(linear(c) for c in rgb)+(1,);q.inputs['Base Color'].default_value=rgba;q.inputs['Roughness'].default_value=rough;q.inputs['Metallic'].default_value=metal;q.inputs['Specular IOR Level'].default_value=.25;m.diffuse_color=rgba;return m
blue=material('Farmer • indigo cotton',(.30,.51,.75));blue_edge=material('Farmer • blue seams',(.24,.40,.61))
pants=material('Farmer • charcoal trousers',(.21,.25,.29));leather=material('Farmer • chestnut apron',(.61,.43,.28));edge=material('Farmer • leather edges',(.45,.30,.18));boots=material('Farmer • brown boots',(.40,.26,.16));sole=material('Farmer • dark soles',(.19,.125,.08))
beige=material('Farmer • linen headwrap',(.98,.91,.79),.88);hair=material('Farmer • deep brown hair',(.22,.12,.067),.8);gold=material('Farmer • aged brass',(.79,.57,.28),.55,.25);wood=material('Farmer • ash handle',(.46,.29,.15));iron=material('Farmer • forged hoe',(.48,.52,.56),.65,.35)

def mesh(name,vs,fs,mat,sub=0,thick=0):
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);me.materials.append(mat)
 bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free()
 for f in me.polygons:f.use_smooth=True
 if sub:
  m=o.modifiers.new('Cloth curvature','SUBSURF');m.levels=sub
 if thick:
  m=o.modifiers.new('Fabric thickness','SOLIDIFY');m.thickness=thick;m.offset=0
 added.append(o);return o

def oval(name,pos,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=pos);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=True,rotation=False,scale=True);o.data.materials.append(mat)
 for f in o.data.polygons:f.use_smooth=True
 added.append(o);return o

def tube(name,pts,radius,mat):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=12;cu.bevel_depth=radius;cu.bevel_resolution=3;cu.use_fill_caps=True;sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
 for b,co in zip(sp.bezier_points,pts):b.co=co;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);cu.materials.append(mat);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');added.append(o);return o

def bind(o,bone=None,source=None):
 # Bake garment shaping before skinning. Transfer the exact source triangle's
 # weights, not an independent height-based rig approximation.
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
 for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
 if bone:
  g=o.vertex_groups.new(name=bone);g.add(list(range(len(o.data.vertices))),1,'REPLACE')
 else:
  source.data.calc_loop_triangles();tris=list(source.data.loop_triangles)
  coords=[v.co.copy() for v in source.data.vertices];tree=BVHTree.FromPolygons(coords,[t.vertices for t in tris],all_triangles=True)
  groups={g.name:o.vertex_groups.new(name=g.name) for g in source.vertex_groups}
  for v in o.data.vertices:
   hit,_,idx,_=tree.find_nearest(v.co);ids=tris[idx].vertices;uv=barycentric_transform(hit,*[coords[i] for i in ids],Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
   weights={}
   for i,f in zip(ids,uv):
    for g in source.data.vertices[i].groups:
     n=source.vertex_groups[g.group].name;weights[n]=weights.get(n,0)+max(0,f)*g.weight
   total=sum(weights.values())
   for n,w in weights.items():
    if w>1e-7:groups[n].add([v.index],w/total,'REPLACE')
 m=o.modifiers.new('Shared base deformation','ARMATURE');m.object=rig;o.parent=rig

shirt=bpy.data.objects['T-shirt • connected shoulders'];shorts=bpy.data.objects['Shorts • shaped hip and separate legs']
for o in [shirt,bpy.data.objects['Shirt hem piping'],bpy.data.objects['Neck binding']]:o.data.materials.clear();o.data.materials.append(blue if o==shirt else blue_edge)
shorts.data.materials.clear();shorts.data.materials.append(pants)
for label in ['L','R']:bpy.data.objects['Short hem.'+label].hide_render=True;bpy.data.objects.remove(bpy.data.objects['Short hem.'+label],do_unlink=True)
# Sample the actual rounded shirt/hip for fitted straps, bib and belt.
body=bpy.data.objects['Torso skin']
shirt_tree=BVHTree.FromPolygons([v.co.copy() for v in shirt.data.vertices],[p.vertices[:] for p in shirt.data.polygons])
hip_tree=BVHTree.FromPolygons([v.co.copy() for v in shorts.data.vertices],[p.vertices[:] for p in shorts.data.polygons])
def surface(x,z,front=True):
 tree=shirt_tree if z>=.43 else hip_tree;sign=-1 if front else 1
 h=tree.ray_cast(Vector((x,sign*2,z)),Vector((0,-sign,0)))[0]
 return h.y if h else sign*.18

def panel(name,z0,z1,width,mat,offset=.014):
 vs=[];fs=[];n=32;m=24
 for j in range(m+1):
  t=j/m;z=z0+(z1-z0)*t;w=width(t)
  for i in range(n+1):
   x=w*(2*i/n-1);vs.append((x,surface(x,z)-offset,z))
 for j in range(m):
  for i in range(n):k=j*(n+1)+i;fs.append((k,k+1,k+n+2,k+n+1))
 o=mesh(name,vs,fs,mat,sub=1,thick=.010);bind(o,source=shirt if z0>=.43 else shorts);return o
# Lower apron wraps the belly instead of standing away as a rigid plate.
apron=panel('Apron • curved skirt',.325,.51,lambda t:.233+.012*sin(pi*t),leather,.025)
bib=panel('Apron • fitted bib',.49,.665,lambda t:.208-.052*t,leather,.021)
# Bib follows torso/pelvis blend exactly at its boundary.
# Rebind the lower apron against the shirt above the belt and pelvis below it.
for v in apron.data.vertices:
 if v.co.z>.42:
  for g in apron.vertex_groups:g.remove([v.index])
  pelvis=max(0,min(1,(.56-v.co.z)/.16));pelvis=pelvis*pelvis*(3-2*pelvis)
  for n,w in [('pelvis',pelvis),('torso',1-pelvis)]:
   g=apron.vertex_groups.get(n) or apron.vertex_groups.new(name=n);g.add([v.index],w,'REPLACE')
for side in [-1,1]:
 # Trace the real shoulder from inside the shirt; every strip edge lies
 # on the same curved surface, including the top turn.
 vs=[];fs=[];n=80
 for j in range(n+1):
  a=-.12+(pi+.24)*j/n
  for u in [-1,1]:
   x=side*(.153+.012*sin(a))+u*.029
   d=Vector((0,-cos(a),sin(a)))
   h,normal,_,_=shirt_tree.ray_cast(Vector((x,0,.55)),d)
   if h is None:raise RuntimeError('Suspender missed shared shirt')
   vs.append(h+d*.014)
 for j in range(n):k=j*2;fs.append((k,k+1,k+3,k+2))
 o=mesh('Suspender.'+str(side),vs,fs,edge,thick=.010);bind(o,source=shirt)
 for front in [True,False]:
  x=side*.153;z=.639 if front else .55;y=surface(x,z,front)+(-.042 if front else .035)
  o=oval('Brass suspender rivet',(x,y,z),(.012,.007,.012),gold);bind(o,source=shirt)
# Belt conforms to the waist, crossing the apron with rounded edges.
vs=[];fs=[];n=128
for j,z in enumerate([.409,.414,.457,.462]):
 for i in range(n):
  a=2*pi*i/n;vs.append((.290*cos(a),-.006+.265*sin(a),z))
for j in range(3):
 for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
o=mesh('Belt • wrapped waist',vs,fs,edge,sub=1,thick=.009);bind(o,source=shirt)
o=tube('Belt buckle',[(-.048,-.285,.416),(-.054,-.285,.423),(-.054,-.285,.452),(-.048,-.285,.459),(.048,-.285,.459),(.054,-.285,.452),(.054,-.285,.423),(.048,-.285,.416),(-.048,-.285,.416)],.008,gold);bind(o,source=shirt)
# Collar flaps are projected onto the existing shirt's curved upper chest.
for s in [-1,1]:
 points=[(s*.025,.786),(s*.090,.810),(s*.153,.745),(s*.070,.713)]
 vs=[(x,surface(x,z)-.014,z) for x,z in points];o=mesh('Blue collar.'+str(s),vs,[(0,1,2,3)],blue_edge,sub=2,thick=.012);bind(o,source=shirt)
# Trouser extensions and round boots share the original leg skin weights.
def rings(name,rows,mat):
 vs=[];fs=[];n=64
 for z,cx,cy,rx,ry in rows:
  for i in range(n):a=2*pi*i/n;vs.append((cx+rx*cos(a),cy+ry*sin(a),z))
 for j in range(len(rows)-1):
  for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 fs.extend([tuple(reversed(range(n))),tuple((len(rows)-1)*n+i for i in range(n))]);return mesh(name,vs,fs,mat,sub=2)
for s,label in [(-1,'R'),(1,'L')]:
 leg=bpy.data.objects['Continuous leg and foot.'+label]
 o=rings('Trouser cuff.'+label,[(.14,s*.166,.004,.115,.115),(.17,s*.164,.005,.123,.122),(.23,s*.158,.003,.132,.144),(.27,s*.156,.001,.132,.150),(.28,s*.156,.001,.130,.151)],pants);bind(o,source=leg)
 o=rings('Boot.'+label,[(.003,s*.199,-.066,.152,.182),(.014,s*.199,-.067,.167,.205),(.043,s*.196,-.064,.170,.216),(.074,s*.190,-.054,.161,.207),(.110,s*.181,-.029,.145,.170),(.148,s*.167,.003,.125,.128),(.195,s*.164,.005,.123,.122),(.204,s*.164,.005,.121,.121)],boots);bind(o,source=leg)
 o=rings('Boot sole.'+label,[(.003,s*.199,-.066,.152,.182),(.008,s*.199,-.067,.169,.207),(.025,s*.198,-.067,.171,.209),(.031,s*.197,-.066,.166,.205)],sole);bind(o,bone='foot.'+label)
 # Small soft leather side pocket, fitted close to the hip.
 o=oval('Tool pouch.'+label,(s*.275,-.014,.387),(.056,.098,.085),leather);bind(o,bone='pelvis')
# Use the actual shared head as a wrapping surface.
head=bpy.data.objects['Head • shaped cranium cheeks and jaw'];tree=BVHTree.FromPolygons([v.co.copy() for v in head.data.vertices],[p.vertices[:] for p in head.data.polygons]);center=Vector((0,0,1.32))
def scalp(theta,phi,offset):
 d=Vector((sin(phi)*sin(theta),-sin(phi)*cos(theta),cos(phi)))
 h,n,_,_=tree.ray_cast(center,d)
 return h+d*offset if h else center+d*.5

def cap(name,limit,offset,mat):
 vs=[];fs=[];n=128;m=40
 for j in range(m+1):
  for i in range(n):
   t=2*pi*i/n;phi=.001+(limit(t)-.001)*j/m;vs.append(scalp(t,phi,offset(t,phi) if callable(offset) else offset))
 for j in range(m):
  for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 fs.append(tuple(reversed(range(n))));o=mesh(name,vs,fs,mat,thick=.016 if mat==beige else .012)
 if mat==beige:
  bevel=o.modifiers.new('Soft linen hem','BEVEL');bevel.width=.003;bevel.segments=3
 bind(o,bone='head');return o
cap('Hair • wrapped scalp',lambda t:1.22+.82*(1-cos(t))*.5,.028,hair)
limit=lambda t:1.12+.56*(1-cos(t))*.5+.045*sin(t)
# Broad diagonal cloth folds converge toward the back knot. Their unequal
# spacing leaves a clean crown instead of three uniform concentric ridges.
def cloth_offset(t,phi):
 rear=((1-cos(t))*.5)**2
 folds=[(limit(t)-.12+.12*sin(t),.015,.115),
        (.76+.24*sin(t-.35)+.06*sin(2*t),.020,.13),
        (.43-.13*sin(t+.6)+.03*cos(2*t),.012,.16)]
 offset=.063+.006*sin(t+.4)*sin(phi)**2
 for center,height,width in folds:
  center=center*(1-rear)+(limit(t)-.12)*rear
  offset+=height*math.exp(-((phi-center)/width)**2)
 return offset
cap('Headwrap • complete folded crown',limit,cloth_offset,beige)
# Curved tapered fringe patches rooted beneath the linen edge.
for k,(x0,x1,bottom) in enumerate([(-.38,-.13,1.348),(-.17,.13,1.305),(.12,.37,1.36)]):
 vs=[];fs=[];n=20;m=24
 for j in range(m+1):
  t=j/m;z=bottom+(1.54-bottom)*t;w=(x1-x0)/2*sqrt(max(.002,1-(1-t)**2));cx=(x0+x1)/2+.045*(1-t)
  for i in range(n+1):
   q=2*i/n-1;x=cx+w*q;h=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))[0];y=h.y if h else -.30
   vs.append((x,y-.020-.045*(1-q*q)*sin(pi*(.15+.7*t)),z))
 for j in range(m):
  for i in range(n):a=j*(n+1)+i;fs.append((a,a+1,a+n+2,a+n+1))
 o=mesh('Hair • swept fringe '+str(k),vs,fs,hair,sub=1,thick=.016);bind(o,bone='head')
o=oval('Headwrap knot',(0,.524,1.241),(.078,.058,.071),beige);bind(o,bone='head')
for s in [-1,1]:
 o=rings('Linen tie.'+str(s),[(.998,s*.09,.468,.006,.006),(1.025,s*.10,.498,.045,.022),(1.10,s*.073,.538,.046,.021),(1.18,s*.025,.55,.025,.018),(1.24,0,.526,.018,.014)],beige);bind(o,bone='head')
# A compact held hoe clears the face throughout the existing Run arm arc.
o=tube('Hoe • wooden handle',[(-.384,-.078,.285),(-.384,-.078,.485),(-.384,-.078,.716)],.019,wood);bind(o,bone='hand.R')
o=tube('Hoe • iron socket',[(-.384,-.078,.655),(-.384,-.078,.726)],.026,iron);bind(o,bone='hand.R')
vs=[(-.40,-.103,.714),(-.59,-.103,.635),(-.63,-.103,.52),(-.54,-.103,.54),(-.40,-.053,.714),(-.59,-.053,.635),(-.63,-.053,.52),(-.54,-.053,.54)]
o=mesh('Hoe • broad blade',vs,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],iron)
m=o.modifiers.new('Forged rounded edge','BEVEL');m.width=.012;m.segments=3;bind(o,bone='hand.R')
# Covered base legs remain in the blend as the weight source; exclude them
# from the dressed export so they cannot poke through the opaque boots.
for label in ['L','R']:
 o=bpy.data.objects['Continuous leg and foot.'+label];o.hide_render=True;o.hide_set(True)
scene['model_revision']='farmer-shared-v12';scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
 if o==rig or (o.parent==rig and not o.name.startswith('Continuous leg')):o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(out/'farmer.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'farmer.glb'),export_format='GLB',use_selection=True,export_apply=False,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_frame_range=True,export_force_sampling=True,export_skins=True,export_extras=True,export_yup=True,export_anim_slide_to_zero=True)
print('FARMER_EXPORTED',len(rig.data.bones),[x.name for x in bpy.data.actions])
