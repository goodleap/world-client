import { RESIDENTS, ENEMIES, unitRole } from './resident-data.ts';
import { levelHealth } from './unit-progression.ts';
import { COMBAT_CONFIG } from './combat-config.ts';
import type { EconomyState } from './economy.ts';
import type { Point } from './movement.ts';

export const VITAL_CONFIG = { maxStamina: 100, eatAt: 30, foodRadiusCells: 30, stopAt: 85, mealSeconds: 6, mealStamina: 45, mealHealth: 12,
  idleDrain: .04, movingDrain: .12, workDrain: .22, combatDrain: .45, manualGrace: 8, retrySeconds: 5 };
export interface Vital {
  stamina: number; hp?: number; diedAt?: number; manualUntil: number; retryAt: number; hurtUntil: number;
  lastAttack?: { source:string; at:number };
  rest?: { camp: string; goal: Point; supply?: number; supplyGoal?: Point };
  meal?: { remaining: number };
}
export type Vitals = Record<string, Vital>;
export function maxHealth(id: string, state?: EconomyState) {
  const role=unitRole(id);
  const experience = state?.combat.units.find(u => u.id === id)?.experience ?? 0;
  if (id.startsWith('enemy-')) return levelHealth(role === 'cavalry' ? COMBAT_CONFIG.enemyCavalry.hp : ENEMIES.find(r => r.id === id)?.variant === 'heavy' ? COMBAT_CONFIG.enemyHeavy.hp : role === 'archer' ? COMBAT_CONFIG.enemyArcher.hp : COMBAT_CONFIG.enemyMelee.hp, experience);
  if (role==='infantry'||role==='archer'||role==='cavalry')return levelHealth(COMBAT_CONFIG[role].hp, experience);
  return id === 'horse' || id.startsWith('horse:') ? 160 : role === 'dog' ? 80 : 100;
}
export const vitalIds = [...RESIDENTS, ...ENEMIES].map(r => r.id).concat(RESIDENTS.some(r=>r.role==='cavalry')?['horse']:[]);
export function initialVital(id:string):Vital {
  const role=unitRole(id), fighter=role==='infantry'||role==='archer'||role==='cavalry';
  return {stamina:100,hp:fighter?undefined:maxHealth(id),manualUntil:0,retryAt:0,hurtUntil:0};
}
export function initialVitals(): Vitals {
  return Object.fromEntries(vitalIds.map(id => [id, initialVital(id)]));
}
export const bodiesFor = (actor: string) => !actor.startsWith('enemy-') && unitRole(actor) === 'cavalry' ? [actor, actor==='cavalry'?'horse':`horse:${actor}`] : [actor];
export const health = (state: EconomyState, id: string) => state.combat.units.find(u => u.id === id)?.hp ?? state.vitals[id].hp!;
export const alive = (state: EconomyState, id: string) => health(state, id) > 0;
export function changeHealth(state: EconomyState, id: string, amount: number) {
  if (!alive(state, id)) return;
  const value = Math.max(0, Math.min(maxHealth(id, state), health(state, id) + amount));
  const fighter = state.combat.units.find(u => u.id === id);
  if (fighter) fighter.hp = value;
  else {
    const v = state.vitals[id]; v.hp = value;
    if (!value) { v.diedAt = state.seconds; v.rest = undefined; v.meal = undefined; }
  }
}
export const needsFood = (state: EconomyState, id: string, threshold = VITAL_CONFIG.eatAt) =>
  alive(state, id) && (state.vitals[id].stamina < threshold || health(state, id) < maxHealth(id, state));
export function eat(state: EconomyState, id: string, seconds: number) {
  if (!alive(state, id)) return;
  const v = state.vitals[id], meal = v.meal; if (!meal || seconds <= 0) return;
  const dt = Math.min(seconds, meal.remaining);
  v.stamina = Math.min(100, v.stamina + dt * VITAL_CONFIG.mealStamina / VITAL_CONFIG.mealSeconds);
  changeHealth(state, id, dt * VITAL_CONFIG.mealHealth / VITAL_CONFIG.mealSeconds);
  meal.remaining = Math.max(0, meal.remaining - dt); if (meal.remaining < 1e-8) v.meal = undefined;
}
