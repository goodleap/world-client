import { RESIDENTS, ENEMIES } from './resident-data.ts';
import { COMBAT_CONFIG } from './combat-config.ts';
import type { EconomyState } from './economy.ts';
import type { Point } from './movement.ts';

export const VITAL_CONFIG = { maxStamina: 100, eatAt: 30, foodRadiusCells: 30, stopAt: 85, mealSeconds: 6, mealStamina: 45, mealHealth: 12,
  idleDrain: .04, movingDrain: .12, workDrain: .22, combatDrain: .45, manualGrace: 8, retrySeconds: 5 };
export interface Vital {
  stamina: number; hp?: number; manualUntil: number; retryAt: number; hurtUntil: number;
  rest?: { camp: string; goal: Point; supply?: number; supplyGoal?: Point };
  meal?: { remaining: number };
}
export type Vitals = Record<string, Vital>;
const fighters = new Set(['infantry', 'archer', 'cavalry', ...ENEMIES.map(r => r.id)]);
export function maxHealth(id: string) {
  if (id === 'infantry' || id === 'archer' || id === 'cavalry') return COMBAT_CONFIG[id].hp;
  if (id.startsWith('enemy-')) return ENEMIES.find(r => r.id === id)?.variant === 'heavy' ? COMBAT_CONFIG.enemyHeavy.hp : ENEMIES.find(r => r.id === id)?.role === 'archer' ? COMBAT_CONFIG.enemyArcher.hp : COMBAT_CONFIG.enemyMelee.hp;
  return id === 'horse' ? 160 : id === 'dog' ? 80 : 100;
}
export const vitalIds = [...RESIDENTS, ...ENEMIES].map(r => r.id).concat('horse');
export function initialVitals(): Vitals {
  return Object.fromEntries(vitalIds.map(id => [id, { stamina: 100, hp: fighters.has(id) ? undefined : maxHealth(id), manualUntil: 0, retryAt: 0, hurtUntil: 0 }]));
}
export const bodiesFor = (actor: string) => actor === 'cavalry' ? ['cavalry', 'horse'] : [actor];
export const health = (state: EconomyState, id: string) => state.combat.units.find(u => u.id === id)?.hp ?? state.vitals[id].hp!;
export function changeHealth(state: EconomyState, id: string, amount: number) {
  if (state.combat.units.some(u => u.id === id && u.life === 'defeated')) return;
  const value = Math.max(0, Math.min(maxHealth(id), health(state, id) + amount));
  const fighter = state.combat.units.find(u => u.id === id);
  if (fighter) fighter.hp = value;
  else state.vitals[id].hp = value;
}
export function effort(vitals: Vitals, actor: string) {
  return Math.min(...bodiesFor(actor).map(id => .5 + .5 * Math.min(1, (vitals[id]?.stamina ?? 100) / 25)));
}
export const needsFood = (state: EconomyState, id: string, threshold = VITAL_CONFIG.eatAt) =>
  !state.combat.units.some(u => u.id === id && u.life === 'defeated') && (state.vitals[id].stamina < threshold || health(state, id) < maxHealth(id));
export function eat(state: EconomyState, id: string, seconds: number) {
  if (state.combat.units.some(u => u.id === id && u.life === 'defeated')) return;
  const v = state.vitals[id], meal = v.meal; if (!meal || seconds <= 0) return;
  const dt = Math.min(seconds, meal.remaining);
  v.stamina = Math.min(100, v.stamina + dt * VITAL_CONFIG.mealStamina / VITAL_CONFIG.mealSeconds);
  changeHealth(state, id, dt * VITAL_CONFIG.mealHealth / VITAL_CONFIG.mealSeconds);
  meal.remaining = Math.max(0, meal.remaining - dt); if (meal.remaining < 1e-8) v.meal = undefined;
}
