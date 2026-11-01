"""Append shared attack tracks without touching geometry, binds or old clips.
Authoring source: studies/characters/combat-actions.json. Two-bone IK preserves
bone lengths. Uniform 31 phase samples; runtime uses native AnimationGroups.
Requires numpy/scipy (offline tooling only). Re-running replaces the appended
section instead of retaining unused accessors. Run from the repository root.
"""
import argparse, json, math, struct
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation as R
from character_assets import ROOT
from animation_asset import AnimationAsset

parser = argparse.ArgumentParser()
parser.add_argument('--input', type=Path, default=ROOT / 'studies/characters/characters.glb')
parser.add_argument('--output', type=Path)
args = parser.parse_args()
path = args.input
edit = AnimationAsset(path)
a = edit.asset; g = edit.g; binary = edit.binary
recipe = json.loads((ROOT / 'studies/characters/combat-actions.json').read_text())
g['animations'] = [x for x in g['animations'] if x['name'] not in ('SwordSlash','BowShot','LanceThrust')]
def base_pose(name):
    clip = next(x for x in g['animations'] if x['name']==name)
    values = {}
    for ch in clip['channels']:
        sampler = clip['samplers'][ch['sampler']]; accessor = g['accessors'][sampler['output']]
        width = 4 if accessor['type']=='VEC4' else 3
        values[ch['target']['node'],ch['target']['path']] = np.array(struct.unpack('<'+'f'*width,a.accessor(sampler['output'])[:width*4]))
    return values
parents={child:i for i,n in enumerate(g['nodes']) for child in n.get('children',[])}
names={n['name']:i for i,n in enumerate(g['nodes'])}

def world(values):
    result={}
    for i,n in enumerate(g['nodes'][:21]):
        m=np.eye(4); m[:3,:3]=R.from_quat(values.get((i,'rotation'),n.get('rotation',[0,0,0,1]))).as_matrix()
        m[:3,3]=values.get((i,'translation'),n.get('translation',[0,0,0]))
        result[i]=result.get(parents.get(i),np.eye(4))@m
    return result
def unit(v): return v / np.linalg.norm(v)
def aim(old, direction):
    start=old.apply([0,1,0]); end=unit(direction); cross=np.cross(start,end)
    if np.linalg.norm(cross)<1e-8: return old
    return R.from_rotvec(unit(cross)*math.acos(np.clip(start@end,-1,1))) * old

def arm(values, side, target, wrist=0):
    upper,fore,hand=[names[n+'.'+side] for n in ('upper_arm','forearm','hand')]
    matrices=world(values); shoulder=matrices[upper][:3,3]; target=np.array(target)
    length1=np.linalg.norm(pose[fore,'translation']);length2=np.linalg.norm(pose[hand,'translation'])
    direction=unit(target-shoulder); distance=min(np.linalg.norm(target-shoulder),length1+length2-.002)
    end=shoulder+direction*distance
    # Keep the elbow outside the torso, with a small downward bias.
    pole=np.array([1 if side=='L' else -1,-.3,-.25]);pole=unit(pole-direction*np.dot(pole,direction))
    along=(length1**2-length2**2+distance**2)/(2*distance)
    elbow=shoulder+direction*along+pole*math.sqrt(max(0,length1**2-along**2))
    ru=aim(R.from_matrix(neutral[upper][:3,:3]),elbow-shoulder)
    rf=aim(R.from_matrix(neutral[fore][:3,:3]),end-elbow)
    rh=R.from_rotvec([wrist,0,0])*R.from_matrix(neutral[hand][:3,:3])
    parent=R.from_matrix(matrices[parents[upper]][:3,:3])
    values[upper,'rotation']=(parent.inv()*ru).as_quat()
    values[fore,'rotation']=(ru.inv()*rf).as_quat()
    values[hand,'rotation']=(rf.inv()*rh).as_quat()

def accessor(data,kind):
    flat=np.asarray(data,dtype='<f4'); raw=flat.tobytes();binary.extend(b'\0'*(-len(binary)%4)); offset=len(binary);binary.extend(raw)
    view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(raw)})
    idx=len(g['accessors']);item={'bufferView':view,'componentType':5126,'count':len(data),'type':kind}
    if kind=='SCALAR':item.update(min=[float(min(data))],max=[float(max(data))])
    g['accessors'].append(item);return idx

for name in ('SwordSlash','BowShot','LanceThrust'):
    spec=recipe[name];keys=spec['keys'];count=31; frames=[]
    pose=base_pose(spec.get('base','CarryWalk'));neutral=world(pose)
    for i in range(count):
        t=i/(count-1); k=next((j for j in range(len(keys)-1) if keys[j+1]['phase']>=t),len(keys)-2)
        p,q=keys[k],keys[k+1];f=(t-p['phase'])/(q['phase']-p['phase']);f=f*f*(3-2*f)
        values={key:value.copy() for key,value in pose.items()}
        # Neutral endpoints match the shared carry or mounted stance exactly.
        if i not in (0,count-1):
            for side,field in [('R','right'),('L','left')]:
                if field in p:arm(values,side,np.array(p[field])*(1-f)+np.array(q[field])*f,p.get('wrist',0)*(1-f)+q.get('wrist',0)*f if side=='R' else 0)
        frames.append(values)
    time=accessor(np.linspace(0,spec['duration'],count),'SCALAR');animation={'name':name,'samplers':[],'channels':[]}
    for (node,prop),value in pose.items():
        data=[frame[node,prop] for frame in frames]
        if prop=='rotation':
            for i in range(1,len(data)):
                if np.dot(data[i-1],data[i])<0:data[i]=-data[i]
        output=accessor(data,'VEC4' if prop=='rotation' else 'VEC3')
        animation['channels'].append({'sampler':len(animation['samplers']),'target':{'node':node,'path':prop}})
        animation['samplers'].append({'input':time,'output':output,'interpolation':'LINEAR'})
    g['animations'].append(animation)
edit.save(args.output or path)
print('Shared SwordSlash/BowShot/LanceThrust written; original mesh and animation buffers retained.')
