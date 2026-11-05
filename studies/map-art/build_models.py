"""Author the map-redesign review assets; never writes production game assets.

Reference: the approved sphere-cluster tree sheet (2026-11-05), alongside the
map/creek studies (2026-11-04). Curves/remesh fuse wood forks only. Ordinary
crowns keep separate round lobes at 1 / 1.5 / 2 cells; pine retains its pointed tiers.
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
# Broadleaf revision: 5 / 9 / 14 main lobes plus small recessed infill lobes.
# Approved broadleaf assets are published to the map with publish_environment.py.
TREE_LOBES={
 'small': [(.015,-.01,1.23,.30),(-.265,-.20,.68,.24),(.28,-.18,.74,.25),(.23,.235,.89,.225),(-.23,.27,.88,.235)],
 'medium': [(0,.02,1.46,.36),(-.35,-.27,1.13,.30),(.36,-.27,1.19,.31),(.33,.29,1.16,.28),(-.34,.32,1.22,.29),(-.55,.015,.77,.23),(.52,.035,.83,.24),(.22,-.50,.84,.22),(-.22,.50,.90,.21)],
 'large': [(.015,.02,1.78,.44),(-.52,.29,1.64,.26),(.48,.29,1.58,.25),(-.32,-.41,1.58,.23),(.34,-.39,1.62,.24),
           (.66,-.10,1.18,.34),(.24,.64,1.25,.33),(-.52,.43,1.17,.35),(-.61,-.32,1.25,.32),(.13,-.67,1.22,.34),
           (.62,.38,.82,.24),(-.19,.70,.87,.25),(-.60,-.37,.79,.23),(.42,-.55,.84,.25)]
}
TREE_INFILL={
 'small': [(-.025,.07,.95,.17)],
 'medium': [(-.06,.05,.96,.18),(.08,.08,1.23,.17)],
 'large': [(-.12,.06,1.14,.20),(.13,.05,1.42,.18),(.04,-.24,1.18,.19),(-.08,.48,1.46,.19)],
}



def balanced_lobes(lobes):
    """Center foliage volume on the trunk without mirroring the authored lobes."""
    volume=sum(r**3 for x,y,z,r in lobes)
    cx=sum(x*r**3 for x,y,z,r in lobes)/volume
    cy=sum(y*r**3 for x,y,z,r in lobes)/volume
    return [(x-cx,y-cy,z,r) for x,y,z,r in lobes]


def round_crown(name, lobes, material, primary_count):
    """Separate smooth spherical lobes retain their own contours and normals."""
    parts=[]
    # Gentle hue/value variation inside one tree's palette. The sequence is
    # spatially interleaved, not a mechanical light-top / dark-bottom gradient.
    tints=[(1,1,.94),(.78,.94,.96),(.96,1,.89),(.89,.95,1),(.84,.98,.92)]
    for i,(x,y,z,r) in enumerate(lobes):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=18,location=(x,y,z))
        obj=bpy.context.object;obj.scale=(r,r*.98,r*1.02)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        obj.data.materials.append(material)
        attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
        tint=tints[i%len(tints)]
        for v in obj.data.vertices:
            g=.96+.04*(v.co.z/r)
            # Neutral vertex shading allows native shared-material color variants.
            attr.data[v.index].color=(*[srgb(min(1,g*c)) for c in tint],1)
        for f in obj.data.polygons:f.use_smooth=True
        parts.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
    obj=bpy.context.object;obj.name=name;obj['treePart']='crown'
    obj['lobeCount']=len(lobes)
    obj['primaryLobeCount']=primary_count
    obj['infillLobeCount']=len(lobes)-primary_count
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return obj


def rounded_tree(size='medium'):
    wood,foliage=mat('Warm branching wood'),mat('Separate round crown clusters')
    authored=TREE_LOBES[size]
    lobes=balanced_lobes(authored)
    cx,cy=authored[0][0]-lobes[0][0],authored[0][1]-lobes[0][1]
    infill=[(x-cx,y-cy,z,r) for x,y,z,r in TREE_INFILL[size]]
    parts=[];top_x,top_y,main_height,_=lobes[0]
    crown_bottom=min(z-r for x,y,z,r in lobes)
    fork_height=crown_bottom*.65
    base={'small':.082,'medium':.105,'large':.13}[size]
    tube([(0,0,.025),(-.015,0,fork_height*.5),(0,.01,fork_height),(top_x*.4,top_y*.4,main_height*.65),(top_x,top_y,main_height)],
         [base*1.2,base,base*.83,base*.60,.025],parts)
    for i,(x,y,z,r) in enumerate(lobes):
        if i==0:continue
        origin=fork_height+(z-crown_bottom)*.12
        tube([(0,.02,origin),(x*.48,y*.42,origin+(z-origin)*.4),(x*.94,y*.94,z-.07)],
             [base*.52,base*.36,.018],parts)
    trunk=fused_wood(parts,'Tree · visible rounded forks',wood,.022)
    painted(trunk,wood,'#bf8a51',.025);trunk['treePart']='wood'
    # Recessed infill shares the crown mesh and needs no extra exposed forks.
    round_crown('Tree · independent spherical crown',lobes+infill,foliage,len(lobes))
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    # L review adjustment: lift the intact crown and forks by .10 authored
    # units, extending just the lower stem instead of stretching the foliage.
    if size=='large':
        for obj in objects:
            if obj.get('treePart')=='crown':
                obj.location.z+=.10
                continue
            for vertex in obj.data.vertices:
                weight=min(1,max(0,vertex.co.z/fork_height))
                vertex.co.z+=.10*weight
            obj.data.update()
    raise_tree_trunk()
    normalize_tree(size)


def raise_tree_trunk():
    """Extend exposed wood by 50%; translate the approved crown intact."""
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.view_layer.update()
    bottom=min((o.matrix_world@v.co).z for o in objects if o.get('treePart')=='crown' for v in o.data.vertices)
    lift=bottom*.5
    for obj in objects:
        if obj.get('treePart')=='crown':
            obj.location.z+=lift
        elif obj.get('treePart')=='wood':
            inverse=obj.matrix_world.inverted()
            for vertex in obj.data.vertices:
                world=obj.matrix_world@vertex.co
                world.z+=lift*min(1,max(0,world.z/bottom))
                vertex.co=inverse@world
            obj.data.update()


def normalize_tree(size):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.view_layer.update()
    radius=max(math.hypot(*(o.matrix_world@v.co)[:2]) for o in objects for v in o.data.vertices)
    factor={'small':1,'medium':1.5,'large':2}[size]/(radius*2)
    for obj in objects:
        obj.location*=factor
        for v in obj.data.vertices:v.co*=factor
        obj['treeSize']=size


def oak():
    rounded_tree()


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
    rounded_tree('small' if kind=='sapling' else 'medium')


def pine():
    wood,foliage=mat('Conifer bark'),mat('Conifer matte needles')
    parts=[]
    tube([(0,0,0),(.04,0,1.6),(-.08,.03,3.5),(.02,0,5.9)],[.27,.21,.12,.012],parts)
    for i in range(5):
        a=TAU*i/5
        tube([(0,0,.3),(math.cos(a)*.5,math.sin(a)*.5,.03)],[.12,.02],parts)
    trunk=fused_wood(parts,'Conifer · tapered trunk',wood,.052)
    trunk['treePart']='wood'
    needles=Leaves(foliage)
    # Dense overlapping drooping branch fans form the stepped silhouette.
    for level in range(6):
        z=1.15+level*.75
        radius=1.5-level*.23
        # A shallow irregular leafy core joins the fans into a continuous mass,
        # avoiding empty rings around the trunk at the top of the silhouette.
        vertices,faces,colors=[],[],[]
        segments,rings=48,8
        for j in range(rings):
            t=j/(rings-1)
            for k in range(segments):
                a=k*TAU/segments
                r=radius*max(.018,(1-t)**.72)*(1+.10*math.sin(a*5+level*1.7))
                zz=z+.12+t*1.55-.15*math.sin(a*5+level*1.7)*(1-t)
                vertices.append((math.cos(a)*r,math.sin(a)*r,zz))
                colors.append(blend(color('#356b46'),color('#63934c'),.25+t*.6))
        for j in range(rings-1):
            for k in range(segments):
                a=j*segments+k;b=j*segments+(k+1)%segments
                faces.append((a,b,b+segments,a+segments))
        mesh('Conifer · soft connected branch mass',vertices,faces,colors,foliage)
        for ring in range(2):
            count=10 if ring==0 else 7
            for i in range(count):
                a=TAU*i/count+level*.38+ring*.2
                r=radius*(.58 if ring==0 else .25)*(1+.11*math.sin(a*5+level))
                p=Vector((math.cos(a)*r,math.sin(a)*r,z+.38+ring*.28+math.sin(a*5+level*1.7)*.16))
                for j in range(7):
                    angle=a+(j-3)*.19
                    needles.leaf(p,(math.cos(angle),math.sin(angle),-.16),radius*(.71 if ring==0 else .62)*(1+.08*math.cos(i*2+j)),radius*.18,
                        color(['#326746','#3a7850','#508a4e','#689b50'][(i+j+level)%4]),curl=.23)
    needles.spray((.01,0,5.94),.23,['#50854a','#65974e','#80ac55'],39,count=7)
    needles.finish('Conifer · six drooping branch tiers')

    # Restore the original pointed, six-tier pine from cbd710d. Joining preserves its
    # vertices, paint and silhouette while exposing two shared runtime parts.
    crown_parts=[o for o in bpy.context.scene.objects if o.type=='MESH' and o!=trunk]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in crown_parts:obj.select_set(True)
    bpy.context.view_layer.objects.active=crown_parts[0]
    bpy.ops.object.join()
    crown=bpy.context.object;crown.name='Pine · original pointed tiers'
    crown['treePart']='crown';crown['crownShape']='tiered-conifer';crown['branchTiers']=6
    raise_tree_trunk()
    normalize_tree('medium')


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


def flowers(variant=0):
    """Low wildflowers: rounded petals, connected short stems, basal leaves.
    Authored at their final ground-cover budget, never crushed into shards.
    """
    material=mat('Meadow wildflowers')
    layouts=[[(0,.03,.28),(-.23,-.15,.20),(.23,-.06,.23)],
             [(-.16,.08,.30),(.18,.15,.22),(.03,-.20,.26),(-.28,-.12,.18)],
             [(-.25,.12,.24),(.16,.14,.29),(0,-.18,.21),(.30,-.10,.18),(-.26,-.18,.16)]]
    def oval(name,at,size,shade,angle=0):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=5,location=at)
        obj=bpy.context.object;obj.name=name;obj.scale=size;obj.rotation_euler.z=angle
        bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
        painted(obj,material,shade,.012)
    for i,(x,y,h) in enumerate(layouts[variant]):
        # A slightly bent, visible stem terminates inside the flower center.
        bend=.025*math.sin(i*2.1+variant)
        points=[(x-bend,y,.025),(x-bend*.4,y+.012,h*.55),(x,y,h)]
        vertices=[];faces=[]
        for j,p in enumerate(points):
            for k in range(7):
                a=k*TAU/7;r=.018-j*.002
                vertices.append((p[0]+math.cos(a)*r,p[1]+math.sin(a)*r,p[2]))
        for j in range(2):
            for k in range(7):faces.append((j*7+k,j*7+(k+1)%7,(j+1)*7+(k+1)%7,(j+1)*7+k))
        mesh('Wildflower short stem',vertices,faces,[color('#628d3f')]*len(vertices),material)
        for side in (-1,1):
            a=i*1.7+side*.7
            oval('Wildflower basal leaf',(x+math.cos(a)*.065,y+math.sin(a)*.065,.045),(.105,.044,.026),'#719946',a)
        shade=('#fff0cb' if variant!=2 else '#e1b6d5') if i!=len(layouts[variant])-1 else '#f0cd66'
        r=.082 if i else .095
        for j in range(5):
            a=j*TAU/5+i*.7
            oval('Rounded flower petal',(x+math.cos(a)*r*.64,y+math.sin(a)*r*.64,h),
                 (r,.048,.025),shade,a)
        oval('Warm flower heart',(x,y,h+.018),(.034,.034,.025),'#dfaf48')


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
            vertices.append((x+.12*math.sin(i*2+j),y+s,h+(math.sin(i*2.3)*(.08 if j==5 else .18) if j else 0)))
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
        if z>3.3:c=blend(c,color('#8b9b53'),.3+.06*math.sin(x*.8))
        colors.append(c)
    obj=mesh('Cliff · broken ledges and exposed strata',vertices,faces,colors,material)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bevel=obj.modifiers.new('Eroded edges','BEVEL');bevel.width=.13;bevel.segments=3
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


BUILDERS={'flowers-cream':lambda:flowers(1),'flowers-lilac':lambda:flowers(2),'oak':oak,'sapling':small_tree,'fruit':lambda:small_tree('fruit'),
          'blossom':lambda:small_tree('blossom'),'pine':pine,'bush':bush,'reeds':reeds,'grass':grass,'flowers':flowers,'stone':stone,'cliff':cliff}
for size in ('small','large'):
    BUILDERS[f'oak-{size}']=lambda size=size:rounded_tree(size)
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
    crowns=[o for o in objects if o.get('treePart')=='crown']
    if crowns:
        points=[o.matrix_world@v.co for o in crowns for v in o.data.vertices]
        metrics['crown']={'diameter':round(2*max(math.hypot(p.x,p.y) for p in points),5),
                         'height':round(max(p.z for p in points),5),
                         'bare_trunk_fraction':round(min(p.z for p in points)/max(p.z for p in points),4)}
        if name=='pine':
            metrics['crown'].update(shape='tiered-conifer',branch_tiers=6)
        else:
            metrics['crown'].update(lobes=sum(o['lobeCount'] for o in crowns),
                                   primary_lobes=sum(o['primaryLobeCount'] for o in crowns),
                                   infill_lobes=sum(o['infillLobeCount'] for o in crowns))
    (OUT/f'{name}.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(metrics))
