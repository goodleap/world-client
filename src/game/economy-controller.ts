import { Economy } from './economy.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import type { createResidents } from './residents.ts';
import type { createEconomyWorld } from './economy-world.ts';
import type { CropKind, WorkKind } from './economy.ts';
import type { Point } from './movement.ts';
import { createSteward, inStewardRange, stewardStatus } from './steward.ts';

export type UnitCommand = { kind: 'move'; point: Point } | { kind: 'work'; work: WorkKind; target: string; crop?: CropKind };
type Residents = Pick<ReturnType<typeof createResidents>, 'command' | 'canWork' | 'hasMoveCommand' | 'farmerWorkState' |
  'releaseFarmerWork' | 'beginFarmerWork' | 'planFarmerWork' | 'startFarmerWork' | 'farmerIds'> & { farmerPosition: (id?: string) => Point };
type World = Pick<ReturnType<typeof createEconomyWorld>, 'sync' | 'workPoints'>;

export function createEconomyController(economy: Economy, world: World, residents: Residents, automatic = true) {
  const steward = createSteward(economy);
  function command(id: string, instruction: UnitCommand): { ok: boolean; message: string } {
    if (instruction.kind === 'move') {
      if (!residents.command(instruction.point, id)) return { ok: false, message: '无法到达该位置' };
      if (residents.canWork(id)) economy.interrupt(residents.farmerPosition(id), id);
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
    if (residents.farmerWorkState(id)?.id === task.id && economy.active(id)?.id === task.id) return { ok: true, message: '正在执行该作业' };
    if (task.status === 'storage') return { ok: false, message: '作业已完成，正在等待入库' };
    if (task.worker && task.worker !== id && task.status !== 'waiting') return { ok: false, message: '其他农民正在执行该任务' };
    const destination = world.workPoints(task.target);
    const path = destination && residents.planFarmerWork(destination.points, id);
    if (!destination || !path) {
      if (!task.worker) economy.defer(task.id, '暂时无法到达，稍后重试');
      return { ok: false, message: '暂时无法到达，作业已保留' };
    }
    economy.updateCargo(residents.farmerPosition(id), id);
    const result = economy.assign(task.id, id);
    if (result.ok) residents.startFarmerWork(task.id, path, destination.target, id);
    return result;
  }
  function update(seconds: number) {
    if (seconds <= 0) return;
    for (const id of residents.farmerIds()) economy.updateCargo(residents.farmerPosition(id), id);
    economy.advance(seconds);
    if (automatic) steward.update();
    for (const goods of economy.state.goods) if (inStewardRange(goods) && !economy.taskFor(goods.id)) economy.request('haul', goods.id, undefined, 'steward');
    for (const id of residents.farmerIds()) {
      const assigned = residents.farmerWorkState(id), active = economy.active(id);
      if (!assigned && active?.status === 'delivering') {
        const destination = world.workPoints('warehouse')!;
        const path = residents.planFarmerWork(destination.points, id);
        if (path) residents.startFarmerWork(active.id, path, destination.target, id);
        else economy.defer(active.id, '仓库暂时无法到达', residents.farmerPosition(id));
      }
      if (assigned && assigned.id !== active?.id) residents.releaseFarmerWork(id);
      else if (assigned?.status === 'blocked') {
        economy.defer(assigned.id, '暂时无法到达，稍后重试', residents.farmerPosition(id)); residents.releaseFarmerWork(id);
      } else if (assigned?.status === 'arrived') {
        economy.arrive(assigned.id);
        if (economy.active(id)?.status === 'delivering') {
          const destination = world.workPoints('warehouse')!;
          const path = residents.planFarmerWork(destination.points, id);
          if (path) residents.startFarmerWork(assigned.id, path, destination.target, id);
          else { economy.defer(assigned.id, '仓库暂时无法到达', residents.farmerPosition(id)); residents.releaseFarmerWork(id); }
        } else if (economy.active(id)?.status === 'working') residents.beginFarmerWork(assigned.id, id);
        else residents.releaseFarmerWork(id);
      }
      world.sync();
      if (residents.hasMoveCommand(id)) continue;
      if (!economy.active(id)) for (let attempts = 0; attempts < ECONOMY_CONFIG.queueLimit; attempts++) {
        const task = economy.claim(id, residents.farmerPosition(id)); if (!task) break;
        const destination = world.workPoints(task.target);
        const path = destination && residents.planFarmerWork(destination.points, id);
        if (destination && path) { residents.startFarmerWork(task.id, path, destination.target, id); break; }
        economy.defer(task.id, '暂时无法到达，稍后重试');
      }
    }
    economy.state.steward.reason = stewardStatus(economy, residents.farmerIds().filter(id => residents.hasMoveCommand(id)).length);
  }
  return { update, command };
}
