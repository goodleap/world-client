/** First playable PvE tuning. Trial values, not permanent balance rules. */
import { GRID_SIZE } from './world-data.ts';
export const OUTPOST = { x: -22 * GRID_SIZE, z: -25 * GRID_SIZE, radius: 5, leash: 12, discover: 16 };
export const ENCOUNTERS = [
  { id: 'quarry', name: '矿谷守卫', ...OUTPOST, repeat: 0, reward: { wood: 24, stone: 16, food: 12 }, patrol: [] },
  { id: 'pass', name: '山口守卫', x: 15 * GRID_SIZE, z: 37 * GRID_SIZE, radius: 5, leash: 13, discover: 18, repeat: 0, reward: { wood: 12, stone: 16, iron: 12 }, patrol: [] },
  { id: 'patrol', name: '东岸巡逻', x: 39 * GRID_SIZE, z: 20 * GRID_SIZE, radius: 3, leash: 18, discover: 18, repeat: 240, reward: { food: 8 },
    patrol: [{ x: 38.5 * GRID_SIZE, z: 13 * GRID_SIZE }, { x: 38 * GRID_SIZE, z: 23 * GRID_SIZE }] },
];
// 3.5x trial tempo leaves headroom for the 50 ms simulation step: measured
// full-stamina cadence remains at least 3x the previous release on both sides.
const TEMPO = 3.5;
export const COMBAT_CONFIG = {
  infantry: { hp: 140, attack: 22, armor: 4, interval: 1.3 / TEMPO, windup: .38 / TEMPO, recovery: .42 / TEMPO, range: 1.6, speed: 4.6 },
  archer: { hp: 90, attack: 18, armor: 1, interval: 1.65 / TEMPO, windup: .55 / TEMPO, recovery: .4 / TEMPO, range: 7, speed: 4.8 },
  cavalry: { hp: 100, attack: 26, armor: 3, interval: 1.3 / TEMPO, windup: .38 / TEMPO, recovery: .42 / TEMPO, range: 2.4, speed: 6.96 },
  enemyMelee: { hp: 65, attack: 12, armor: 2, interval: 1.6 / TEMPO, windup: .48 / TEMPO, recovery: .4 / TEMPO, range: 1.6, speed: 3.3 },
  enemyArcher: { hp: 50, attack: 10, armor: 0, interval: 2 / TEMPO, windup: .65 / TEMPO, recovery: .4 / TEMPO, range: 6, speed: 3 },
  enemyHeavy: { hp: 125, attack: 16, armor: 8, interval: 2 / TEMPO, windup: .65 / TEMPO, recovery: .5 / TEMPO, range: 1.7, speed: 2.4 },
  acquire: 8, projectileSpeed: 14,
  reward: { wood: 24, stone: 16, food: 12 },
};
export type CombatRole = 'infantry' | 'archer' | 'cavalry';
