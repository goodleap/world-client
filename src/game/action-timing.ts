import hammer from '../../studies/characters/hammer.json' with { type: 'json' };

/** Work and soldier attacks share one cycle, independent of stamina. */
export const WORK_PLAYBACK_RATE = 2;
export const SOLDIER_ATTACK_SECONDS = hammer.duration / WORK_PLAYBACK_RATE;
