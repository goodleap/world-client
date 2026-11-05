"""Author the map-redesign review assets; never writes production game assets.

Reference: the approved sphere-cluster tree sheet (2026-11-05), alongside the
map/creek studies (2026-11-04). Curves/remesh fuse wood forks only. Crowns keep
separate round lobes, with small / medium / large diameters of 1 / 1.5 / 2 cells.
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


# Approved 2026-11-05 sphere-cluster reference. Coordinates are authored in
# grid units; each crown is normalized to its size's 1 / 1.5 / 2 cell diameter.
TREE_LOBES={
 'small': [(-.06,.04,1.38,.32),(-.30,-.02,1.04,.24),(.28,-.10,1.16,.29),(.23,.22,1.33,.22)],
 'medium': [(-.04,.10,1.78,.44),(-.44,-.14,1.38,.36),(.43,.09,1.43,.38),(-.48,-.16,.99,.27),(.27,-.48,1.21,.25),(.32,.46,1.60,.29),(-.25,.45,1.62,.30)],
 'large': [(-.03,.15,2.10,.56),(-.56,.07,1.72,.42),(.57,.07,1.76,.45),(-.64,-.12,1.20,.31),(.64,-.13,1.27,.30),(-.12,-.63,1.53,.34),(-.43,.58,2.00,.32),(.45,.58,2.03,.33),(.12,.53,1.38,.37)]
}
PINE_LOBES={
 'small': [(0,.03,1.66,.28),(-.24,.03,1.20,.31),(.25,.08,1.16,.33),(.05,-.28,.98,.30)],
 'medium': [(0,.06,2.13,.31),(-.26,.08,1.74,.34),(.30,.10,1.66,.35),(-.40,-.03,1.18,.40),(.41,.03,1.15,.41),(.03,-.42,1.32,.36),(-.04,.43,1.33,.36)],
 'large': [(0,.07,2.60,.37),(-.30,.10,2.15,.39),(.35,.08,2.05,.41),(-.51,.06,1.55,.47),(.53,.07,1.48,.49),(-.08,-.48,1.68,.40),(.02,.53,1.72,.41),(-.45,-.32,1.05,.38),(.43,.36,1.08,.41)],
}


def round_crown(name, lobes, material):
    """Separate smooth spherical lobes retain their own contours and normals."""
    parts=[];top=max(z+r for x,y,z,r in lobes);bottom=min(z-r for x,y,z,r in lobes)
    for i,(x,y,z,r) in enumerate(lobes):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=18,location=(x,y,z))
        obj=bpy.context.object;obj.scale=(r,r*.98,r*1.02)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        obj.data.materials.append(material)
        attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
        warmth=(z-bottom)/(top-bottom)
        tone=.86+.14*warmth
        for v in obj.data.vertices:
            g=min(1,tone*(.96+.04*(v.co.z/r)))
            # Neutral vertex shading allows native shared-material color variants.
            attr.data[v.index].color=(*[srgb(g*(.76+.24*warmth)),srgb(g),srgb(g*.94)],1)
        for f in obj.data.polygons:f.use_smooth=True
        parts.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
    obj=bpy.context.object;obj.name=name;obj['treePart']='crown'
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return obj


def rounded_tree(kind='oak', size='medium'):
    wood,foliage=mat('Warm branching wood'),mat('Separate round crown clusters')
    lobes=(PINE_LOBES if kind=='pine' else TREE_LOBES)[size]
    parts=[];main_height=lobes[0][2]-.10
    base={'small':.082,'medium':.105,'large':.13}[size]
    tube([(0,0,.025),(-.025,0,.2),(0,.01,.48),(0,.06,main_height*.65),(-.04,.1,main_height)],
         [base*1.2,base,base*.83,base*.60,.025],parts)
    for i,(x,y,z,r) in enumerate(lobes):
        if i==0:continue
        origin=max(.40,z*.48)
        tube([(0,.02,origin),(x*.48,y*.42,origin+(z-origin)*.4),(x*.94,y*.94,z-.07)],
             [base*.52,base*.36,.018],parts)
    trunk=fused_wood(parts,'Tree · visible rounded forks',wood,.025)
    painted(trunk,wood,'#bf8a51',.025);trunk['treePart']='wood'
    round_crown('Tree · independent spherical crown',lobes,foliage)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.view_layer.update()
    radius=max(math.hypot(*(o.matrix_world@v.co)[:2]) for o in objects for v in o.data.vertices)
    factor={'small':1,'medium':1.5,'large':2}[size]/(radius*2)
    for obj in objects:
        obj.location*=factor
        for v in obj.data.vertices:v.co*=factor
        obj['treeSize']=size


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
    rounded_tree(kind,'small' if kind=='sapling' else 'medium')


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
for family in ('oak','pine'):
    for size in ('small','large'):
        BUILDERS[f'{family}-{size}']=lambda family=family,size=size:rounded_tree(family,size)
requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(BUILDERS)
for name in requested:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    BUILDERS[name]()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',
        use_selection=True,export_extras=True,export_animations=False,export_vertex_color='ACTIVE',export_normals=True,
        export_materials='EXPORT',export_yup=True)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    metrics={'asset':name,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),
             'vertices':sum(len(o.data.vertices) for o in objects),'materials':len({m.name for o in objects for m in o.data.materials})}
    (OUT/f'{name}.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(metrics))
