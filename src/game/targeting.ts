import type { Point } from './movement.ts';

/** Attack capability and vulnerability are independent. All living actors are
 * damageable; faction and capability, rather than role names, drive targeting. */
export interface CombatTarget {
  id: string; team: 'home' | 'enemy'; position: Point; hp: number;
  life: 'active' | 'defeated'; radius: number; canAttack: boolean; elevation?:number; kind?:'tower';
}
export const hostile = (a: Pick<CombatTarget, 'team'>, b: Pick<CombatTarget, 'team'>) => a.team !== b.team;
export function chooseTarget(actor: Pick<CombatTarget, 'team' | 'position'>, candidates: readonly CombatTarget[],
  radius: number, eligible: (target: CombatTarget) => boolean = () => true) {
  return candidates.filter(t => hostile(actor, t) && t.life === 'active' && t.hp > 0
    && Math.hypot(t.position.x - actor.position.x, t.position.z - actor.position.z) <= radius && eligible(t))
    .sort((a, b) => Number(b.canAttack) - Number(a.canAttack)
      || Math.hypot(a.position.x - actor.position.x, a.position.z - actor.position.z) - Math.hypot(b.position.x - actor.position.x, b.position.z - actor.position.z)
      || a.id.localeCompare(b.id))[0];
}
