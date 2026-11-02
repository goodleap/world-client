"""Author the three shared attacks with fixed-length offline IK and body weight.
Only attack tracks change. Babylon plays the baked clips; no runtime IK.
"""
import argparse, json
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation as R
from build_locomotion import Locomotion, aim, unit, curve
from character_assets import ROOT

CLIPS = ('SwordSlash', 'BowShot', 'LanceThrust')

class CombatActions(Locomotion):
    def __init__(self, path):
        super().__init__(path)
        self.combat = json.loads((ROOT/'studies/characters/combat-actions.json').read_text())
        self.base['ShieldWalk'] = self.asset.pose('ShieldWalk')
        self.neutral['ShieldWalk'] = self.asset.world(self.base['ShieldWalk'])
        self.max_reach_adjustment = 0.

    def arm(self, pose, base, neutral, side, target, wrist, yaw=0., roll=0.):
        a = self.asset
        upper, fore, hand = [a.names[n+'.'+side] for n in ('upper_arm','forearm','hand')]
        shoulder = a.world(pose)[upper][:3,3]
        l1 = np.linalg.norm(base[fore,'translation']); l2 = np.linalg.norm(base[hand,'translation'])
        vector = target-shoulder; raw_distance = np.linalg.norm(vector)
        distance = np.clip(raw_distance, abs(l1-l2)+.003, l1+l2-.003)
        self.max_reach_adjustment = max(self.max_reach_adjustment, abs(float(raw_distance-distance)))
        assert abs(raw_distance-distance)<.045, (side,'unreachable hand target',target,shoulder,raw_distance)
        direction = unit(vector)
        # The neutral elbow plane makes endpoints exactly match the carry stance.
        old_direction = unit(neutral[hand][:3,3]-neutral[upper][:3,3])
        bend = neutral[fore][:3,3]-neutral[upper][:3,3]
        pole = unit(bend-old_direction*(bend@old_direction))
        pole=unit(pole-direction*(pole@direction))
        along = (l1*l1-l2*l2+distance*distance)/(2*distance)
        elbow = shoulder+direction*along+pole*np.sqrt(max(0,l1*l1-along*along))
        endpoint = shoulder+direction*distance
        a.rotation(pose,'upper_arm.'+side,aim(R.from_matrix(neutral[upper][:3,:3]),elbow-shoulder))
        fore_rotation=aim(R.from_matrix(neutral[fore][:3,:3]),endpoint-elbow)
        if side=='L':
            # The drawing forearm crosses opposite its resting direction when
            # lowering. Use its elbow plane there to avoid shortest-arc twist.
            def frame(direction,normal):
                y=unit(direction);x=unit(normal-y*(normal@y))
                return np.column_stack((x,y,np.cross(x,y)))
            old_upper=neutral[fore][:3,3]-neutral[upper][:3,3]
            old_fore=neutral[hand][:3,3]-neutral[fore][:3,3]
            old_normal=unit(np.cross(old_upper,old_fore));normal=unit(np.cross(elbow-shoulder,endpoint-elbow))
            fore_rotation=R.from_matrix(frame(endpoint-elbow,normal)@frame(old_fore,old_normal).T@neutral[fore][:3,:3])
        a.rotation(pose,'forearm.'+side,fore_rotation)
        a.rotation(pose,'hand.'+side,R.from_euler('yxz',[yaw,wrist,roll])*R.from_matrix(neutral[hand][:3,:3]))

    def pose_at(self, name, t):
        a=self.asset; spec=self.combat[name]; base=self.base[spec['base']]; neutral=self.neutral[spec['base']]
        pose={k:v.copy() for k,v in base.items()}
        if t==0 or t==1:return pose
        keys=spec['keys']
        def sample(field):
            first=keys[0][field]
            if isinstance(first,list):return np.array([curve([[k['phase'],k[field][axis]] for k in keys],t,(0,0)) for axis in range(len(first))])
            return curve([[k['phase'],k[field]] for k in keys],t,(0,0))
        pose[a.names['root'],'translation'] += sample('shift')
        a.delta(pose,'pelvis',R.from_euler('xyz',sample('pelvis'),degrees=True))
        a.delta(pose,'torso',R.from_euler('xyz',sample('torso'),degrees=True))
        # Keep the gaze level while the chest turns/leans; the head still moves
        # through space with the torso, rather than being rigidly world-pinned.
        a.rotation(pose,'head',R.from_matrix(neutral[a.names['head']][:3,:3]))
        self.arm(pose,base,neutral,'R',sample('right'),sample('wrist'),np.radians(sample('torso')[1])*.35)
        if 'left' in keys[0]:self.arm(pose,base,neutral,'L',sample('left'),0.)
        # The left arm and angled shield follow the chest through their existing
        # local hold. Mounted hips/legs remain seated; foot troops plant both feet.
        if name!='LanceThrust':
            for side in ('L','R'):
                foot=neutral[a.names['foot.'+side]]
                hip=neutral[a.names['thigh.'+side]][:3,3]; knee=neutral[a.names['shin.'+side]][:3,3]
                line=unit(foot[:3,3]-hip); bend=knee-hip
                pole=unit(bend-line*(bend@line))
                self.leg(pose,['thigh.'+side,'shin.'+side,'foot.'+side],foot[:3,3],R.from_matrix(foot[:3,:3]),neutral,pole)
        return pose

    def build(self, output):
        for name in CLIPS:
            spec=self.combat[name]
            frames=[self.pose_at(name,float(t)) for t in np.linspace(0,1,self.combat['sampleCount'])]
            self.asset.animation(name,frames,spec['duration'])
        self.asset.g.setdefault('extras',{})['combatRevision']=self.combat['revision']
        self.asset.save(output)
        print(json.dumps({'clips':list(CLIPS),'samples':self.combat['sampleCount'],'maxHandReachCorrection':self.max_reach_adjustment,'minLegReachMargin':min(self.reach)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,default=ROOT/'studies/characters/characters.glb');p.add_argument('--output',type=Path)
    args=p.parse_args();CombatActions(args.input).build(args.output or args.input)
