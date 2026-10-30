"""Garments built around the unchanged base-human asset (Blender 4.3).

This module only edits the in-memory copy opened by build_soldier.py.
No base-human file is written, no human bones or locomotion keys are generated.
"""
import bpy
import bmesh
import math
from math import sin, cos, pi, sqrt
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

rig = None
added = []


def material(name, rgb, rough=.8, metal=0):
    def linear(c):
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    shader = m.node_tree.nodes['Principled BSDF']
    rgba = tuple(linear(c) for c in rgb) + (1,)
    shader.inputs['Base Color'].default_value = rgba
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Specular IOR Level'].default_value = .25
    m.diffuse_color = rgba
    return m


def mesh(name, vertices, faces, mat, sub=0, thick=0, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    for face in data.polygons:
        face.use_smooth = True
    if sub:
        mod = obj.modifiers.new('Rounded cloth surface', 'SUBSURF')
        mod.levels = sub
    if thick:
        mod = obj.modifiers.new('Material thickness', 'SOLIDIFY')
        mod.thickness = thick
        mod.offset = 0
    if bevel:
        mod = obj.modifiers.new('Soft structural edge', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
    added.append(obj)
    return obj


def oval(name, position, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    added.append(obj)
    return obj


def tube(name, points, radius, mat):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 12
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = point.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    curve.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    added.append(obj)
    return obj


def bind(obj, bone=None, source=None, armature=None):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if bone:
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    else:
        source.data.calc_loop_triangles()
        tris = list(source.data.loop_triangles)
        coords = [v.co.copy() for v in source.data.vertices]
        tree = BVHTree.FromPolygons(coords, [t.vertices for t in tris], all_triangles=True)
        groups = {g.name: obj.vertex_groups.new(name=g.name) for g in source.vertex_groups}
        for vertex in obj.data.vertices:
            hit, _, index, _ = tree.find_nearest(vertex.co)
            ids = tris[index].vertices
            uv = barycentric_transform(hit, *[coords[i] for i in ids],
                Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
            weights = {}
            for i, factor in zip(ids, uv):
                for group in source.data.vertices[i].groups:
                    name = source.vertex_groups[group.group].name
                    weights[name] = weights.get(name, 0) + max(0, factor) * group.weight
            total = sum(weights.values())
            for name, weight in weights.items():
                if weight > 1e-7:
                    groups[name].add([vertex.index], weight / total, 'REPLACE')
    mod = obj.modifiers.new('Shared character deformation', 'ARMATURE')
    mod.object = armature or rig
    obj.parent = armature or rig
    return obj


def rings(name, rows, mat, sub=2):
    vertices, faces, n = [], [], 64
    for z, cx, cy, rx, ry in rows:
        for i in range(n):
            a = 2 * pi * i / n
            vertices.append((cx + rx * cos(a), cy + ry * sin(a), z))
    for j in range(len(rows) - 1):
        for i in range(n):
            faces.append((j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i))
    faces.extend([tuple(reversed(range(n))), tuple((len(rows)-1)*n+i for i in range(n))])
    return mesh(name, vertices, faces, mat, sub=sub)


def surface_tree(obj):
    return BVHTree.FromPolygons([v.co.copy() for v in obj.data.vertices],
                               [p.vertices[:] for p in obj.data.polygons])


def uniform(base_rig):
    global rig
    rig = base_rig
    mats = {
        'blue': material('Soldier • blue cotton', (.29, .51, .78)),
        'seam': material('Soldier • blue seams', (.23, .40, .64)),
        'plume': material('Soldier • royal blue plume', (.24, .44, .84)),
        'pants': material('Soldier • charcoal trousers', (.22, .26, .31)),
        'leather': material('Soldier • chestnut leather', (.61, .42, .27)),
        'edge': material('Soldier • dark leather', (.43, .29, .18)),
        'boots': material('Soldier • brown boots', (.40, .26, .16)),
        'sole': material('Soldier • dark soles', (.19, .125, .08)),
        'gold': material('Soldier • warm brass', (.84, .62, .31), .50, .35),
        'steel': material('Soldier • slate steel', (.52, .60, .70), .52, .40),
        'silver': material('Soldier • steel edging', (.84, .87, .90), .48, .45),
        'hair': material('Soldier • deep brown hair', (.23, .13, .075)),
    }
    shirt = bpy.data.objects['T-shirt • connected shoulders']
    shorts = bpy.data.objects['Shorts • shaped hip and separate legs']
    for name, key in [('T-shirt • connected shoulders', 'blue'), ('Shirt hem piping', 'seam'),
                      ('Neck binding', 'seam'), ('Shorts • shaped hip and separate legs', 'pants')]:
        obj = bpy.data.objects[name]
        obj.data.materials.clear()
        obj.data.materials.append(mats[key])
    for side in ['L', 'R']:
        bpy.data.objects.remove(bpy.data.objects['Short hem.' + side], do_unlink=True)
    shirt_tree, hip_tree = surface_tree(shirt), surface_tree(shorts)

    def surface(x, z, front=True):
        tree = shirt_tree if z >= .43 else hip_tree
        sign = -1 if front else 1
        hit = tree.ray_cast(Vector((x, sign*2, z)), Vector((0, -sign, 0)))[0]
        return hit.y if hit else sign*.18

    # Curved leather vest over the existing belly, with a blue upper chest.
    vertices, faces, n, m = [], [], 32, 24
    for j in range(m+1):
        t = j/m
        z = .366 + .264*t
        width = .232 - .05*t*t
        for i in range(n+1):
            x = width*(2*i/n-1)
            vertices.append((x, surface(x, z)-.023, z))
    for j in range(m):
        for i in range(n):
            k = j*(n+1)+i
            faces.append((k, k+1, k+n+2, k+n+1))
    vest = mesh('Leather vest • rounded belly', vertices, faces, mats['leather'], sub=1, thick=.012)
    bind(vest, source=shirt)
    for side in [-1, 1]:
        vertices, faces = [], []
        for j in range(81):
            a = -.12 + (pi+.24)*j/80
            for u in [-1, 1]:
                x = side*(.153+.012*sin(a)) + u*.029
                direction = Vector((0, -cos(a), sin(a)))
                hit = shirt_tree.ray_cast(Vector((x, 0, .55)), direction)[0]
                vertices.append(hit + direction*.017)
        for j in range(80):
            k=j*2
            faces.append((k,k+1,k+3,k+2))
        bind(mesh('Leather shoulder strap.'+str(side), vertices, faces, mats['edge'], thick=.010), source=shirt)
        bind(oval('Strap rivet.'+str(side), (side*.153, surface(side*.153,.623)-.040,.623),
                  (.013,.008,.013), mats['gold']), source=shirt)
        points=[(side*.025,.786),(side*.090,.810),(side*.153,.745),(side*.070,.713)]
        bind(mesh('Blue collar.'+str(side), [(x,surface(x,z)-.016,z) for x,z in points],
                  [(0,1,2,3)],mats['seam'],sub=2,thick=.012),source=shirt)
    vertices, faces, n = [], [], 96
    for z in [.410,.415,.456,.461]:
        for i in range(n):
            a=2*pi*i/n
            vertices.append((.290*cos(a),-.006+.267*sin(a),z))
    for j in range(3):
        for i in range(n):
            faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    bind(mesh('Belt • wrapped waist',vertices,faces,mats['edge'],sub=1,thick=.010),source=shirt)
    bind(tube('Brass belt buckle',[(-.05,-.286,.416),(-.055,-.286,.425),(-.055,-.286,.450),
        (-.048,-.286,.459),(.048,-.286,.459),(.055,-.286,.450),(.055,-.286,.425),(.05,-.286,.416),(-.05,-.286,.416)],.008,mats['gold']),source=shirt)
    for side,label in [(-1,'R'),(1,'L')]:
        leg=bpy.data.objects['Continuous leg and foot.'+label]
        bind(rings('Trouser cuff.'+label,[(.14,side*.166,.004,.115,.115),(.17,side*.164,.005,.123,.122),
            (.23,side*.158,.003,.132,.144),(.27,side*.156,.001,.132,.150),(.28,side*.156,.001,.130,.151)],mats['pants']),source=leg)
        bind(rings('Boot.'+label,[(.003,side*.199,-.066,.152,.182),(.014,side*.199,-.067,.167,.205),
            (.043,side*.196,-.064,.170,.216),(.074,side*.190,-.054,.161,.207),(.110,side*.181,-.029,.145,.170),
            (.148,side*.167,.003,.125,.128),(.195,side*.164,.005,.123,.122),(.204,side*.164,.005,.121,.121)],mats['boots']),source=leg)
        bind(rings('Boot sole.'+label,[(.003,side*.199,-.066,.152,.182),(.008,side*.199,-.067,.169,.207),
            (.025,side*.198,-.067,.171,.209),(.031,side*.197,-.066,.166,.205)],mats['sole']),bone='foot.'+label)
        leg.hide_render=True
        leg.hide_set(True)
    return mats


def helmet(mats):
    head = bpy.data.objects['Head • shaped cranium cheeks and jaw']
    tree, center = surface_tree(head), Vector((0,0,1.32))

    def scalp(theta,phi,offset):
        direction=Vector((sin(phi)*sin(theta),-sin(phi)*cos(theta),cos(phi)))
        hit=tree.ray_cast(center,direction)[0]
        return hit+direction*offset if hit else center+direction*(.5+offset)

    def cap(name,limit,offset,mat):
        vertices,faces,n,m=[],[],96,36
        for j in range(m+1):
            for i in range(n):
                t=2*pi*i/n
                phi=.001+(limit(t)-.001)*j/m
                vertices.append(scalp(t,phi,offset))
        for j in range(m):
            for i in range(n):
                faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
        faces.append(tuple(reversed(range(n))))
        bind(mesh(name,vertices,faces,mat,thick=.014),bone='head')

    cap('Hair • fitted scalp',lambda t:1.28+.75*(1-cos(t))*.5,.025,mats['hair'])
    for k,(x0,x1,bottom) in enumerate([(-.38,-.13,1.32),(-.17,.13,1.29),(.12,.37,1.34)]):
        vertices,faces,n,m=[],[],20,24
        for j in range(m+1):
            t=j/m
            z=bottom+(1.54-bottom)*t
            width=(x1-x0)/2*sqrt(max(.002,1-(1-t)**2))
            cx=(x0+x1)/2+.04*(1-t)
            for i in range(n+1):
                q=2*i/n-1
                x=cx+width*q
                hit=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))[0]
                y=hit.y if hit else -.30
                vertices.append((x,y-.022-.04*(1-q*q)*sin(pi*(.15+.7*t)),z))
        for j in range(m):
            for i in range(n):
                a=j*(n+1)+i
                faces.append((a,a+1,a+n+2,a+n+1))
        bind(mesh('Hair • swept fringe '+str(k),vertices,faces,mats['hair'],sub=1,thick=.014),bone='head')
    limit=lambda t:1.30+.40*(1-cos(t))*.5
    cap('Helmet • rounded steel crown',limit,.066,mats['steel'])
    # Broad, shallow metal straps follow the crown. Fuse their intersections
    # with Blender's solid Boolean so the top and brow have no overlapping skins.
    vertices,faces,n=[],[],128
    for j in range(9):
        u=-1+j/4
        for i in range(n):
            t=2*pi*i/n
            vertices.append(scalp(t,limit(t)-.245+j*.0325,.080+.008*(1-u*u)))
    for j in range(8):
        for i in range(n):
            faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    reinforcement=mesh('Helmet • broad joined reinforcement',vertices,faces,mats['silver'],thick=.016)
    straps=[]
    for theta in [0,pi/2,-pi/2,pi]:
        vertices,faces=[],[]
        for j in range(65):
            phi=.18+(limit(theta)-.25)*j/64
            angular=.100/max(.12,sin(phi))
            for k in range(9):
                u=-1+k/4
                vertices.append(scalp(theta+u*angular,phi,.080+.008*(1-u*u)))
        for j in range(64):
            for k in range(8):
                a=j*9+k;faces.append((a,a+1,a+10,a+9))
        straps.append(mesh('Helmet reinforcing band '+str(theta),vertices,faces,mats['silver'],thick=.016))
    # Terminate the four strips before the polar singularity. A curved crown
    # plate closes their junction without self-intersecting solidified tips.
    vertices=[scalp(0,0,.088)];faces=[];n=64
    for j in range(1,17):
        for i in range(n):vertices.append(scalp(2*pi*i/n,.25*j/16,.088))
    for i in range(n):faces.append((0,1+i,1+(i+1)%n))
    for j in range(15):
        for i in range(n):
            a=1+j*n+i;b=1+j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    straps.append(mesh('Helmet crown junction',vertices,faces,mats['silver'],thick=.016))
    for part in [reinforcement,*straps]:
        bpy.context.view_layer.objects.active=part
        for mod in list(part.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    probes=[v.co.copy() for part in [reinforcement,*straps]
            for v in list(part.data.vertices)[::max(1,len(part.data.vertices)//40)]]
    bpy.context.view_layer.objects.active=reinforcement
    for strap in straps:
        union=reinforcement.modifiers.new('Joined metal intersection','BOOLEAN')
        union.operation='UNION';union.solver='EXACT';union.object=strap
        bpy.ops.object.modifier_apply(modifier=union.name)
        bpy.data.objects.remove(strap,do_unlink=True)
    for polygon in reinforcement.data.polygons:polygon.use_smooth=True
    joined=surface_tree(reinforcement)
    if any(joined.find_nearest(point)[3] > .04 for point in probes):
        raise RuntimeError('Helmet union lost a strip or part of the brow; inspect the solid intersections')
    bind(reinforcement,bone='head')
    point=scalp(0,limit(0)-.105,.103)
    bind(oval('Helmet front rivet',point,(.024,.012,.024),mats['steel']),bone='head')
    # Curled blue crest, with a continuous tapered cross-section.
    path=[((0,.04,1.802),.075),((0,.055,1.88),.085),((0,.14,1.94),.088),
          ((0,.26,1.93),.079),((0,.34,1.85),.062),((0,.43,1.79),.035),((0,.49,1.81),.006)]
    vertices,faces,n=[],[],32
    for j,(point,radius) in enumerate(path):
        p=Vector(point)
        tangent=Vector(path[min(j+1,len(path)-1)][0])-Vector(path[max(0,j-1)][0])
        tangent.normalize()
        side=Vector((1,0,0));normal=tangent.cross(side).normalized()
        for i in range(n):
            a=2*pi*i/n
            vertices.append(p+side*(cos(a)*radius*.8)+normal*(sin(a)*radius))
    for j in range(len(path)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.extend([tuple(reversed(range(n))),tuple((len(path)-1)*n+i for i in range(n))])
    bind(mesh('Helmet • curled blue plume',vertices,faces,mats['plume'],sub=2),bone='head')


def sword_and_shield(mats):
    origin=Vector((-.421,-.015,.385))
    up=Vector((-.38,0,.925)).normalized()
    across=Vector((up.z,0,-up.x))
    depth=Vector((0,1,0))
    def at(x,y,z):return origin+across*x+depth*y+up*z
    bind(tube('Sword • leather grip',[at(0,0,-.08),at(0,0,.10)],.020,mats['edge']),bone='hand.R')
    bind(oval('Sword • brass pommel',at(0,0,-.083),(.034,.028,.035),mats['gold']),bone='hand.R')
    bind(tube('Sword • rounded crossguard',[at(-.13,0,.112),at(0,0,.105),at(.13,0,.112)],.025,mats['gold']),bone='hand.R')
    vertices=[at(-.065,0,.125),at(-.075,0,.56),at(0,0,.70),at(.075,0,.56),at(.065,0,.125),
              at(0,-.024,.125),at(0,-.024,.54),at(0,.024,.125),at(0,.024,.54)]
    faces=[(0,1,6,5),(1,2,6),(2,3,6),(3,4,5,6),(4,0,5),(1,0,7,8),(2,1,8),(3,2,8),(4,3,8,7),(0,4,7)]
    bind(mesh('Sword • broad steel blade',vertices,faces,mats['silver'],bevel=.003),bone='hand.R')
    center=Vector((.475,-.16,.49))
    vertices,faces,n=[],[],96
    for radius in [0,.10,.20,.278]:
        for i in range(n):
            a=2*pi*i/n
            vertices.append(center+Vector((radius*cos(a),-.045*(1-(radius/.28)**2),radius*sin(a))))
    for j in range(3):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    bind(mesh('Shield • convex blue face',vertices,faces,mats['blue'],thick=.035),bone='hand.L')
    bind(tube('Shield • steel rim',[center+Vector((.283*cos(2*pi*i/48),0,.283*sin(2*pi*i/48))) for i in range(49)],.022,mats['silver']),bone='hand.L')
    for axis in [0,2]:
        points=[]
        for i in range(17):
            v=-.265+.53*i/16
            p=center.copy();p[axis]+=v;p.y-=.056*(1-(v/.28)**2)
            points.append(p)
        bind(tube('Shield • metal brace '+str(axis),points,.017,mats['silver']),bone='hand.L')
    bind(oval('Shield • central boss',center+Vector((0,-.065,0)),(.066,.043,.066),mats['silver']),bone='hand.L')


def held_arm_poses():
    """Adapt only carried-weapon arm channels in the loaded character copy.

    The source locomotion's root, pelvis, head and leg curves are untouched.
    Empty-handed Run flexes the elbows by 60 degrees, rolling a strapped shield
    nearly horizontal. A relaxed carry keeps its face upright and preserves
    the closed fist, without speeding up Walk or generating another gait.
    """
    scene = bpy.context.scene
    for name in ['Walk', 'Run']:
        action = bpy.data.actions[name]
        rig.animation_data.action = action
        end = int(action.frame_range[1])
        for frame in range(end + 1):
            scene.frame_set(frame)
            phase = 2*pi*frame/end
            for side, sign in [('L', 1), ('R', -1)]:
                swing = sign*sin(phase)
                for part, angle in [('upper_arm', -.08*swing), ('forearm', 0), ('hand', 0)]:
                    bone = rig.pose.bones[part+'.'+side]
                    axis = bone.bone.matrix_local.to_3x3().inverted() @ Vector((1,0,0))
                    bone.rotation_quaternion = Quaternion(axis, angle)
                    bone.keyframe_insert(data_path='rotation_quaternion', frame=frame)
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
    rig.animation_data.action = bpy.data.actions['Walk']
    scene.frame_set(0)


def export(out, role):
    scene=bpy.context.scene
    scene['model_revision']=role+'-shared-base-v12'
    scene.frame_set(0)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in scene.objects:
        if obj==rig or (obj.parent==rig and not obj.hide_render):obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.wm.save_as_mainfile(filepath=str(out/(role+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(out/(role+'.glb')),export_format='GLB',use_selection=True,
        export_apply=False,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
        export_frame_range=True,export_force_sampling=True,export_skins=True,export_extras=True,
        export_yup=True,export_anim_slide_to_zero=True)
