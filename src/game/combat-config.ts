/** First playable PvE tuning. Trial values, not permanent balance rules. */
export const OUTPOST = { x: -31, z: -38, radius: 5, leash: 12, discover: 16 };
export const COMBAT_CONFIG = {
  infantry: { hp: 140, attack: 22, armor: 4, interval: 1.3, windup: .38, recovery: .42, range: 1.6, speed: 4.6 },
  archer: { hp: 90, attack: 18, armor: 1, interval: 1.65, windup: .55, recovery: .4, range: 7, speed: 4.8 },
  enemyMelee: { hp: 65, attack: 12, armor: 2, interval: 1.6, windup: .48, recovery: .4, range: 1.6, speed: 3.3 },
  enemyArcher: { hp: 50, attack: 10, armor: 0, interval: 2, windup: .65, recovery: .4, range: 6, speed: 3 },
  acquire: 8, projectileSpeed: 14, recoveryFood: 6, recoverySeconds: 20,
  reward: { wood: 24, stone: 16, food: 12 },
};
export type CombatRole = 'infantry' | 'archer';
