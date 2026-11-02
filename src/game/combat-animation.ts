import actions from '../../studies/characters/combat-actions.json' with { type: 'json' };
import type { CombatRole } from './combat-config.ts';

const release = {
  infantry: actions.SwordSlash.releasePhase,
  archer: actions.BowShot.releasePhase,
  cavalry: actions.LanceThrust.releasePhase,
  wolf: .5,
};

/** Map each fighter's own windup/recovery to the shared clip's contact frame.
 * Enemy variants have different timing ratios; damage still belongs to Combat. */
export function attackAnimationPhase(role: CombatRole, elapsed: number, windup: number, recovery: number) {
  const contact = release[role], time = Math.max(0, elapsed);
  return Math.min(1, time <= windup ? contact * time / windup
    : contact + (1 - contact) * (time - windup) / recovery);
}
