/** Cumulative actual damage, capped at rank three. Fractions survive saves. */
export const EXPERIENCE_THRESHOLDS = [0, 200, 600] as const;
export const MAX_EXPERIENCE = EXPERIENCE_THRESHOLDS[2];
export function soldierLevel(experience = 0): 1 | 2 | 3 {
  return experience >= 600 ? 3 : experience >= 200 ? 2 : 1;
}
export function levelHealth(base: number, experience = 0) {
  return Math.round(base * (1 + .1 * (soldierLevel(experience) - 1)));
}
export function experienceProgress(experience: number) {
  const level = soldierLevel(experience), start = EXPERIENCE_THRESHOLDS[level - 1];
  return { level, experience, progress: experience - start,
    required: level === 3 ? 0 : EXPERIENCE_THRESHOLDS[level] - start };
}
