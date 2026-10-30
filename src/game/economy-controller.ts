import { Economy } from './economy.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import type { createResidents } from './residents.ts';
import type { createEconomyWorld } from './economy-world.ts';

/** Coordinates the existing navigation and native animation groups. Settlement
 * belongs exclusively to Economy, never to an animation cycle callback. */
export function createEconomyController(economy: Economy, world: ReturnType<typeof createEconomyWorld>, residents: ReturnType<typeof createResidents>) {
  function update(seconds: number) {
    if (seconds <= 0) return;
    economy.advance(seconds);
    const assigned = residents.farmerWorkState(), active = economy.active();
    if (assigned && assigned.id !== active?.id) residents.releaseFarmerWork();
    else if (assigned?.status === 'blocked') {
      economy.defer(assigned.id, '暂时无法到达，稍后重试'); residents.releaseFarmerWork();
    } else if (assigned?.status === 'arrived') {
      economy.arrive(assigned.id); residents.beginFarmerWork(assigned.id);
    }
    world.sync();
    if (!economy.active()) for (let attempts = 0; attempts < ECONOMY_CONFIG.queueLimit; attempts++) {
      const task = economy.claim(); if (!task) break;
      const destination = world.workPoints(task.target);
      if (destination && residents.startFarmerWork(task.id, destination.points, destination.target)) break;
      economy.defer(task.id, '暂时无法到达，稍后重试');
    }
  }
  return { update };
}
