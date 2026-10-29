"""Bow, quiver and arrows fitted to the shared character's unchanged shape."""
import bpy
from math import sin, cos, pi
from mathutils import Vector
import dressing as d
from pony import sweep


def equipment(mats):
    wood=d.material('Archer • warm bow wood',(.57,.31,.13))
    shaft=d.material('Archer • arrow shafts',(.35,.21,.11))
    linen=d.material('Archer • linen binding',(.91,.78,.55))
    feather=d.material('Archer • ivory fletching',(.96,.88,.70))
    leather=d.material('Archer • saddle brown quiver',(.53,.31,.16))
    bow_origin=Vector((-.421,-.015,.385))
    up=Vector((-.4,0,.9165)).normalized()
    across=Vector((up.z,0,-up.x))
    def at(x,z):return bow_origin+across*x+up*z
    # A carried bow opens outward. Both nocks stay outside the hip/boot and
    # head silhouettes; the grip remains in the existing closed fist.
    rows=[(at(-.10,-.28),.008,.008),(at(-.055,-.245),.014,.014),
          (at(.020,-.12),.020,.020),(at(0,0),.023,.023),
          (at(.040,.25),.024,.024),(at(.055,.45),.018,.018),
          (at(.035,.60),.009,.009),(at(.030,.62),.007,.007)]
    d.bind(sweep('Bow • continuous curved wooden limbs',rows,wood),bone='hand.R')
    d.bind(d.tube('Bow • taut linen string',[rows[0][0],rows[-1][0]],.0035,linen),bone='hand.R')
    d.bind(d.tube('Bow • leather grip',[at(.012,-.055),at(0,0),at(.005,.055)],.026,mats['edge']),bone='hand.R')
    for z in [-.062,.062]:
        c=at(.005,z)
        d.bind(d.tube('Bow grip binding '+str(z),[c+Vector((.027*cos(2*pi*i/24),.027*sin(2*pi*i/24),0))
            for i in range(25)],.004,linen),bone='hand.R')
    base=Vector((.26,.19,.33));axis=Vector((.5,.045,.865)).normalized()
    u=Vector((axis.z,0,-axis.x)).normalized();v=axis.cross(u).normalized()
    # One hollow leather shell, including the rounded rim and inner wall.
    rows=[(0,.062),(.020,.080),(.44,.090),(.50,.099),(.55,.100),(.56,.081),(.52,.078),(.035,.060)]
    vertices,faces,n=[],[],64
    for h,r in rows:
        for i in range(n):
            a=2*pi*i/n;vertices.append(base+axis*h+(u*cos(a)+v*sin(a))*r)
    for j in range(len(rows)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.extend([tuple(reversed(range(n))),tuple((len(rows)-1)*n+i for i in range(n))])
    quiver=d.mesh('Quiver • rounded hollow leather shell',vertices,faces,leather,sub=1)
    quiver.data.materials.append(mats['edge'])
    for polygon in quiver.data.polygons:
        if polygon.index>=5*n:polygon.material_index=1
    d.bind(quiver,bone='torso')
    for h,r in [(.055,.084),(.515,.103)]:
        vertices,faces=[],[]
        for offset in [-.023,0,.023]:
            for i in range(n):
                a=2*pi*i/n;vertices.append(base+axis*(h+offset)+(u*cos(a)+v*sin(a))*r)
        for j in range(2):
            for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
        d.bind(d.mesh('Quiver • leather band '+str(h),vertices,faces,mats['edge'],sub=1,thick=.010),bone='torso')
    d.bind(d.oval('Quiver • brass fastening',base+axis*.515-v*.108,(.023,.012,.023),mats['gold']),bone='torso')

    def fletching(name,center,direction,side,other,bone,scale=1):
        for k in range(3):
            radial=side*cos(2*pi*k/3)+other*sin(2*pi*k/3)
            vertices=[center-direction*.095*scale,
                center-direction*.055*scale+radial*.043*scale,
                center+direction*.040*scale+radial*.060*scale,
                center+direction*.090*scale]
            d.bind(d.mesh(name+'.'+str(k),vertices,[(0,1,2,3)],feather,sub=1,thick=.003),bone=bone)

    for i,height in enumerate([.90,1.02,.94,1.08,.98]):
        a=2*pi*i/5
        offset=(u*cos(a)+v*sin(a))*.047
        direction=(axis+u*((i-2)*.025)+v*(.025*sin(a))).normalized()
        start=base+offset+axis*.18
        end=base+offset+direction*height
        d.bind(d.tube('Quiver arrow shaft '+str(i),[start,end],.007,shaft),bone='torso')
        fletching('Quiver ivory feathers '+str(i),end-direction*.07,direction,u,v,'torso')
    # The quiver's front strap follows the actual existing shirt curvature.
    shirt=bpy.data.objects['T-shirt • connected shoulders'];tree=d.surface_tree(shirt)
    vertices,faces=[],[]
    for j in range(49):
        t=j/48;cx=-.225+.40*t;z=.45+.30*t
        for side in [-1,1]:
            x=cx+side*.025
            hit=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))[0]
            vertices.append((x,hit.y-.048,z))
    for j in range(48):k=j*2;faces.append((k,k+1,k+3,k+2))
    d.bind(d.mesh('Quiver • fitted diagonal shoulder strap',vertices,faces,mats['edge'],thick=.010),source=shirt)
    d.bind(d.tube('Quiver • back harness',[(.16,.12,.76),(.21,.245,.65),(.29,.27,.46)],.023,mats['edge']),bone='torso')
    # A single carried arrow, held ahead of the rounded belly rather than
    # passing through it. It stays below the face in the shared Run cycle.
    grip=Vector((.418,-.018,.38));direction=Vector((-.72,-.55,.42)).normalized()
    side=direction.cross(Vector((0,0,1))).normalized();other=direction.cross(side).normalized()
    d.bind(d.tube('Held arrow • wooden shaft',[grip-direction*.15,grip+direction*.60],.008,shaft),bone='hand.L')
    fletching('Held arrow • ivory feathers',grip-direction*.12,direction,side,other,'hand.L',.65)
    tip=grip+direction*.60
    vertices=[tip+direction*.075,tip+side*.022,tip-direction*.018,tip-side*.022,
              tip+other*.010,tip-other*.010]
    d.bind(d.mesh('Held arrow • steel point',vertices,[(0,1,4),(1,2,4),(2,3,4),(3,0,4),
        (1,0,5),(2,1,5),(3,2,5),(0,3,5)],mats['silver'],bevel=.001),bone='hand.L')
