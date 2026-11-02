"""Reauthor only shared Hammer from neutral Walk and fixed-length offline IK.
The maintained recipe lives beside the shared library, not in dressed exports.
"""
import argparse, json
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation as R
from build_locomotion import Locomotion, rx, aim, unit
from character_assets import ROOT

class Hammer(Locomotion):
    def __init__(self, path):
        super().__init__(path)
        self.hammer = json.loads((ROOT / 'studies/characters/hammer.json').read_text())

    def pose_at(self, t):
        keys = self.hammer['keys']
        left, right = next(((a,b) for a,b in zip(keys,keys[1:]) if a['phase'] <= t <= b['phase']), (keys[-2],keys[-1]))
        f = (t-left['phase'])/(right['phase']-left['phase']); f = f**3*(10+f*(-15+6*f))
        q = {k:np.asarray(left[k])+(np.asarray(right[k])-left[k])*f for k in ('right','wristPitch','wristRoll','lean','drop')}
        a = self.asset; neutral = self.neutral['Walk']; base = self.base['Walk']
        pose = {k:v.copy() for k,v in base.items()}
        def rotate(name, x, z=0):
            node=a.names[name]; bind=R.from_matrix(neutral[node][:3,:3])
            pose[node,'rotation']=(R.from_quat(base[node,'rotation'])*bind.inv()*rx(x)*R.from_rotvec([0,0,z])*bind).as_quat()
        pose[a.names['root'],'translation'][1] += q['drop']
        rotate('torso',q['lean']); rotate('head',-q['lean']*.65)
        upper,fore,hand=[a.names[n+'.R'] for n in ('upper_arm','forearm','hand')]
        shoulder=a.world(pose)[upper][:3,3];target=q['right'];v=target-shoulder;distance=np.linalg.norm(v)
        l1=np.linalg.norm(base[fore,'translation']);l2=np.linalg.norm(base[hand,'translation'])
        assert abs(l1-l2)<distance<l1+l2-.001,('arm unreachable',t,distance)
        self.reach.append(l1+l2-distance);direction=unit(v);pole=np.array([-1.,-.3,-.25]);pole=unit(pole-direction*(pole@direction))
        along=(l1*l1-l2*l2+distance*distance)/(2*distance)
        elbow=shoulder+direction*along+pole*np.sqrt(max(0,l1*l1-along*along))
        a.rotation(pose,'upper_arm.R',aim(R.from_matrix(neutral[upper][:3,:3]),elbow-shoulder))
        a.rotation(pose,'forearm.R',aim(R.from_matrix(neutral[fore][:3,:3]),target-elbow))
        a.rotation(pose,'hand.R',R.from_rotvec([0,0,float(q['wristRoll'])])*rx(float(q['wristPitch']))*R.from_matrix(neutral[hand][:3,:3]))
        rotate('upper_arm.L',-.10,.04);rotate('forearm.L',-.22)
        for side in ('L','R'):
            foot=neutral[a.names['foot.'+side]]
            self.leg(pose,['thigh.'+side,'shin.'+side,'foot.'+side],foot[:3,3],R.from_matrix(foot[:3,:3]),neutral,np.array([0.,0.,1.]))
        return pose

    def build(self, output):
        frames=[self.pose_at(float(t)) for t in np.linspace(0,1,self.hammer['sampleCount'])]
        for key in frames[0]:assert np.allclose(frames[0][key],frames[-1][key],atol=1e-7),(key,'loop seam')
        self.asset.animation('Hammer',frames,self.hammer['duration'])
        self.asset.g.setdefault('extras',{})['hammerRevision']=self.hammer['revision']
        self.asset.save(output)
        print(json.dumps({'output':str(output),'minimumReachMargin':min(self.reach),'samples':len(frames)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'studies/characters/characters.glb')
    args=parser.parse_args();Hammer(ROOT/'studies/characters/characters.glb').build(args.output)
