"""Author the map-redesign review assets; never writes production game assets.

Reference: the map + creek/forest concept images approved in the conversation
on 2026-11-04. Native Blender curves/remesh fuse the trunk forks. Foliage is
rounded, connected full crowns with broad matte color gradients. Ordinary
trees follow the one-cell canopy size requested on 2026-11-05.
Run: blender -b -t 2 --factory-startup --python studies/map-art/build_models.py -- oak
"""
import bpy
import bmesh
import math
import random
import sys
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
TAU = math.tau


def srgb(v):
    return v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4


def color(hexcode):
    s = hexcode.lstrip('#')
    return tuple(srgb(int(s[i:i+2], 16) / 255) for i in (0, 2, 4))


def blend(a, b, t):
    return tuple(x*(1-t)+y*t for x, y in zip(a, b))


def mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 1
    bsdf.inputs['Specular IOR Level'].default_value = 0
    attr = m.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Color'
    m.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    m.diffuse_color = (.4, .5, .2, 1)
    return m


def mesh(name, verts, faces, colors, material, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    attr = data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
    for i, value in enumerate(colors):
        attr.data[i].color = (*value, 1)
    for f in data.polygons:
        f.use_smooth = smooth
    return obj


class Leaves:
    def __init__(self, material):
        self.verts, self.faces, self.colors = [], [], []
        self.material = material

    def leaf(self, start, direction, length, width, shade, curl=.28, twist=0):
        """A plump leaf with a raised midrib and a closed rounded perimeter."""
        p = Vector(start)
        f = Vector(direction).normalized()
        right = f.cross(Vector((0, 0, 1))).normalized()
        if right.length < .1:
            right = Vector((1, 0, 0))
        up = right.cross(f).normalized()
        n = len(self.verts)
        steps = 7
        for side in (1, -1):
            for j in range(steps+1):
                t = j/steps
                w = max(.045, math.sin(math.pi*t)**.53) * width
                for k in (-1, 0, 1):
                    lift = math.sin(math.pi*t)*length*.16 - t*t*length*curl
                    lift += (1-abs(k)) * w * .22 + side*.012*math.sin(math.pi*t)
                    pos = p + f*(t*length) + right*(k*w) + up*(lift + twist*k*t*width)
                    self.verts.append(tuple(pos))
                    # A broad painted gradient, without image noise or specular highlights.
                    factor = (.78 if side < 0 else .93) + .12*t + .035*(1-abs(k))
                    self.colors.append(tuple(min(1, c*factor) for c in shade))
        layer = (steps+1)*3
        for j in range(steps):
            for k in range(2):
                a = n+j*3+k
                self.faces.append((a, a+3, a+4, a+1))
                a += layer
                self.faces.append((a, a+1, a+4, a+3))
        ring = [0, 1, 2] + [j*3+2 for j in range(1,steps+1)] + [steps*3+1,steps*3] + [j*3 for j in range(steps-1,0,-1)]
        for a,b in zip(ring,ring[1:]+ring[:1]):
            self.faces.append((n+a,n+b,n+b+layer,n+a+layer))

    def spray(self, center, size, palette, seed, count=9, slope=.18):
        rng = random.Random(seed)
        for i in range(count):
            a = i*TAU/count+rng.uniform(-.14,.14)
            z = rng.uniform(-slope, slope*.6)
            length = size*rng.uniform(.78,1.15)
            self.leaf(center,(math.cos(a),math.sin(a),z),length,length*.36,
                      color(rng.choice(palette)), curl=rng.uniform(.09,.2),twist=rng.uniform(-.18,.18))
        for i in range(3):
            a = rng.random()*TAU
            self.leaf(Vector(center)+Vector((0,0,.06)), (math.cos(a),math.sin(a),.6),size*.65,size*.26,color(palette[-1]),curl=.12)

    def finish(self, name):
        return mesh(name,self.verts,[f[::-1] for f in self.faces],self.colors,self.material)


def tube(points, radii, parts):
    c = bpy.data.curves.new('branch', 'CURVE')
    c.dimensions = '3D'
    c.resolution_u = 7
    c.bevel_depth = 1
    c.bevel_resolution = 3
    c.use_fill_caps = True
    s = c.splines.new('BEZIER')
    s.bezier_points.add(len(points)-1)
    for p,co,r in zip(s.bezier_points,points,radii):
        p.co = co
        p.radius = r
        p.handle_left_type = p.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new('branch',c)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    parts.append(bpy.context.object)


def fused_wood(parts, name, material, voxel=.055):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    mod = obj.modifiers.new('Continuous roots and forks','REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=mod.name)
    smooth = obj.modifiers.new('Soft junctions','SMOOTH')
    smooth.factor = 1.1
    smooth.iterations = 4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    obj.data.materials.clear()
    obj.data.materials.append(material)
    attr = obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    dark,light = color('#694428'),color('#a7773f')
    for v in obj.data.vertices:
        x,y,z=v.co
        strokes = math.sin(math.atan2(y,x)*11+z*.7)*.08 + math.sin(x*11+y*13+z*.4)*.035
        t = max(.04,min(.95,.38+z*.06+strokes))
        attr.data[v.index].color=(*blend(dark,light,t),1)
    for f in obj.data.polygons:
        f.use_smooth=True
    return obj


def round_crown(name, lobes, material, palette):
    """Connected cloud-like crown with broad rounded lobes and soft color depth."""
    parts=[]
    for at,size in lobes:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=at)
        obj=bpy.context.object;obj.scale=size
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        parts.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
    obj=bpy.context.object;obj.name=name
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    remesh=obj.modifiers.new('Joined full crown','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.04
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth=obj.modifiers.new('Rounded lobe junctions','SMOOTH');smooth.factor=.85;smooth.iterations=4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    obj.data.materials.append(material)
    attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    low,mid,high=map(color,palette)
    floor=min(v.co.z for v in obj.data.vertices);height=max(v.co.z for v in obj.data.vertices)-floor
    for v in obj.data.vertices:
        x,y,z=v.co;t=max(0,min(1,(z-floor)/height))
        # Broad gradients keep the surface matte, without tiny leaf tessellation.
        c=blend(low,mid,min(1,t/.52)) if t<.52 else blend(mid,high,(t-.52)/.48)
        warmth=1+.025*math.sin(x*3+y*2)
        attr.data[v.index].color=(*[min(1,a*warmth) for a in c],1)
    for face in obj.data.polygons:face.use_smooth=True
    return obj


def rounded_tree(kind='oak'):
    wood,foliage=mat('Warm rounded bark'),mat('Full matte foliage')
    pine=kind=='pine';pink=kind=='blossom';fruit=kind=='fruit';small=kind=='sapling'
    parts=[]
    tube([(0,0,.03),(-.06,.02,.5),(.03,0,1.1),(-.02,.03,1.8),(.03,.01,2.4)],
         [.18,.145,.115,.08,.018],parts)
    if not pine:
        tube([(-.02,0,.8),(-.19,.02,1.15),(-.42,.05,1.52)], [.12,.09,.02],parts)
        tube([(.02,0,1.02),(.23,-.04,1.28),(.42,-.1,1.68)], [.105,.075,.02],parts)
        tube([(.02,0,1.3),(.05,.25,1.6),(.12,.35,1.9)], [.08,.05,.015],parts)
    for i in range(5):
        a=i*TAU/5+.3
        tube([(0,0,.22),(math.cos(a)*.19,math.sin(a)*.19,.07),(math.cos(a)*.32,math.sin(a)*.32,.025)], [.10,.075,.012],parts)
    fused_wood(parts,kind+' · rounded rooted trunk',wood,.025)
    if pine:
        # Plump, overlapping branch tiers keep the conifer silhouette soft.
        lobes=[]
        for level,(z,r,h) in enumerate([(1.05,.75,.48),(1.57,.60,.47),(2.05,.45,.44),(2.47,.29,.42)]):
            lobes.append(((.025*math.sin(level),0,z),(r,r*.94,h)))
            for i in range(5):
                a=i*TAU/5+level*.5
                lobes.append(((math.cos(a)*r*.62,math.sin(a)*r*.62,z-.08),(r*.43,r*.42,h*.69)))
        palette=['#357349','#579747','#87b656']
    else:
        lobes=[((-.43,.02,1.75),(.49,.48,.51)),((.43,-.05,1.88),(.49,.47,.54)),
               ((-.04,.34,2.03),(.53,.45,.59)),((-.04,-.30,2.10),(.53,.48,.59)),
               ((-.23,.0,2.40),(.49,.46,.54)),((.26,.08,2.35),(.48,.45,.52))]
        if small:lobes=[((x*.84,y*.84,z*.90),(a*.84,b*.84,c*.91)) for (x,y,z),(a,b,c) in lobes]
        if fruit:lobes=[((x,y,z*.88),(a,b,c*.90)) for (x,y,z),(a,b,c) in lobes]
        if pink:lobes=[((x,y,z*.94),(a,b,c*.94)) for (x,y,z),(a,b,c) in lobes]
        palette=['#477b35','#78a83e','#a8c956'] if not pink else ['#bf628d','#e08eac','#efb4c8']
    round_crown(kind+' · full rounded crown',lobes,foliage,palette)
    if fruit:
        fruitmat=mat('Matte red apples')
        for i in range(9):
            a=i*TAU/9+.2;dx,dy=math.cos(a),math.sin(a);z=1.43+(i%3)*.24;r=0
            for (cx,cy,cz),(sx,sy,sz) in lobes:
                aa=dx*dx/(sx*sx)+dy*dy/(sy*sy);bb=-2*(dx*cx/(sx*sx)+dy*cy/(sy*sy))
                cc=cx*cx/(sx*sx)+cy*cy/(sy*sy)+(z-cz)**2/(sz*sz)-1;discriminant=bb*bb-4*aa*cc
                if discriminant>=0:r=max(r,(-bb+math.sqrt(discriminant))/(2*aa))
            ellipsoid('Apple',(dx*(r+.035),dy*(r+.035),z),(.10,.10,.11),'#df5735',fruitmat)
    # One ordinary crown is approximately one 1.688-world-unit grid cell.
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    radius=max(math.hypot(*(o.matrix_world@v.co)[:2]) for o in objects for v in o.data.vertices)
    factor=(1.62 if not small else 1.48)/(radius*2)
    for obj in objects:
        obj.location.x*=factor;obj.location.y*=factor
        for v in obj.data.vertices:v.co.x*=factor;v.co.y*=factor


def oak():
    rounded_tree('oak')


def painted(obj, material, shade, variation=.06):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    attr=obj.data.color_attributes.get('Color') or obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    base=color(shade)
    for v in obj.data.vertices:
        t=1+math.sin(v.co.x*2+v.co.y*1.7+v.co.z*1.3)*variation
        attr.data[v.index].color=(*[min(1,c*t) for c in base],1)
    for p in obj.data.polygons:p.use_smooth=True
    return obj


def ellipsoid(name,at,size,shade,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,location=at)
    obj=bpy.context.object
    obj.name=name
    obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return painted(obj,material,shade)


def small_tree(kind='sapling'):
    rounded_tree(kind)


def pine():
    rounded_tree('pine')


def bush():
    leaves=Leaves(mat('Shrub foliage'))
    for i,(x,y,z,s) in enumerate([(-.3,0,.45,.52),(.3,.12,.6,.6),(0,-.2,.85,.6)]):
        leaves.spray((x,y,z),s,['#507f35','#75a33c','#98b94b'],125+i,count=9)
        for j in range(3):
            a=j*TAU/3
            leaves.spray((x+math.cos(a)*.25,y+math.sin(a)*.25,z-.17),s*.7,['#426c32','#689738','#84ad42'],145+i*3+j,count=6)
    leaves.finish('Shrub · open leaf sprays')


def reeds():
    leaves=Leaves(mat('Reed leaves'))
    parts=[]
    stalk=mat('Reed stems and seedheads')
    rng=random.Random(167)
    for i in range(11):
        a=i*2.4;r=rng.uniform(.03,.4);h=rng.uniform(.8,1.65)
        x,y=math.cos(a)*r,math.sin(a)*r
        tube([(x,y,0),(x+.03,y,h*.55),(x+.12,y+.04,h)],[.027,.022,.015],parts)
        for k in range(3):
            ang=a+k*1.9
            leaves.leaf((x,y,.15+k*.16),(math.cos(ang)*.5,math.sin(ang)*.5,.86),h*.63,.085,color(['#638437','#81a43d','#a3b84e'][k]),curl=.3)
        if i%2==0:
            ellipsoid('Reed seedhead',(x+.12,y+.04,h),(.065,.065,.18),'#a8844a',stalk)
    fused_wood(parts,'Reeds · stems',stalk,.018)
    leaves.finish('Reeds · curved blades')


def grass():
    leaves=Leaves(mat('Grass blades'))
    rng=random.Random(735)
    for i in range(13):
        a=i*2.4
        leaves.leaf((rng.uniform(-.15,.15),rng.uniform(-.15,.15),.015),(math.cos(a)*.6,math.sin(a)*.6,.9),rng.uniform(.3,.6),.045,
                    color(['#65903b','#85a945','#a0b94e'][i%3]),curl=.2)
    leaves.finish('Grass · curved tuft')


def flowers():
    leafmat,petalmat=mat('Meadow leaves'),mat('Soft flower petals')
    leaves=Leaves(leafmat)
    petals=Leaves(petalmat)
    for i in range(7):
        a=i*2.4;r=.2+(i%3)*.12
        x,y=math.cos(a)*r,math.sin(a)*r
        h=.25+(i%3)*.08
        for j in range(5):
            angle=j*TAU/5
            petals.leaf((x,y,h),(math.cos(angle),math.sin(angle),.2),.13,.066,
                        color(['#fff1d1','#d49dd1','#eac359'][i%3]),curl=.25)
        ellipsoid('Flower center',(x,y,h+.01),(.045,.045,.035),'#dcaa40',petalmat)
        leaves.leaf((x,y,0),(math.cos(a),math.sin(a),.7),.3,.07,color('#729140'),curl=.1)
    leaves.finish('Flower patch leaves')
    petals.finish('Flower patch petals')


def stone():
    material=mat('Weathered warm stone')
    # Softly rounded fracture planes retain broad faces instead of looking like balloons.
    rng=random.Random(187)
    verts=[]
    for j,(radius,z)in enumerate([(.77,.025),(1,.68),(.65,1.42)]):
        for i in range(9):
            a=TAU*i/9+(j-1)*.17
            r=radius*rng.uniform(.82,1.16)
            verts.append((math.cos(a)*r+.12*j,math.sin(a)*r*.83,z+(rng.uniform(-.22,.15) if j else 0)))
    data=bpy.data.meshes.new('Irregular rock hull');data.from_pydata(verts,[],[]);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.convex_hull(bm,input=list(bm.verts));bm.to_mesh(data);bm.free()
    obj=bpy.data.objects.new('Rock · weathered fracture',data);bpy.context.collection.objects.link(obj)
    data.materials.append(material)
    attr=data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for v in data.vertices:
        t=max(0,min(1,v.co.z/1.55))
        c=blend(color('#8b8c7a'),color('#b8b39c'),t*.8)
        if v.co.z>1 and v.co.x<-.2 and v.co.y>.1:c=blend(c,color('#84924f'),.42)
        attr.data[v.index].color=(*c,1)
    for p in data.polygons:p.use_smooth=True
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bevel=obj.modifiers.new('Weathered edges','BEVEL');bevel.width=.075;bevel.segments=3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    normal=obj.modifiers.new('Broad face normals','WEIGHTED_NORMAL');normal.keep_sharp=True
    bpy.ops.object.modifier_apply(modifier=normal.name)


def cliff():
    material=mat('Layered rock face')
    xs=[-2.75,-1.8,-.6,.55,1.65,2.7]
    front=[-.48,-1.05,-.72,-1.22,-.9,-.4]
    heights=[0,.8,1,1.9,2.12,3.5]
    setbacks=[0,-.12,.1,.18,.38,.62]
    vertices=[]
    for j,(h,s)in enumerate(zip(heights,setbacks)):
        for i,(x,y)in enumerate(zip(xs,front)):
            vertices.append((x+.12*math.sin(i*2+j),y+s,h+(math.sin(i*2.3)*(.42 if j==5 else .18) if j else 0)))
    faces=[]
    for j in range(len(heights)-1):
        for i in range(len(xs)-1):
            a=j*len(xs)+i;faces.append((a,a+1,a+1+len(xs),a+len(xs)))
    vertices.extend([(-2.8,1.4,0),(2.75,1.4,0)])
    # Every uneven top-front vertex has a matching back vertex. A single cap
    # across the two endpoints leaves holes above the intermediate peaks.
    vertices.extend([(x,1.4,z+.05) for x,y,z in vertices[30:36]])
    faces.extend([(36,38,39,40,41,42,43,37),
                  (0,36,37,5,4,3,2,1),
                  (0,6,12,18,24,30,38,36),
                  (5,37,43,35,29,23,17,11)])
    for i in range(5):faces.append((30+i,31+i,39+i,38+i))
    colors=[]
    for x,y,z in vertices:
        t=max(0,min(1,z/3.7));c=blend(color('#8a8a75'),color('#bdb6a0'),t*.85)
        if z>3 and x<-.8:c=blend(c,color('#8b9b53'),.4)
        colors.append(c)
    obj=mesh('Cliff · broken ledges and exposed strata',vertices,faces,colors,material)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bevel=obj.modifiers.new('Eroded edges','BEVEL');bevel.width=.085;bevel.segments=3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    normal=obj.modifiers.new('Rock face normals','WEIGHTED_NORMAL');normal.keep_sharp=True
    bpy.ops.object.modifier_apply(modifier=normal.name)
    # This is a closed terrain blocker, so verify the actual authored topology.
    bm=bmesh.new();bm.from_mesh(obj.data)
    assert all(e.is_manifold for e in bm.edges), 'Cliff must be a closed manifold'
    bm.free()
    cracks=[]
    for i in (1,3,4):
        points=[]
        for j in range(1,6):
            x,y,z=vertices[j*6+i];points.append((x+.04,y-.015,z-(.14 if j==5 else .03)))
        tube(points,[.009,.018,.012,.02,.009],cracks)
    for obj in cracks:painted(obj,material,'#777964',0)


BUILDERS={'oak':oak,'sapling':small_tree,'fruit':lambda:small_tree('fruit'),
          'blossom':lambda:small_tree('blossom'),'pine':pine,'bush':bush,'reeds':reeds,'grass':grass,'flowers':flowers,'stone':stone,'cliff':cliff}
requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(BUILDERS)
for name in requested:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    BUILDERS[name]()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',
        use_selection=True,export_animations=False,export_vertex_color='ACTIVE',export_normals=True,
        export_materials='EXPORT',export_yup=True)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    metrics={'asset':name,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),
             'vertices':sum(len(o.data.vertices) for o in objects),'materials':len({m.name for o in objects for m in o.data.materials})}
    (OUT/f'{name}.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(metrics))
