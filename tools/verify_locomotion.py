"""Check actual exported keyframe interpolation and skinned soles, not just IK
targets. --baseline additionally proves untouched geometry/rig/actions unchanged.
"""
import argparse, json
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation as R, Slerp
from animation_asset import AnimationAsset
from character_assets import Asset, ROOT

CHANGED = {'Run', 'CarryRun', 'RideRun', 'HorseRideRun'}


def tracks(asset, name):
    clip = next(a for a in asset.g['animations'] if a['name'] == name)
    return {(asset.g['nodes'][c['target']['node']]['name'], c['target']['path']):
            tuple(asset.accessor(clip['samplers'][c['sampler']][key]) for key in ('input', 'output')) for c in clip['channels']}


def interpolator(asset, name):
    clip = next(a for a in asset.g['animations'] if a['name'] == name)
    channels = []
    for c in clip['channels']:
        s = clip['samplers'][c['sampler']]; prop = c['target']['path']
        time = np.frombuffer(asset.accessor(s['input']), dtype='<f4').astype(float)
        values = np.frombuffer(asset.accessor(s['output']), dtype='<f4').reshape(-1, 4 if prop == 'rotation' else 3).astype(float)
        assert s['interpolation'] == 'LINEAR'
        assert np.allclose(values[0], values[-1], atol=1e-5), (name, prop, 'seam')
        channels.append((c['target']['node'], prop, time, values, Slerp(time, R.from_quat(values)) if prop == 'rotation' else None))
    def sample(phase):
        result = {}
        for node, prop, time, values, rotation in channels:
            t = time[0] + phase * (time[-1] - time[0])
            result[node, prop] = rotation(t).as_quat() if rotation else np.array([np.interp(t, time, values[:, j]) for j in range(3)])
        return result
    return sample


def verify(path, baseline=None):
    edit = AnimationAsset(path); a = edit.asset; g = a.g
    recipe = json.loads((ROOT / 'studies/characters/locomotion.json').read_text())
    if baseline:
        old = Asset(baseline)
        assert g['nodes'] == old.g['nodes'] and g['materials'] == old.g['materials']
        for (on, op), (nn, np_) in zip(old.parts(), a.parts()):
            assert on == nn
            for key in op['attributes']:
                assert old.accessor(op['attributes'][key]) == a.accessor(np_['attributes'][key]), (nn['name'], key)
            assert old.accessor(op['indices']) == a.accessor(np_['indices'])
        for original, current in zip(old.g['skins'], g['skins']):
            assert original['joints'] == current['joints']
            assert old.accessor(original['inverseBindMatrices']) == a.accessor(current['inverseBindMatrices'])
        for clip in old.g['animations']:
            if clip['name'] not in CHANGED: assert tracks(old, clip['name']) == tracks(a, clip['name']), clip['name']
    geometry = []
    for n, p in a.parts():
        name = n['extras']['originalName']
        if not any(word in name for word in ('Continuous leg and foot', 'Boot', 'Hoof.')): continue
        attr = p['attributes']; pos = np.frombuffer(a.accessor(attr['POSITION']), dtype='<f4').reshape(-1, 3)
        joints = np.frombuffer(a.accessor(attr['JOINTS_0']), dtype='u1').reshape(-1, 4)
        weights = np.frombuffer(a.accessor(attr['WEIGHTS_0']), dtype='<f4').reshape(-1, 4)
        skin = g['skins'][n['skin']]; bind = np.frombuffer(a.accessor(skin['inverseBindMatrices']), dtype='<f4').reshape(-1, 4, 4).transpose(0, 2, 1)
        # Precompute each weighted bind-space contribution once.
        contributions = []
        for j in np.unique(joints):
            w = np.sum(np.where(joints == j, weights, 0), axis=1); active = w > 0
            local = np.column_stack((pos[active], np.ones(np.count_nonzero(active)))) @ bind[j].T
            contributions.append((skin['joints'][j], active, local * w[active, None]))
        geometry.append((n['name'], name, n['skin'], len(pos), contributions))
    report = {}
    for clip, skin_id in [('Run', 0), ('CarryRun', 0), ('HorseRideRun', 1)]:
        pose_at = interpolator(a, clip); spec = recipe['horse' if skin_id else 'human']
        min_floor = (float('inf'), None, None); max_slide = 0; contact = {}
        for phase in np.linspace(0, 1, 241):
            pose = pose_at(float(phase)); world = edit.world(pose)
            for part, name, skin, count, contributions in geometry:
                if skin != skin_id: continue
                y = np.zeros(count)
                for bone, active, local in contributions: y[active] += local @ world[bone][1]
                low = float(y.min())
                if low < min_floor[0]: min_floor = (low, part, float(phase))
            legs = spec['touchdown'] if skin_id else {'L': 0, 'R': .5}
            for leg, offset in legs.items():
                local_phase = (phase - offset) % 1
                if local_phase < spec['stance'] - .01 and local_phase > .01:
                    foot = world[edit.names[('Horse.hoof.' if skin_id else 'foot.') + leg]][:3, 3].copy()
                    foot[2] += local_phase * spec['duration'] * spec['referenceSpeed']
                    if leg in contact: max_slide = max(max_slide, float(np.linalg.norm(foot - contact[leg])))
                    else: contact[leg] = foot
        report[clip] = {'minimumSkinnedSoleY': min_floor, 'plantedFootDrift': max_slide}
        assert min_floor[0] >= -.001, (clip, 'sole penetrates ground', min_floor)
        assert max_slide < .001, (clip, 'planted foot slides', max_slide)
    # Same shared lower body for ordinary and equipped running.
    human, carry = tracks(a, 'Run'), tracks(a, 'CarryRun')
    for key in human:
        if any(key[0].startswith(s) for s in ('root', 'pelvis', 'thigh.', 'shin.', 'foot.', 'knee_volume.')):
            assert human[key] == carry[key], key
    horse_at, rider_at = interpolator(a, 'HorseRideRun'), interpolator(a, 'RideRun')
    idle_horse, idle_rider = edit.world(edit.pose('HorseRideIdle')), edit.world(edit.pose('RideIdle'))
    barrel, rider = edit.names['Horse.body'], edit.names['root']
    seat_local = np.linalg.inv(idle_horse[barrel]) @ idle_rider[rider]
    max_seat = 0
    for phase in np.linspace(0, 1, 241):
        actual = edit.world(rider_at(float(phase)))[rider]
        expected = edit.world(horse_at(float(phase)))[barrel] @ seat_local
        max_seat = max(max_seat, float(np.max(np.abs(actual - expected))))
    assert max_seat < .001, ('rider detached from saddle', max_seat)
    report['riderAttachmentError'] = max_seat
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('path', nargs='?', type=Path, default=ROOT / 'studies/characters/characters.glb')
    parser.add_argument('--baseline', type=Path); parser.add_argument('--report', type=Path)
    args = parser.parse_args(); result = verify(args.path, args.baseline)
    if args.report: args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
