"""Bone/rigid-foot proxy only. No character mesh is created or modified."""
import math,json
from pathlib import Path
OUT=Path(__file__).parent
TAU=2*math.pi
L1=math.hypot(.002,.165);L2=math.hypot(.020,.100)
HIP_F=-.006
REST_THIGH=math.atan2(-.002,.165);REST_SHIN=math.atan2(.020,.100)
FOOT=[(-.105,-.04),(-.108,-.075),(-.095,-.103),(.100,-.107),(.210,-.102),(.248,-.084),(.245,-.035),(.160,.002),(.065,.025),(-.025,.035),(-.080,.005)]
DURATION=.45;SPEED=5/3;SUPPORT=.24
ROOT=[(0,.355),(.12,.350),(.24,.355),(.34,.395),(.40,.400),(.50,.355)]
F=[(.24,.09-SPEED*DURATION*.24),(.34,-.135),(.43,-.075),(.54,-.015),(.60,.030),(.66,.070),(.80,.120),(.90,.115),(1,.090)]
Z=[(.24,.115),(.34,.180),(.43,.160),(.54,.120),(.60,.130),(.66,.160),(.80,.180),(.90,.180),(1,.115)]
P=[(.24,0),(.34,.15),(.43,.05),(.54,0),(.60,.05),(.66,.10),(.80,-.08),(.90,-.08),(1,0)]
def curve(keys,t,ends=None):
 i=next((i for i in range(len(keys)-1) if keys[i][0]<=t<=keys[i+1][0]),len(keys)-2)
 t0,y0=keys[i];t1,y1=keys[i+1];u=(t-t0)/(t1-t0)
 def tangent(j):
  if j==0:return ends[0] if ends else (keys[1][1]-keys[0][1])/(keys[1][0]-keys[0][0])
  if j==len(keys)-1:return ends[1] if ends else (keys[-1][1]-keys[-2][1])/(keys[-1][0]-keys[-2][0])
  a=(keys[j][1]-keys[j-1][1])/(keys[j][0]-keys[j-1][0]);b=(keys[j+1][1]-keys[j][1])/(keys[j+1][0]-keys[j][0])
  return 0 if a*b<=0 else 2*a*b/(a+b)
 m0=tangent(i)*(t1-t0);m1=tangent(i+1)*(t1-t0)
 return (2*u**3-3*u*u+1)*y0+(u**3-2*u*u+u)*m0+(-2*u**3+3*u*u)*y1+(u**3-u*u)*m1

def solve(phase,hip_z):
 if phase<=SUPPORT:f=.09-SPEED*DURATION*phase;z=.115;pitch=0
 else:f=curve(F,phase,(-SPEED*DURATION,-SPEED*DURATION));z=curve(Z,phase,(0,0));pitch=curve(P,phase,(0,0))
 dx=f-HIP_F;dz=z-hip_z;d=math.hypot(dx,dz)
 if not abs(L1-L2)<d<L1+L2:return {'unreachable':d,'phase':phase,'foot':[f,z,pitch],'hip':[HIP_F,hip_z]}
 a=(L1*L1-L2*L2+d*d)/(2*d);h=math.sqrt(max(0,L1*L1-a*a))
 # One fixed knee-forward branch, analytically continuous away from full extension.
 nx,nz=dx/d,dz/d;kf=HIP_F+nx*a-nz*h;kz=hip_z+nz*a+nx*h
 thigh=REST_THIGH-math.atan2(kf-HIP_F,hip_z-kz)
 shin=REST_SHIN-math.atan2(f-kf,kz-z)
 knee=math.degrees(math.acos(max(-1,min(1,(d*d-L1*L1-L2*L2)/(2*L1*L2)))))
 footpoly=[(f+x*math.cos(pitch)+zz*math.sin(pitch),z-x*math.sin(pitch)+zz*math.cos(pitch)) for x,zz in FOOT]
 return {'phase':phase,'hip':[HIP_F,hip_z],'knee':[kf,kz],'ankle':[f,z],'thigh_world':thigh,'shin_world':shin,'foot_pitch':pitch,'knee_flexion_deg':knee,'ankle_local_deg':math.degrees(pitch-shin),'foot_polygon':footpoly,'foot_floor':min(p[1] for p in footpoly),'support':phase<=SUPPORT}

def pose(t):
 hip=curve(ROOT,t%.5,(0,0));return {'phase':t,'hip_z':hip,'L':solve(t%1,hip),'R':solve((t+.5)%1,hip)}

def review():
 samples=[pose(i/240) for i in range(241)];bad=[(p['phase'],lab,q) for p in samples for lab in ['L','R'] if 'unreachable' in (q:=p[lab])]
 valid=[p[lab] for p in samples for lab in ['L','R'] if 'unreachable' not in p[lab]]
 report={'sample_count':len(samples),'unreachable':bad,'knee_range_deg':[min(p['knee_flexion_deg'] for p in valid),max(p['knee_flexion_deg'] for p in valid)],'ankle_local_range_deg':[min(p['ankle_local_deg'] for p in valid),max(p['ankle_local_deg'] for p in valid)],'foot_floor_range':[min(p['foot_floor'] for p in valid),max(p['foot_floor'] for p in valid)]}
 if not bad:
  steps=[]
  for a,b in zip(samples,samples[1:]):
   for lab in ['L','R']:
    steps.append({'phase':b['phase'],'label':lab,'foot_delta':math.dist(a[lab]['ankle'],b[lab]['ankle']),'angle_delta_deg':max(abs(math.degrees(b[lab][k]-a[lab][k])) for k in ['thigh_world','shin_world','foot_pitch'])})
  report['max_neighbor']=max(steps,key=lambda p:p['angle_delta_deg']);report['max_neighbor_foot_delta']=max(p['foot_delta'] for p in steps)
 plan={'status':'bone-and-rigid-foot-proxy-study-only','coordinate_system':{'up':'Z','front':'-Y','forward_coordinate':'f=-Y','positive_world_X_rotation':'downward limb rotates backward; positive shin-relative X bends knee backward'},'units':'Original v9 head height H=1; head 0.92 does not rescale body/skeleton','lengths':{'thigh_sagittal':L1,'shin_sagittal':L2,'thigh_3d':math.sqrt(.020**2+L1**2),'shin_3d':math.sqrt(.017**2+L2**2)},'landmarks':{'hip':[.143,.006,.38],'knee':[.163,.008,.215],'ankle':[.180,-.012,.115]},'foot_proxy':{'outline_forward_z_relative_to_ankle':FOOT,'half_width':.150,'explanation':'Conservative rigid foot outline with a low flat sole, rounded toe box and raised instep; no deforming foot mesh.'},'joint_design':{'pelvis':'No side rotation in this proxy; applying extra pelvis transforms would change the audited foot path.','knee':{'physical_flexion_design_degrees':[15,85],'actual_rest_axis_offset_degrees':math.degrees(REST_SHIN-REST_THIGH),'helper':'knee_volume at knee pivot follows half the shin local rotation; never scales bones.'},'ankle':{'local_rotation_design_degrees':[-65,20],'reason':'Large cartoony foot is about .35H long versus .267H sagittal leg reach; low swing-through and relaxed ankle avoid forcing adult heel-to-butt poses.'},'torso':{'world_X_forward_lean_radians':[math.radians(11),math.radians(13)]},'head':{'counter_rotation_X_radians':[-math.radians(4.5),-math.radians(3.5)]},'upper_arm':{'local_X_swing_radians':[-.46,.34]},'forearm':{'local_X_flexion_radians':[-math.radians(64),-math.radians(56)]},'deformation_review':'Only the skeleton and rigid foot proxy are under review here; no mesh/garment approval is implied.'},'motion':{'duration_seconds':DURATION,'navigation_speed_reference':SPEED,'stance_fraction_per_leg':SUPPORT,'flight_fraction_total':1-2*SUPPORT,'stance_ankle_path':'f=0.09-speed*duration*phase, z=.115, pitch=0; fixed rigid planted foot, no rotation/sliding','root_hip_height_keys':ROOT,'swing_forward_keys':F,'swing_height_keys':Z,'swing_world_foot_pitch_keys_radians':P,'solver':'Continuous monotone cubic curves + one analytic knee-forward IK branch; no per-frame search or root snapping.'},'review':report}
 (OUT/'rig-motion-plan.json').write_text(json.dumps(plan,indent=2));(OUT/'rig-motion-samples.json').write_text(json.dumps(samples,indent=2));print(json.dumps({**report,'unreachable_count':len(bad),'unreachable':bad[:2]},indent=2))
 return samples,report
if __name__=='__main__':review()
