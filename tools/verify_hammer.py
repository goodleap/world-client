"""Inspect exported interpolation, planted skinned feet and the actual hammer arc.
An optional pre-change library proves that only Hammer was replaced.
"""
import argparse, json
from pathlib import Path
import numpy as np
from animation_asset import AnimationAsset
from character_assets import Asset, ROOT, SOURCES, digest
from verify_locomotion import tracks, interpolator

def sample_old(asset):
    # Historical Hammer uses STEP only for constant channels.
    clip = next(a for a in asset.g['animations'] if a['name'] == 'Hammer')
    for sampler in clip['samplers']:
        if sampler.get('interpolation', 'LINEAR') == 'STEP':
            width = 4 if asset.g['accessors'][sampler['output']]['type'] == 'VEC4' else 3
            v = np.frombuffer(asset.accessor(sampler['output']), dtype='<f4').reshape(-1,width)
            assert np.allclose(v, v[0])
        sampler['interpolation'] = 'LINEAR'
    return interpolator(asset, 'Hammer')

def geometry(asset, predicate):
    result = []
    for node, primitive in asset.parts():
        name = node.get('extras', {}).get('originalName', node['name'])
        if not predicate(name): continue
        attr = primitive['attributes']; skin = asset.g['skins'][node['skin']]
        positions = np.frombuffer(asset.accessor(attr['POSITION']),dtype='<f4').reshape(-1,3)
        joints = np.frombuffer(asset.accessor(attr['JOINTS_0']),dtype='u1').reshape(-1,4)
        weights = np.frombuffer(asset.accessor(attr['WEIGHTS_0']),dtype='<f4').reshape(-1,4)
        binds = np.frombuffer(asset.accessor(skin['inverseBindMatrices']),dtype='<f4').reshape(-1,4,4).transpose(0,2,1)
        contributions = []
        for j in np.unique(joints):
            weight = np.sum(np.where(joints == j,weights,0),axis=1); active = weight > 0
            local = np.column_stack((positions[active],np.ones(np.count_nonzero(active)))) @ binds[j].T
            contributions.append((skin['joints'][j],active,local*weight[active,None]))
        result.append((name,len(positions),contributions))
    assert result
    return result

def deform(part, world):
    _,count,contributions = part; points = np.zeros((count,4))
    for bone,active,local in contributions: points[active] += local @ world[bone].T
    return points[:,:3]

def verify(baseline=None):
    edit = AnimationAsset(ROOT/'studies/characters/characters.glb'); a = edit.asset
    if baseline:
        old = Asset(baseline)
        assert a.g['nodes'] == old.g['nodes'] and a.g['materials'] == old.g['materials']
        assert len(list(a.parts())) == len(list(old.parts()))
        for (on,op),(nn,np_) in zip(old.parts(),a.parts()):
            assert on == nn
            for key in op['attributes']: assert old.accessor(op['attributes'][key]) == a.accessor(np_['attributes'][key]), (nn['name'],key)
            assert old.accessor(op['indices']) == a.accessor(np_['indices'])
        for before,after in zip(old.g['skins'],a.g['skins']):
            assert before['joints'] == after['joints']
            assert old.accessor(before['inverseBindMatrices']) == a.accessor(after['inverseBindMatrices'])
        for clip in old.g['animations']:
            if clip['name'] != 'Hammer': assert tracks(old,clip['name']) == tracks(a,clip['name']),clip['name']
    sample = interpolator(a,'Hammer'); feet = geometry(a,lambda name:'Boot' in name or 'Continuous leg and foot' in name)
    hammer = geometry(a,lambda name:name.startswith('Hammer • rounded steel head'))[0]
    low = float('inf'); drift = 0; contact = {}; points = []; hand = []
    for phase in np.linspace(0,1,241):
        pose = sample(float(phase)); world = edit.world(pose)
        for part in feet: low = min(low,float(deform(part,world)[:,1].min()))
        for side in ('L','R'):
            position = world[edit.names['foot.'+side]][:3,3]
            if side not in contact: contact[side] = position.copy()
            drift = max(drift,float(np.linalg.norm(position-contact[side])))
        points.append(deform(hammer,world).mean(axis=0)); hand.append(world[edit.names['hand.R']][:3,3])
        for node in a.g['skins'][0]['joints']:
            if node != edit.names['root']:
                assert np.allclose(pose.get((node,'translation'),a.g['nodes'][node].get('translation',[0,0,0])), a.g['nodes'][node].get('translation',[0,0,0]),atol=1e-6)
            assert np.allclose(pose.get((node,'scale'),[1,1,1]),[1,1,1])
    old_edit = AnimationAsset(ROOT/SOURCES['farmer']); old_sample = sample_old(old_edit.asset)
    old_hammer = geometry(old_edit.asset,lambda name:name.startswith('Hammer • rounded steel head'))[0]
    old_points = np.array([deform(old_hammer,old_edit.world(old_sample(float(t)))).mean(axis=0) for t in np.linspace(0,1,241)])
    points = np.array(points); amplitude = np.ptp(points[:,1]); previous = np.ptp(old_points[:,1])
    assert 1.30 <= amplitude/previous <= 1.50, amplitude/previous
    assert low >= -.001, ('sole penetration',low)
    assert drift < .0001, ('foot drift',drift)
    assert np.linalg.norm(np.array(hand)[0]-np.array(hand)[-1]) < 1e-6
    clip = next(c for c in a.g['animations'] if c['name']=='Hammer')
    duration = np.frombuffer(a.accessor(clip['samplers'][0]['input']),dtype='<f4')[-1]
    assert duration == 1
    return {'assetSha256':digest(a.raw),'samples':241,'duration':float(duration),'oldHammerVerticalArc':float(previous),'newHammerVerticalArc':float(amplitude),
            'amplitudeIncreasePercent':float((amplitude/previous-1)*100),'plantedFootDrift':drift,'minimumSkinnedSoleY':low,
            'unchangedGeometryRigOtherClips':bool(baseline)}

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--baseline',type=Path);parser.add_argument('--report',type=Path)
    args=parser.parse_args();report=verify(args.baseline)
    if args.report: args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
