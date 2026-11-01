import motion from '../../studies/characters/locomotion.json' with { type: 'json' };

/** Authored gait speed changes never change navigation speed. This is the
 * existing purposeful/wander relationship, retained independently of clips. */
export function destinationSpeed(wanderSpeed: number, authoredGait = true) {
  return wanderSpeed * (authoredGait ? (5 / 3) / 1.15 : 2.1 / 1.15) * 1.5;
}

export const runReferenceSpeed = motion.human.referenceSpeed;
export const mountedRunReferenceSpeed = motion.horse.referenceSpeed;
