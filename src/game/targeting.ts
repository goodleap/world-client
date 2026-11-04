import type { Point } from './movement.ts';

/** Attack capability and vulnerability are independent. All living actors are
 * damageable; faction and capability, rather than role names, drive targeting. */
export interface CombatTarget {
  id: string; team: 'home' | 'enemy'; position: Point; hp: number;
  life: 'active' | 'defeated'; radius: number; contactRadius?: number; canAttack: boolean; elevation?:number; kind?:'building';
}
export const hostile = (a: Pick<CombatTarget, 'team'>, b: Pick<CombatTarget, 'team'>) => a.team !== b.team;
export function chooseTarget(actor: Pick<CombatTarget, 'team' | 'position'>, candidates: readonly CombatTarget[],
  radius: number, eligible: (target: CombatTarget) => boolean = () => true) {
  if(!(radius>=0))return;
  let best: CombatTarget | undefined, bestDistance = Infinity;
  for (const t of candidates) {
    if (!hostile(actor,t) || t.life !== 'active' || t.hp <= 0) continue;
    const d = (t.position.x-actor.position.x)**2 + (t.position.z-actor.position.z)**2;
    if (d > radius*radius) continue;
    // Check expensive LOS/attack eligibility only if this candidate could win.
    if (best && (Number(t.canAttack) < Number(best.canAttack) || t.canAttack === best.canAttack
      && (d > bestDistance || d === bestDistance && t.id.localeCompare(best.id) >= 0))) continue;
    if (eligible(t)) { best=t; bestDistance=d; }
  }
  return best;
}
