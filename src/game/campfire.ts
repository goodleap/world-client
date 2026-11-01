/** Adjustable first-pass supply and cooking values. All timers use game time. */
export const CAMPFIRE_CONFIG = {
  cost: { wood: 0, stone: 8, food: 0 },
  capacity: { wood: 12, food: 12 }, batch: { wood: 6, food: 4 }, low: { wood: 3, food: 3 },
  fuelSeconds: 30, cookSeconds: 4, mealCapacity: 4, seats: 4, seatRadius: 4,
};
export interface Campfire {
  id: string; enabled: boolean; cooking: boolean; wood: number; food: number;
  fuel: number; cook: number; meals: number;
}
export const newCampfire = (id: string): Campfire => ({ id, enabled: false, cooking: true, wood: 0, food: 0, fuel: 0, cook: 0, meals: 0 });
export const fireIsLit = (f: Campfire) => f.enabled && (f.fuel > 0 || f.wood > 0);
export const fireAppearance = (f: Campfire) => !fireIsLit(f) ? 'off' : f.cook > 0 && f.cooking ? 'cooking' : 'lit';
export function advanceCampfire(f: Campfire, seconds: number, demand: number) {
  if (seconds <= 0 || !Number.isFinite(seconds) || !f.enabled) return;
  let left = seconds;
  while (left > 1e-8) {
    if (f.fuel <= 1e-8) {
      if (!f.wood) break;
      f.wood--; f.fuel = CAMPFIRE_CONFIG.fuelSeconds;
    }
    if (f.cooking && !f.cook && f.food > 0 && f.meals < Math.min(demand, CAMPFIRE_CONFIG.mealCapacity)) {
      f.food--; f.cook = CAMPFIRE_CONFIG.cookSeconds;
    }
    const dt = Math.min(left, f.fuel, f.cooking && f.cook > 0 ? f.cook : Infinity);
    f.fuel = Math.max(0, f.fuel - dt); left -= dt;
    if (f.cooking && f.cook > 0) { f.cook = Math.max(0, f.cook - dt); if (f.cook < 1e-8) { f.cook = 0; f.meals++; } }
  }
}
