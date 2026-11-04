import catalog from '../../studies/characters/roles.json' with { type: 'json' };

export type CharacterRole = keyof typeof catalog.roles;

/** Instance playback state only. The shared library still owns every authored
 * action and its immutable keys; each role clones only the groups it uses. */
export function characterActions(role: CharacterRole) {
  const config = catalog.roles[role];
  const actions = new Set([config.walk, config.run]);
  if (role === 'farmer') actions.add('Hammer');
  if (role === 'infantry') actions.add('SwordSlash');
  if (role === 'archer') actions.add('BowShot');
  if (config.mounted) {
    for (const name of ['RideIdle', 'HorseRideIdle', 'HorseRideWalk', 'HorseRideRun', 'LanceThrust', 'Walk']) actions.add(name);
  }
  return actions;
}
