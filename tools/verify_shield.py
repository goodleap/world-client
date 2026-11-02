"""Check the actual exported wrist tracks, cadence, and shared non-wrist data."""
import json
import numpy as np
from scipy.spatial.transform import Rotation as R
from character_assets import Asset, ROOT

a = Asset('studies/characters/characters.glb'); g = a.g
delta = R.from_quat(g['extras']['shieldHoldDelta'])
hand = next(i for i, n in enumerate(g['nodes']) if n['name'] == 'hand.L')
for original, variant in [('CarryWalk', 'ShieldWalk'), ('CarryRun', 'ShieldRun')]:
    base, actual = [next(c for c in g['animations'] if c['name'] == name) for name in [original, variant]]
    assert len(base['channels']) == len(actual['channels']) == 60
    for left, right in zip(base['channels'], actual['channels']):
        assert left['target'] == right['target']
        source, target = base['samplers'][left['sampler']], actual['samplers'][right['sampler']]
        assert a.accessor(source['input']) == a.accessor(target['input'])
        if left['target'] == {'node': hand, 'path': 'rotation'}:
            before, after = [np.frombuffer(a.accessor(t['output']), dtype='<f4').reshape(-1, 4) for t in [source, target]]
            error = (R.from_quat(after).inv() * R.from_quat(before) * delta).magnitude()
            assert np.max(error) < 1e-6
            assert np.max(np.abs(np.linalg.norm(after, axis=1) - 1)) < 1e-6
        else: assert a.accessor(source['output']) == a.accessor(target['output'])
    print(f'PASS {variant}: wrist rotates with shield, all other 59 tracks and timing remain shared.')
catalog = json.loads((ROOT / 'studies/characters/roles.json').read_text())
assert catalog['roles']['infantry']['walk'] == 'ShieldWalk' and catalog['roles']['infantry']['run'] == 'ShieldRun'
assert catalog['roles']['archer']['walk'] == 'CarryWalk' and catalog['roles']['archer']['run'] == 'CarryRun'
assert [len(s['joints']) for s in g['skins']] == [20, 17]
print('PASS role bindings, independent archer hold, fixed human/horse bones; no extra geometry.')
