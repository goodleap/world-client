import { Economy } from './economy.ts';
import { FARM_PLOTS } from './economy-config.ts';
import { GRID_SIZE, HOME } from './world-data.ts';
import type { Point } from './movement.ts';
export const inStewardRange = (point: Point) => Math.hypot(point.x - HOME.x, point.z - HOME.z) <= 30 * GRID_SIZE;
/** The house, not the steward's wandering position, anchors management. */
export function createSteward(economy: Economy) {
  let nextDecision = 0;
  return {
    update() {
      if (economy.state.seconds < nextDecision) return;
      nextDecision = economy.state.seconds + .5;
      for (const definition of FARM_PLOTS) {
        if (!inStewardRange(definition) || economy.taskFor(definition.id)) continue;
        const plot = economy.plot(definition.id)!;
        if (!plot.tilled) economy.request('till', plot.id, undefined, 'steward');
        else if (!plot.crop) economy.request('sow', plot.id, 'carrot', 'steward');
        else economy.request('harvest', plot.id, undefined, 'steward');
      }
    },
  };
}
