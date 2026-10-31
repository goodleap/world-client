"""Migration regression: compare every rendered attribute/material and clip.

Historical exports are immutable evidence for this migration, not alternative
motion libraries to maintain. The horse's joint index remap is checked using
actual nonzero influences and inverse bind matrices.
"""
import json
from character_assets import ROOT, SOURCES, Asset, digest


def main():
    manifest = json.loads((ROOT / 'studies/characters/migration.json').read_text())
    library = Asset('studies/characters/characters.glb')
    lod = Asset('studies/characters/characters-lod.glb')
    catalog = json.loads((ROOT / 'studies/characters/roles.json').read_text())
    for path, sha in manifest['sources'].items():
        assert digest((ROOT / path).read_bytes()) == sha, path
    checked = 0
    for target, is_lod in ((library, False), (lod, True)):
        nodes = {node['name']: (node, primitive) for node, primitive in target.parts()}
        for role, path in SOURCES.items():
            source = Asset(f'studies/lod/{role}-lod.glb' if is_lod else path)
            mappings = [entry for entry in manifest['origin'] if entry['role'] == role]
            assert catalog['roles'][role]['parts'] == [m['part'] for m in mappings]
            assert len(mappings) == len(list(source.parts()))
            for (old_node, old), mapping in zip(source.parts(), mappings):
                node, new = nodes[mapping['part']]
                assert node['extras']['originalName'] == old_node['name']
                assert source.g['materials'][old['material']] == target.g['materials'][new['material']]
                assert source.accessor(old['indices']) == target.accessor(new['indices'])
                assert old['attributes'].keys() == new['attributes'].keys()
                horse = node['skin'] == 1
                for kind, index in old['attributes'].items():
                    expected, actual = source.accessor(index), target.accessor(new['attributes'][kind])
                    if kind == 'JOINTS_0' and horse:
                        expected = bytes(max(0, joint - 20) for joint in expected)
                    assert expected == actual, f'{role}/{old_node["name"]}/{kind}'
                old_skin = source.g['skins'][old_node['skin']]
                new_skin = target.g['skins'][node['skin']]
                old_bind = source.accessor(old_skin['inverseBindMatrices'])
                new_bind = target.accessor(new_skin['inverseBindMatrices'])
                assert new_bind == old_bind[20 * 64:] if horse else new_bind == old_bind[:20 * 64]
                # Joint hierarchy/rest transforms are unchanged after separating rigs.
                for old_id, new_id in zip(old_skin['joints'][20:] if horse else old_skin['joints'][:20], new_skin['joints']):
                    def rest(asset, i):
                        n = dict(asset.g['nodes'][i])
                        if 'children' in n:
                            n['children'] = [asset.g['nodes'][j]['name'] for j in n['children']]
                        return n
                    assert rest(source, old_id) == rest(target, new_id)
                checked += 1
        assert len(target.g['skins'][0]['joints']) == 20
        assert len(target.g['skins'][1]['joints']) == 17
    assert not lod.g.get('animations')

    # Far LOD is a vertex subset of the maintained medium asset. In particular,
    # simplification must never re-export/reindex the rig or recompute weights.
    far = Asset('studies/characters/characters-far-lod.glb')
    report = json.loads((ROOT / 'studies/characters/far-lod.json').read_text())
    assert report['sourceSha256'] == digest(lod.raw)
    assert report['farSha256'] == digest(far.raw)
    assert not far.g.get('animations') and far.g['materials'] == lod.g['materials']
    assert len(far.g['skins']) == len(lod.g['skins']) == 2
    for a, b in zip(lod.g['skins'], far.g['skins']):
        assert a['joints'] == b['joints']
        assert lod.accessor(a['inverseBindMatrices']) == far.accessor(b['inverseBindMatrices'])
    assert len(lod.g['nodes']) == len(far.g['nodes'])
    for a, b in zip(lod.g['nodes'], far.g['nodes']):
        if 'mesh' not in a:
            assert a == b
    def vertex_records(asset, primitive):
        count = asset.g['accessors'][primitive['attributes']['POSITION']]['count']
        buffers = [asset.accessor(i) for i in primitive['attributes'].values()]
        return {b''.join(data[j * (len(data) // count):(j + 1) * (len(data) // count)]
            for data in buffers) for j in range(count)}
    assert len(list(lod.parts())) == len(list(far.parts()))
    for (a, original), (b, reduced) in zip(lod.parts(), far.parts()):
        assert a['name'] == b['name'] and a['skin'] == b['skin']
        assert a['extras']['partId'] == b['extras']['partId']
        assert original['material'] == reduced['material']
        assert list(original['attributes']) == list(reduced['attributes'])
        assert vertex_records(far, reduced) <= vertex_records(lod, original), a['name']
        assert 0 < far.g['accessors'][reduced['indices']]['count'] <= lod.g['accessors'][original['indices']]['count']
    print(f'PASS: {len(list(far.parts()))} far LOD parts retain original vertex attributes, materials and both rigs.')

    comparisons = [('base', name, name, False) for name in ('Walk', 'Run')]
    comparisons += [('farmer', name, name, False) for name in ('Walk', 'Run', 'Hammer')]
    comparisons += [(role, name, 'Carry' + name, False) for role in ('infantry', 'archer') for name in ('Walk', 'Run')]
    comparisons += [('cavalry', name, name, False) for name in ('Walk', 'Run', 'RideIdle', 'RideWalk', 'RideRun')]
    comparisons += [('cavalry', name, 'Horse' + name, True) for name in ('RideIdle', 'RideWalk', 'RideRun')]
    channels = 0
    for role, old_name, new_name, horse in comparisons:
        source = Asset(SOURCES[role])
        old = next(a for a in source.g['animations'] if a['name'] == old_name)
        new = next(a for a in library.g['animations'] if a['name'] == new_name)
        def tracks(asset, clip):
            return {(asset.g['nodes'][c['target']['node']]['name'], c['target']['path']): clip['samplers'][c['sampler']]
                for c in clip['channels'] if asset.g['nodes'][c['target']['node']]['name'].startswith('Horse.') == horse}
        a, b = tracks(source, old), tracks(library, new)
        assert a.keys() == b.keys()
        for key, sampler in a.items():
            assert sampler.get('interpolation', 'LINEAR') == b[key].get('interpolation', 'LINEAR')
            for kind in ('input', 'output'):
                assert source.accessor(sampler[kind]) == library.accessor(b[key][kind]), (role, old_name, key)
            channels += 1
    output_size = len(library.raw) + len(lod.raw)
    original_size = sum((ROOT / path).stat().st_size for path in manifest['sources'])
    assert output_size < original_size * .45
    print(f'PASS: {checked} primitive comparisons; {channels} animation channel comparisons; both rigs and bind poses unchanged.')
    print(f'Model bytes: {original_size:,} -> {output_size:,} ({100 * (1 - output_size / original_size):.2f}% smaller).')


if __name__ == '__main__':
    main()
