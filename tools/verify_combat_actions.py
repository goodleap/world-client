"""Check exported body motion, contact feet, fixed seat and untouched asset data."""
import sys,json,argparse,numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from animation_asset import AnimationAsset
from character_assets import Asset,ROOT
from verify_locomotion import tracks,interpolator
from verify_hammer import geometry,deform
from scipy.spatial.transform import Rotation as R
parser=argparse.ArgumentParser();parser.add_argument('--baseline',type=Path,required=True);parser.add_argument('--report',type=Path)
args=parser.parse_args()
edit=AnimationAsset(ROOT/'studies/characters/characters.glb');a=edit.asset;old=Asset(args.baseline)
changed=('SwordSlash','BowShot','LanceThrust')
assert a.g['nodes']==old.g['nodes'] and a.g['materials']==old.g['materials']
for (on,op),(nn,np_) in zip(old.parts(),a.parts()):
 assert on==nn
 for key in op['attributes']:assert old.accessor(op['attributes'][key])==a.accessor(np_['attributes'][key])
 assert old.accessor(op['indices'])==a.accessor(np_['indices'])
for before,after in zip(old.g['skins'],a.g['skins']):
 assert before['joints']==after['joints'];assert old.accessor(before['inverseBindMatrices'])==a.accessor(after['inverseBindMatrices'])
for clip in old.g['animations']:
 if clip['name'] not in changed:assert tracks(old,clip['name'])==tracks(a,clip['name']),clip['name']
feet=geometry(a,lambda n:'Boot' in n or 'Continuous leg and foot' in n)
report={}
for name in changed:
 sample=interpolator(a,name);initial=edit.world(sample(0));drift=0;low=100;torso=[];seat=0;previous=None;max_step=0
 old_clip=next(c for c in old.g['animations'] if c['name']==name);new_clip=next(c for c in a.g['animations'] if c['name']==name)
 assert old.accessor(old_clip['samplers'][0]['input'])[-4:]==a.accessor(new_clip['samplers'][0]['input'])[-4:], (name,'changed duration')
 for t in np.linspace(0,1,241):
  pose=sample(float(t));world=edit.world(pose)
  if previous is not None:
   for key,value in pose.items():
    if key[1]=='rotation':max_step=max(max_step,float(np.degrees((R.from_quat(previous[key]).inv()*R.from_quat(value)).magnitude())))
  previous=pose
  for joint in a.g['skins'][0]['joints']:
   if joint!=edit.names['root']:assert np.allclose(pose[joint,'translation'],a.g['nodes'][joint]['translation'],atol=1e-6)
   assert np.allclose(pose[joint,'scale'],[1,1,1])
  i=edit.names['torso'];torso.append(R.from_matrix(world[i][:3,:3]).as_euler('xyz',degrees=True).tolist())
  if name=='LanceThrust':
   seat=max(seat,float(np.linalg.norm(world[edit.names['pelvis']][:3,3]-initial[edit.names['pelvis']][:3,3])))
  else:
   for side in ('L','R'):drift=max(drift,float(np.linalg.norm(world[edit.names['foot.'+side]][:3,3]-initial[edit.names['foot.'+side]][:3,3])))
   for part in feet:low=min(low,float(deform(part,world)[:,1].min()))
 assert drift<.001,(name,'feet',drift)
 assert name=='LanceThrust' or low>-.002,(name,'sole',low)
 assert seat<1e-6
 assert max_step<20,(name,'rotation jump',max_step)
 report[name]={'footDrift':drift,'lowestSole':None if name=='LanceThrust' else low,'seatDrift':seat,'maxRotationStepDegreesAt240Samples':max_step,'torsoMin':np.min(torso,axis=0).tolist(),'torsoMax':np.max(torso,axis=0).tolist()}
if args.report:args.report.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
