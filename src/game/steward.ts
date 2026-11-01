import { Economy, pending } from './economy.ts';
import type { CropKind, Resource, WorkKind } from './economy.ts';
import { ECONOMY_CONFIG as C, RESOURCE_NODES } from './economy-config.ts';
import { GRID_SIZE, HOME } from './world-data.ts';
import type { Point } from './movement.ts';
export const STEWARD_CONFIG = { radius: 30 } as const;
export const inStewardRange = (point: Point) => Math.hypot(point.x - HOME.x, point.z - HOME.z) <= STEWARD_CONFIG.radius * GRID_SIZE;

/** Each quantity is counted at exactly one location in its production pipeline. */
export function expectedSupply(e: Economy, resource: Resource) {
  let amount = e.available()[resource] + e.state.goods.filter(g => g.resource === resource && !g.destination).reduce((n, g) => n + g.amount, 0);
  if (resource === 'food') {
    for (const plot of e.state.plots) if (plot.crop) amount += C.crops[plot.crop].yield;
    for (const t of e.state.tasks) if (pending(t) && t.kind === 'sow' && t.crop) amount += C.crops[t.crop].yield;
  } else for (const t of e.state.tasks) if (pending(t) && t.kind === (resource === 'wood' ? 'chop' : 'mine')) {
    amount += (RESOURCE_NODES.find(n => n.id === t.target && n.kind === resource)?.yield ?? 0);
  }
  return amount;
}
export function chooseCrop(e: Economy): CropKind {
  const committed = (kind: CropKind) => e.state.plots.filter(p => p.crop === kind).length
    + e.state.tasks.filter(t => pending(t) && t.kind === 'sow' && t.crop === kind).length
    + e.state.goods.filter(g => g.crop === kind).length;
  // Short-cycle vegetables bridge a low pantry; otherwise alternate supply
  // with slower, more productive wheat, including already committed harvests.
  if (e.state.inventory.food < 24 && committed('carrot') < 2) return 'carrot';
  return committed('wheat') <= committed('carrot') ? 'wheat' : 'carrot';
}
export function createSteward(economy: Economy) {
  return {
    /** Called only after one idle farmer has exhausted existing runnable jobs.
     * Consider alternatives, but commit exactly one order for that vacancy. */
    requestWork(position: Point = HOME) {
      if (!economy.state.steward.enabled) return;
      const capacity = economy.capacity();
      const candidates: { kind: WorkKind; target: string; point: Point; priority: number; crop?: CropKind }[] = [];
      for (const goods of economy.state.goods) if (goods.state === 'ground' && inStewardRange(goods)
        && economy.state.inventory[goods.resource] < capacity[goods.resource] && !economy.taskFor(goods.id)) {
        candidates.push({ kind: 'haul', target: goods.id, point: goods, priority: 0 });
      }
      const managed = economy.state.plots.filter(inStewardRange);
      if (economy.state.inventory.food < capacity.food) {
        const canSow = expectedSupply(economy, 'food') < capacity.food;
        for (const plot of managed) {
          if (economy.taskFor(plot.id)) continue;
          if (plot.crop && plot.growth >= C.crops[plot.crop].growthSeconds) candidates.push({ kind: 'harvest', target: plot.id, point: plot, priority: 1 });
          else if (canSow && plot.tilled && !plot.crop) candidates.push({ kind: 'sow', target: plot.id, point: plot, crop: chooseCrop(economy), priority: 2 });
        }
      }
      for (const resource of ['wood', 'stone'] as const) {
        if (economy.state.inventory[resource] >= capacity[resource] || expectedSupply(economy, resource) >= capacity[resource]) continue;
        const needed = economy.state.tasks.filter(t => pending(t) && t.kind === 'build' && !t.reserved)
          .reduce((sum, t) => sum + economy.cost('build', t.target)[resource], 0);
        const priority = needed > economy.available()[resource] ? .5 : 4;
        for (const node of RESOURCE_NODES) if (node.kind === resource && inStewardRange(node)
          && !economy.regionLocked(node) && !economy.state.depleted.includes(node.id) && !economy.taskFor(node.id)) {
          candidates.push({ kind: resource === 'wood' ? 'chop' : 'mine', target: node.id, point: node, priority });
        }
      }
      candidates.sort((a, b) => a.priority - b.priority
        || Math.hypot(a.point.x - position.x, a.point.z - position.z) - Math.hypot(b.point.x - position.x, b.point.z - position.z));
      const job = candidates[0];
      return job && economy.request(job.kind, job.target, job.crop, 'steward').task;
    },
  };
}

export function stewardStatus(e: Economy, manualFarmers = 0) {
  if (!e.state.steward.enabled) return '自动经营已暂停';
  const tasks = e.state.tasks.filter(pending);
  const active = tasks.filter(t => ['working', 'travelling', 'delivering'].includes(t.status));
  if (active.length) return `经营中 · ${active.length} 位农民作业${manualFarmers ? ' · 手动指令优先' : ''}`;
  if (manualFarmers) return '等待农民完成手动指令';
  if (e.state.goods.some(g => e.state.inventory[g.resource] >= e.capacity()[g.resource])) return '等待仓库腾出空间';
  const blocked = tasks.find(t => t.reason); if (blocked) return blocked.reason;
  if (tasks.length) return '正在分配可执行作业';
  if ((['food', 'wood', 'stone'] as const).every(resource => e.state.inventory[resource] >= e.capacity()[resource])) return '仓库已满 · 等待腾出空间';
  if (e.state.inventory.food < e.capacity().food && e.state.plots.some(p => p.crop && p.growth < C.crops[p.crop].growthSeconds)) return '等待作物成熟';
  return '范围内暂无可执行作业';
}
