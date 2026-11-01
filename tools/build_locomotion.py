"""Fixed-length, offline-authored shared run and four-beat gallop.
No runtime IK/root motion. Only Run, CarryRun, RideRun and HorseRideRun change.
Authoring recipe: studies/characters/locomotion.json; Y up, +Z forward.
"""
import argparse, json, math
from pathlib import Path
import numpy as np
from scipy.interpolate import PchipInterpolator, CubicHermiteSpline
from scipy.spatial.transform import Rotation as R
from animation_asset import AnimationAsset
from character_assets import ROOT

TAU = 2 * math.pi


def rx(angle): return R.from_rotvec([angle, 0, 0])
def degrees(angle): return math.radians(angle)
def unit(v): return v / np.linalg.norm(v)


def curve(keys, t, ends=None):
    keys = np.array(keys)
    f = PchipInterpolator(keys[:, 0], keys[:, 1]); slopes = f.derivative()(keys[:, 0])
    if ends is not None: slopes[0], slopes[-1] = ends
    return float(CubicHermiteSpline(keys[:, 0], keys[:, 1], slopes)(t))


def aim(rotation, direction):
    start, end = rotation.apply([0, 1, 0]), unit(direction)
    cross = np.cross(start, end)
    if np.linalg.norm(cross) < 1e-9: return rotation
    return R.from_rotvec(unit(cross) * math.acos(np.clip(start @ end, -1, 1))) * rotation


class Locomotion:
    def __init__(self, path):
        self.asset = AnimationAsset(path)
        self.recipe = json.loads((ROOT / 'studies/characters/locomotion.json').read_text())
        self.base = {name: self.asset.pose(name) for name in ('Walk', 'CarryWalk', 'RideIdle', 'HorseRideIdle')}
        self.neutral = {name: self.asset.world(pose) for name, pose in self.base.items()}
        self.reach = []

    def leg(self, pose, names, end, foot_rotation, neutral, pole):
        a = self.asset; upper, lower, foot = [a.names[n] for n in names]
        m = a.world(pose); hip = m[upper][:3, 3]
        length1 = np.linalg.norm(pose[lower, 'translation']); length2 = np.linalg.norm(pose[foot, 'translation'])
        d = np.linalg.norm(end - hip)
        self.reach.append(float((length1 + length2) - d))
        assert abs(length1 - length2) + .0001 < d < length1 + length2 - .0001, (names, 'unreachable', end, hip, d, length1 + length2)
        direction = unit(end - hip); pole = unit(pole - direction * (pole @ direction))
        along = (length1 ** 2 - length2 ** 2 + d ** 2) / (2 * d)
        knee = hip + direction * along + pole * math.sqrt(max(0, length1 ** 2 - along ** 2))
        for name, node, delta in [(names[0], upper, knee - hip), (names[1], lower, end - knee)]:
            a.rotation(pose, name, aim(R.from_matrix(neutral[node][:3, :3]), delta))
        a.rotation(pose, names[2], foot_rotation)
        if not names[0].startswith('Horse.'):
            # Same volume helper as the fixed rig; half the knee's relative bend.
            helper = a.names['knee_volume.' + names[0][-1]]
            rest = R.from_quat(self.base['Walk'][lower, 'rotation'])
            bend = rest.inv() * R.from_quat(pose[lower, 'rotation'])
            pose[helper, 'rotation'] = (rest * R.from_rotvec(bend.as_rotvec() * .5)).as_quat()

    @staticmethod
    def foot(spec, phase, floor):
        stride = spec['duration'] * spec['referenceSpeed']; support = spec['stance']; half = stride * support / 2
        if phase <= support: return half - stride * phase, floor, 0
        keys = [[support, -half, floor, 0], *spec['swing'], [1, half, floor, 0]]
        return tuple(curve([[k[0], k[i]] for k in keys], phase, (-stride, -stride) if i == 1 else (0, 0)) for i in (1, 2, 3))

    def human(self, t, carry=False):
        a = self.asset; s = self.recipe['human']; source = 'CarryWalk' if carry else 'Walk'
        pose = {k: v.copy() for k, v in self.base[source].items()}; neutral = self.neutral['Walk']
        hip = curve(s['hipHeight'], t % .5, (0, 0))
        pose[a.names['root'], 'translation'][1] += hip - neutral[a.names['thigh.L']][1, 3]
        wave = math.sin(TAU * t)
        a.delta(pose, 'pelvis', R.from_euler('yz', [degrees(s['pelvisYawDegrees']) * wave, degrees(s['pelvisRollDegrees']) * wave]))
        a.delta(pose, 'torso', R.from_euler('xy', [degrees(s['torsoLeanDegrees'] + 2 * math.sin(2 * TAU * t)), -degrees(3) * wave]))
        a.delta(pose, 'head', rx(-degrees(7)))
        for side, offset in [('L', 0), ('R', .5)]:
            phase = (t + offset) % 1
            forward, height, pitch = self.foot(s, phase, .115)
            end = np.array([neutral[a.names['foot.' + side]][0, 3], height, forward])
            foot_rotation = rx(pitch) * R.from_matrix(neutral[a.names['foot.' + side]][:3, :3])
            self.leg(pose, ['thigh.' + side, 'shin.' + side, 'foot.' + side], end, foot_rotation, neutral, np.array([0., 0., 1.]))
            swing = degrees(s['carryArmSwingDegrees'] if carry else s['armSwingDegrees']) * math.cos(TAU * phase)
            a.delta(pose, 'upper_arm.' + side, rx(swing))
            a.delta(pose, 'forearm.' + side, rx(degrees(-5 if carry else -57) + degrees(5) * math.sin(TAU * phase)))
        return pose

    def horse(self, t):
        a = self.asset; s = self.recipe['horse']; t %= 1
        pose = {k: v.copy() for k, v in self.base['HorseRideIdle'].items()}; neutral = self.neutral['HorseRideIdle']
        bob = curve(s['rootHeight'], t, (0, 0)); pitch = degrees(curve(s['pitchDegrees'], t, (0, 0)))
        pose[a.names['Horse.root'], 'translation'][1] += bob
        a.delta(pose, 'Horse.body', rx(pitch))
        a.delta(pose, 'Horse.neck', rx(-pitch * .65 + .045 * math.sin(TAU * t)))
        a.delta(pose, 'Horse.head', rx(-.025 * math.sin(TAU * t - .4)))
        a.delta(pose, 'Horse.tail', R.from_euler('xz', [.1 * math.sin(TAU * t), .08 * math.sin(TAU * t - .5)]))
        for leg, touchdown in s['touchdown'].items():
            phase = (t - touchdown) % 1
            forward, height, hoof_pitch = self.foot(s, phase, .12)
            foot = a.names['Horse.hoof.' + leg]
            end = neutral[foot][:3, 3].copy(); end[1] = height; end[2] += forward
            foot_rotation = rx(hoof_pitch) * R.from_matrix(neutral[foot][:3, :3])
            self.leg(pose, ['Horse.upper.' + leg, 'Horse.lower.' + leg, 'Horse.hoof.' + leg], end, foot_rotation, neutral,
                     np.array([0., 0., -1. if leg.startswith('F') else 1.]))
        return pose, bob, pitch

    def rider(self, t, bob, pitch):
        a = self.asset; s = self.recipe['horse']
        pose = {k: v.copy() for k, v in self.base['RideIdle'].items()}
        root = a.names['root']; pivot = self.neutral['HorseRideIdle'][a.names['Horse.body']][:3, 3]
        # Seat attachment follows the exact horse barrel transform, not a second bob.
        pose[root, 'translation'] = pivot + rx(pitch).apply(pose[root, 'translation'] - pivot) + np.array([0., bob, 0.])
        pose[root, 'rotation'] = (rx(pitch) * R.from_quat(pose[root, 'rotation'])).as_quat()
        a.delta(pose, 'torso', rx(degrees(s['riderLeanDegrees']) - pitch * .5))
        a.delta(pose, 'head', rx(-degrees(6) - pitch * .25))
        for side in ('L', 'R'):
            a.delta(pose, 'upper_arm.' + side, rx(-.035 * math.sin(TAU * t)))
            a.delta(pose, 'forearm.' + side, rx(.045 * math.sin(TAU * t)))
        return pose

    def build(self, output):
        count = self.recipe['sampleCount']; frames = {n: [] for n in ('Run', 'CarryRun', 'RideRun', 'HorseRideRun')}
        for t in np.linspace(0, 1, count):
            frames['Run'].append(self.human(t)); frames['CarryRun'].append(self.human(t, True))
            horse, bob, pitch = self.horse(t); frames['HorseRideRun'].append(horse); frames['RideRun'].append(self.rider(t, bob, pitch))
        for name, poses in frames.items():
            for key in poses[0]: assert np.allclose(poses[0][key], poses[-1][key], atol=1e-6), (name, key, 'loop seam')
            self.asset.animation(name, poses, self.recipe['horse' if 'Ride' in name else 'human']['duration'])
        self.asset.g.setdefault('extras', {})['locomotionRevision'] = self.recipe['revision']
        self.asset.save(output)
        print(json.dumps({'output': str(output), 'samplesPerClip': count, 'minimumReachMargin': min(self.reach)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, default=ROOT / 'studies/characters/characters.glb')
    args = parser.parse_args(); Locomotion(ROOT / 'studies/characters/characters.glb').build(args.output)
