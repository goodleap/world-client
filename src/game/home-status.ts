import { homeResidents } from './recruitment.ts';
import type { EconomyState } from './economy.ts';
export const livingPopulation = (state: EconomyState) => homeResidents(state).filter(r => r.role !== 'dog'
  && (state.combat.units.find(u => u.id === r.id)?.life !== 'defeated')
  && (state.vitals[r.id]?.hp ?? 1) > 0).length;
export function formatGameTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const pair = (n: number) => String(n).padStart(2, '0');
  return (whole >= 3600 ? pair(Math.floor(whole / 3600)) + ':' : '') + pair(Math.floor(whole / 60) % 60) + ':' + pair(whole % 60);
}
