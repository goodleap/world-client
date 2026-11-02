"""Author the shield hold once in the shared action library, including melee.
Variant tracks reuse all original accessors except the left wrist rotation.
"""
import copy, json
import numpy as np
from scipy.spatial.transform import Rotation as R
from animation_asset import AnimationAsset
from character_assets import ROOT

path = ROOT / 'studies/characters/characters.glb'
a = AnimationAsset(path)
config = json.loads((ROOT / 'studies/characters/shield.json').read_text())
hand = a.names[config['bone']]
neutral = R.from_matrix(a.world(a.pose('CarryWalk'))[hand][:3, :3])
world_delta = R.from_euler('y', config['outwardDegrees'], degrees=True) * R.from_euler('x', config['tiltDegrees'], degrees=True)
delta = neutral.inv() * world_delta * neutral
old = a.g.get('extras', {}).get('shieldHoldDelta')
for name, source in config['variants'].items():
    clip = copy.deepcopy(next(c for c in a.g['animations'] if c['name'] == source))
    clip['name'] = name
    channel = next(c for c in clip['channels'] if c['target'] == {'node': hand, 'path': 'rotation'})
    sampler = clip['samplers'][channel['sampler']]
    q = R.from_quat(np.frombuffer(a.asset.accessor(sampler['output']), dtype='<f4').reshape(-1, 4))
    if name == source and old: q = q * R.from_quat(old).inv()
    sampler['output'] = a.accessor((q * delta).as_quat(), 'VEC4')
    a.g['animations'] = [c for c in a.g['animations'] if c['name'] != name] + [clip]
a.g.setdefault('extras', {})['shieldHoldDelta'] = delta.as_quat().tolist()
a.g['extras']['shieldRevision'] = config['revision']
a.save(path)
print('Shared shield wrist: outward 25°, tilt -8°; existing geometry and other action tracks retained.')
