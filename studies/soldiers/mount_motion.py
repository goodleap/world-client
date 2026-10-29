"""Fixed pony dimensions and continuous in-place gait, independent of Blender.

Coordinates: Z up, -Y forward. Human source skeleton dimensions never change.
Foot targets use one analytic IK branch per leg; no bone scaling or snapping.
"""
import math

UPPER = .30
LOWER = .25
HIP_Z = .60
ANKLE_Z = .12
RIDER_OFFSET = (0, .10, .68)
LEGS = {
    'FL': (.225, -.39, -1), 'FR': (-.225, -.39, -1),
    'HL': (.225, .50, 1), 'HR': (-.225, .50, 1),
}
GAITS = {
    'RideWalk': {'duration': .60, 'speed': .90, 'stance': .65, 'lift': .10,
                 'offsets': {'FL': 0, 'FR': .5, 'HL': .25, 'HR': .75}},
    'RideRun': {'duration': .50, 'speed': 1.80, 'stance': .40, 'lift': .145,
                'offsets': {'FL': 0, 'FR': .5, 'HL': .5, 'HR': 0}},
}


def solve(forward, ankle_z, bob, branch):
    dz = ankle_z - (HIP_Z + bob)
    distance = math.hypot(forward, dz)
    if not abs(UPPER-LOWER) < distance < UPPER+LOWER:
        raise ValueError(f'Unreachable hoof: {distance}')
    along = (UPPER*UPPER - LOWER*LOWER + distance*distance)/(2*distance)
    height = math.sqrt(UPPER*UPPER - along*along)
    nx, nz = forward/distance, dz/distance
    knee_f = nx*along - branch*nz*height
    knee_z = HIP_Z + bob + nz*along + branch*nx*height
    return {'knee_f': knee_f, 'knee_z': knee_z,
            'upper_angle': -math.atan2(knee_f, HIP_Z+bob-knee_z),
            'lower_angle': -math.atan2(forward-knee_f, knee_z-ankle_z),
            'ankle_f': forward, 'ankle_z': ankle_z}


REST = {leg: solve(0, ANKLE_Z, 0, branch) for leg, (_, _, branch) in LEGS.items()}


def pose(name, t):
    if name == 'RideIdle':
        return {'bob': 0, 'legs': {leg: {**REST[leg], 'support': True} for leg in LEGS}}
    gait = GAITS[name]
    t = t % 1
    half = t % .5
    bob = 0
    if name == 'RideRun' and half > gait['stance']:
        bob = .035 * math.sin(math.pi*(half-gait['stance'])/(.5-gait['stance']))**2
    result = {'bob': bob, 'legs': {}}
    stride_rate = gait['speed']*gait['duration']
    half_support = stride_rate*gait['stance']/2
    for leg, (_, _, branch) in LEGS.items():
        phase = (t + gait['offsets'][leg]) % 1
        support = phase <= gait['stance']
        if support:
            f = half_support - stride_rate*phase
            z = ANKLE_Z
        else:
            u = (phase-gait['stance'])/(1-gait['stance'])
            # Cubic Hermite keeps the stance velocity through both seams.
            tangent = -stride_rate*(1-gait['stance'])
            f = (2*u**3-3*u*u+1)*(-half_support) + (u**3-2*u*u+u)*tangent \
                + (-2*u**3+3*u*u)*half_support + (u**3-u*u)*tangent
            z = ANKLE_Z + gait['lift']*math.sin(math.pi*u)**2
        result['legs'][leg] = {**solve(f, z, bob, branch), 'support': support}
    return result


def report():
    output = {'coordinates': {'up': 'Z', 'front': '-Y'}, 'upper_leg_length': UPPER,
              'lower_leg_length': LOWER, 'hip_z': HIP_Z, 'ankle_z': ANKLE_Z,
              'rider_root_offset': RIDER_OFFSET, 'human_bone_lengths': 'unchanged base-human',
              'hoof_proxy': {'half_width': .105, 'half_depth': .15, 'bottom_z': .008},
              'gaits': GAITS, 'checks': {}}
    for name in GAITS:
        samples = [pose(name, i/240) for i in range(241)]
        max_length_error = 0
        for s in samples:
            for leg in s['legs'].values():
                max_length_error = max(max_length_error,
                    abs(math.hypot(leg['knee_f'],leg['knee_z']-HIP_Z-s['bob'])-UPPER),
                    abs(math.hypot(leg['ankle_f']-leg['knee_f'],leg['ankle_z']-leg['knee_z'])-LOWER))
        output['checks'][name] = {'samples': 241, 'all_targets_reachable': True,
            'max_bone_length_error': max_length_error,
            'min_ankle_z': min(l['ankle_z'] for s in samples for l in s['legs'].values()),
            'max_body_bob': max(s['bob'] for s in samples),
            'loop_pose_equal': samples[0] == samples[-1]}
    return output


if __name__ == '__main__':
    import json
    print(json.dumps(report(), indent=2))
