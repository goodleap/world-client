import { Economy } from './economy.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import type { createResidents } from './residents.ts';
import type { createEconomyWorld } from './economy-world.ts';
import type { CropKind, WorkKind } from './economy.ts';
import type { Point } from './movement.ts';

export type UnitCommand = { kind: 'move'; point: Point } | { kind: 'work'; work: WorkKind; target: string; crop?: CropKind };
type Residents = Pick<ReturnType<typeof createResidents>, 'command' | 'canWork' | 'hasMoveCommand' | 'farmerWorkState' |
  'releaseFarmerWork' | 'beginFarmerWork' | 'planFarmerWork' | 'startFarmerWork'>;
type World = Pick<ReturnType<typeof createEconomyWorld>, 'sync' | 'workPoints'>;

/** Coordinates the existing navigation and native animation groups. Settlement
 * belongs exclusively to Economy, never to an animation cycle callback. */
export function createEconomyController(economy: Economy, world: World, residents: Residents) {
  function command(id: string, instruction: UnitCommand): { ok: boolean; message: string } {
    if (instruction.kind === 'move') {
      if (!residents.command(instruction.point, id)) return { ok: false, message: '无法到达该位置' };
      if (residents.canWork(id)) economy.interrupt();
      return { ok: true, message: '前往目标位置' };
    }
    if (!residents.canWork(id)) return { ok: false, message: '该单位不能执行这项作业，请选择农民' };
    let task = economy.taskFor(instruction.target);
    if (task && (task.kind !== instruction.work || task.crop !== instruction.crop)) return { ok: false, message: '该目标已有其他任务' };
    if (!task) {
      const result = economy.request(instruction.work, instruction.target, instruction.crop);
      if (!result.ok) return result;
      task = result.task!;
    }
    if (residents.farmerWorkState()?.id === task.id && economy.active()?.id === task.id) return { ok: true, message: '正在执行该作业' };
    if (task.status === 'storage') return { ok: false, message: '作业已完成，正在等待入库' };
    const destination = world.workPoints(task.target);
    const path = destination && residents.planFarmerWork(destination.points);
    if (!destination || !path) {
      economy.defer(task.id, '暂时无法到达，稍后重试');
      return { ok: false, message: '暂时无法到达，作业已保留' };
    }
    const result = economy.assign(task.id);
    if (result.ok) residents.startFarmerWork(task.id, path, destination.target);
    return result;
  }
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
    // Manual movement owns this unit until arrival, even when jobs are waiting.
    if (residents.hasMoveCommand('farmer')) return;
    if (!economy.active()) for (let attempts = 0; attempts < ECONOMY_CONFIG.queueLimit; attempts++) {
      const task = economy.claim(); if (!task) break;
      const destination = world.workPoints(task.target);
      const path = destination && residents.planFarmerWork(destination.points);
      if (destination && path) { residents.startFarmerWork(task.id, path, destination.target); break; }
      economy.defer(task.id, '暂时无法到达，稍后重试');
    }
  }
  return { update, command };
}
