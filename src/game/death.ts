/** Visual age is derived from the saved simulation clock, never wall time. */
export const DEATH = { fall: .6, hold: 2, sink: 3 } as const;
export const DEATH_END = DEATH.fall + DEATH.hold + DEATH.sink;
export function deathAge(diedAt: number | undefined, seconds: number) {
  // Older defeated saves are already retired; they must not replay a death.
  return diedAt === undefined ? DEATH_END : Math.max(0, seconds - diedAt);
}
export function deathPhase(age: number) {
  return age < DEATH.fall ? 'fall' : age < DEATH.fall + DEATH.hold ? 'hold' : age < DEATH_END ? 'sink' : 'gone';
}
