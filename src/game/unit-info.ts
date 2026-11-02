import { WORK_NAMES } from './economy.ts';
import type { Economy } from './economy.ts';
import { RESIDENTS } from './resident-data.ts';
import { bodiesFor, health, maxHealth, VITAL_CONFIG } from './vitals.ts';

export interface UnitMeter { id: string; label: string; value: number; maximum: number; kind: 'health' | 'stamina' }
export interface UnitInfo { id: string; activity: string; meters: UnitMeter[] }
export interface UnitMovement { moving: boolean; speed: number; working: boolean }

/** Read authoritative gameplay state. Selecting/inspecting never creates a task,
 * consumes a meal or changes an order. Mounted bodies keep separate vitals. */
export function selectedUnitInfo(economy: Economy, id: string | undefined, movement?: UnitMovement): UnitInfo | undefined {
  if (!id || !RESIDENTS.some(r => r.id === id)) return;
  const state = economy.state, fighter = state.combat.units.find(u => u.id === id);
  if (fighter?.life === 'defeated') return;
  const vital = state.vitals[id], task = economy.active(id), bodies = bodiesFor(id);
  const moving = fighter ? fighter.speed > .08 || fighter.route.length > 0 : !!movement?.moving || (movement?.speed ?? 0) > .08;
  let activity = '空闲';
  if (state.raids.evading[id]) activity = '正在避险';
  else if (fighter?.attack || fighter?.target) activity = '正在战斗';
  else if (vital.rest && !moving && bodies.some(body => !!state.vitals[body].meal)) activity = '正在进食';
  else if (task?.status === 'delivering') activity = task.kind === 'supply' ? '运送补给' : '搬运入库';
  else if (task?.kind === 'haul' || task?.kind === 'supply') activity = moving ? '前往取货' : '等待搬运';
  else if (vital.rest) activity = moving ? '前往火堆' : '等待供餐';
  else if (task?.status === 'working') activity = `正在${WORK_NAMES[task.kind]}`;
  else if (task?.status === 'travelling') activity = '前往作业';
  else if (task?.status === 'waiting') activity = '等待作业';
  else if (moving) activity = fighter?.order === 'move' || movement?.moving ? '正在移动' : '闲逛';
  const meters = bodies.flatMap(body => {
    const prefix = id === 'cavalry' ? body === 'horse' ? '坐骑' : '骑手' : '';
    return [
      { id: body + '-health', label: prefix + '生命', value: health(state, body), maximum: maxHealth(body), kind: 'health' as const },
      { id: body + '-stamina', label: prefix + '体力', value: state.vitals[body].stamina, maximum: VITAL_CONFIG.maxStamina, kind: 'stamina' as const },
    ];
  });
  return { id, activity, meters };
}
