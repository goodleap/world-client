/** First playable PvE tuning. Trial values, not permanent balance rules. */
import actions from '../../studies/characters/combat-actions.json' with { type: 'json' };
import { SOLDIER_ATTACK_SECONDS } from './action-timing.ts';
import { GRID_SIZE } from './world-data.ts';
export const OUTPOST = { x: -22 * GRID_SIZE, z: -25 * GRID_SIZE, radius: 5, leash: 12, discover: 16 };
export const ENCOUNTERS = [
  { id: 'quarry', name: '矿谷守卫', ...OUTPOST, repeat: 0, reward: { wood: 24, stone: 16, food: 12 }, patrol: [] },
  { id: 'pass', name: '山口守卫', x: 15 * GRID_SIZE, z: 37 * GRID_SIZE, radius: 5, leash: 13, discover: 18, repeat: 0, reward: { wood: 12, stone: 16, iron: 12 }, patrol: [] },
  { id: 'patrol', name: '东岸巡逻', x: 39 * GRID_SIZE, z: 20 * GRID_SIZE, radius: 3, leash: 18, discover: 18, repeat: 240, reward: { food: 8 },
    patrol: [{ x: 38.5 * GRID_SIZE, z: 13 * GRID_SIZE }, { x: 38 * GRID_SIZE, z: 23 * GRID_SIZE }] },
  { id: 'road', name: '路口守卫', x: -25, z: 9, radius: 3, leash: 16, discover: 18, repeat: 0, reward: { food: 4 }, patrol: [] },
  { id: 'grove', name: '林边守卫', x: 24, z: -2, radius: 3, leash: 16, discover: 18, repeat: 0, reward: { wood: 8 }, patrol: [] },
  { id: 'ore', name: '矿道守卫', x: -12, z: -25, radius: 3, leash: 16, discover: 18, repeat: 0, reward: { iron: 4 }, patrol: [] },
  { id: 'orchard', name: '北林营地', x: -37, z: 59, members:8, radius:6, leash:16, discover:18, repeat:0, reward:{wood:12,food:8}, patrol:[] },
  { id: 'hollow', name: '西谷营地', x: -67, z: -10, members:8, radius:6, leash:16, discover:18, repeat:0, reward:{stone:12,iron:4}, patrol:[] },
  { id: 'lowland', name: '南坡营地', x: 22, z: -56, members:10, radius:6, leash:16, discover:18, repeat:0, reward:{food:12,wood:8}, patrol:[] },
  { id: 'east', name: '东林营地', x: 66, z: -54, members:10, radius:6, leash:16, discover:18, repeat:0, reward:{iron:8,stone:8}, patrol:[] },
  { id:'ridge',name:'北岭营地',x:-50,z:28,members:10,radius:7,leash:18,discover:20,repeat:0,reward:{wood:20,stone:12},patrol:[] },
  { id:'north-east',name:'东北据点',x:56,z:52,members:12,radius:7,leash:18,discover:20,repeat:0,reward:{food:20,iron:12},patrol:[] },
  { id:'east-slope',name:'东坡营地',x:50,z:-30,members:12,radius:7,leash:18,discover:20,repeat:0,reward:{wood:20,food:16},patrol:[] },
  { id:'fort',name:'南境营寨',x:38,z:-46,members:16,radius:8,leash:20,discover:22,repeat:0,reward:{stone:24,iron:16},patrol:[] },
];
const soldierTiming = (contact: number) => ({ interval: SOLDIER_ATTACK_SECONDS,
  windup: SOLDIER_ATTACK_SECONDS * contact, recovery: SOLDIER_ATTACK_SECONDS * (1 - contact) });
const melee = soldierTiming(actions.SwordSlash.releasePhase), bow = soldierTiming(actions.BowShot.releasePhase);
// A committed melee swing can follow a nearby retreating body by half a unit.
// Starting an attack still requires the ordinary weapon reach and clear sight.
export const MELEE_CONTACT_GRACE = .5;
export const COMBAT_CONFIG = {
  wolf: { hp: 75, attack: 8, armor: 1, interval: 1.1, windup: .24, recovery: .31, range: 1.7, speed: 3.3 },
  infantry: { hp: 120, attack: 15, armor: 10, ...melee, range: 1.6, speed: 4.6 },
  archer: { hp: 110, attack: 14, armor: 8, ...bow, range: 7, speed: 4.8 },
  cavalry: { hp: 130, attack: 16, armor: 12, ...melee, range: 2.4, speed: 6.96 },
  enemyMelee: { hp: 65, attack: 12, armor: 2, ...melee, range: 1.6, speed: 3.3 },
  enemyArcher: { hp: 50, attack: 10, armor: 0, ...bow, range: 6, speed: 3 },
  enemyHeavy: { hp: 125, attack: 16, armor: 8, ...melee, range: 1.7, speed: 2.4 },
  enemyCavalry: { hp: 110, attack: 14, armor: 6, ...melee, range: 2.4, speed: 6.2 },
  acquire: 8, chase: 14, projectileSpeed: 14,
  campPursuit: { buffer: 6, quietSeconds: 3, closeRange: 3, returnAttackRange: 3 },
  reward: { wood: 24, stone: 16, food: 12 },
};
export type CombatRole = 'infantry' | 'archer' | 'cavalry' | 'wolf';
