/** Shared by melee, arrows and beasts; retain fractional health internally. */
export const DEFENSE_FACTOR = 20;
export function hitDamage(attack: number, armor = 0) {
  return Math.max(1, attack * DEFENSE_FACTOR / (DEFENSE_FACTOR + Math.max(0, armor)));
}
