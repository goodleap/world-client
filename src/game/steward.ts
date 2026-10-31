import { Economy, pending } from './economy.ts';
import type { CropKind, Resource } from './economy.ts';
import { ECONOMY_CONFIG as C, FARM_PLOTS, RESOURCE_NODES } from './economy-config.ts';
import { GRID_SIZE, HOME } from './world-data.ts';
import type { Point } from './movement.ts';
export const STEWARD_CONFIG = { radius: 30, maxFields: 6, target: { food: 160, wood: 96, stone: 72 } } as const;
export const inStewardRange = (point: Point) => Math.hypot(point.x - HOME.x, point.z - HOME.z) <= STEWARD_CONFIG.radius * GRID_SIZE;

/** Each quantity is counted at exactly one location in its production pipeline. */
export function expectedSupply(e: Economy, resource: Resource) {
  let amount = e.available()[resource] + e.state.goods.filter(g => g.resource === resource).reduce((n, g) => n + g.amount, 0);
  if (resource === 'food') {
    for (const plot of e.state.plots) if (plot.crop) amount += C.crops[plot.crop].yield;
    for (const t of e.state.tasks) if (pending(t) && t.kind === 'sow' && t.crop) amount += C.crops[t.crop].yield;
  } else for (const t of e.state.tasks) if (pending(t) && t.kind === (resource === 'wood' ? 'chop' : 'mine')) {
    amount += RESOURCE_NODES.find(n => n.id === t.target)?.yield ?? 0;
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
    update() {
      if (!economy.state.steward.enabled || economy.state.seconds < economy.state.steward.nextDecision) return;
      economy.state.steward.nextDecision = economy.state.seconds + .5;
      for (const goods of economy.state.goods) if (inStewardRange(goods) && !economy.taskFor(goods.id)) {
        economy.request('haul', goods.id, undefined, 'steward');
      }
      const managed = FARM_PLOTS.filter(inStewardRange);
      for (const definition of managed) {
        const plot = economy.plot(definition.id)!;
        if (plot.crop && !economy.taskFor(plot.id)) economy.request('harvest', plot.id, undefined, 'steward');
      }
      let fields = managed.filter(p => economy.plot(p.id)!.crop || economy.taskFor(p.id)).length;
      // Reuse tilled ground before opening more; leave paths and expansion land intact.
      const candidates = [...managed].sort((a, b) => Number(economy.plot(b.id)!.tilled) - Number(economy.plot(a.id)!.tilled));
      for (const definition of candidates) {
        if (fields >= STEWARD_CONFIG.maxFields || expectedSupply(economy, 'food') >= STEWARD_CONFIG.target.food) break;
        const plot = economy.plot(definition.id)!;
        if (plot.crop || economy.taskFor(plot.id)) continue;
        const result = plot.tilled ? economy.request('sow', plot.id, chooseCrop(economy), 'steward') : economy.request('till', plot.id, undefined, 'steward');
        if (result.ok) fields++;
      }
      for (const resource of ['wood', 'stone'] as const) {
        if (expectedSupply(economy, resource) >= STEWARD_CONFIG.target[resource]) continue;
        const node = RESOURCE_NODES.filter(n => n.kind === resource && inStewardRange(n) && !economy.state.depleted.includes(n.id) && !economy.taskFor(n.id))
          .sort((a, b) => Math.hypot(a.x - HOME.x, a.z - HOME.z) - Math.hypot(b.x - HOME.x, b.z - HOME.z))[0];
        if (node) economy.request(resource === 'wood' ? 'chop' : 'mine', node.id, undefined, 'steward');
      }
    },
  };
}

export function stewardStatus(e: Economy, manualFarmers = 0) {
  if (!e.state.steward.enabled) return '自动经营已暂停';
  const tasks = e.state.tasks.filter(pending);
  const active = tasks.filter(t => ['working', 'travelling', 'delivering'].includes(t.status));
  if (active.length) return `经营中 · ${active.length} 位农民作业${manualFarmers ? ' · 手动指令优先' : ''}`;
  if (manualFarmers) return '等待农民完成手动指令';
  if (e.state.goods.some(g => e.state.inventory[g.resource] >= C.capacity[g.resource])) return '等待仓库腾出空间';
  const blocked = tasks.find(t => t.reason); if (blocked) return blocked.reason;
  if (tasks.length) return '正在分配可执行作业';
  if (e.state.plots.some(p => p.crop && p.growth < C.crops[p.crop].growthSeconds)) return '等待作物成熟';
  if (expectedSupply(e, 'food') >= STEWARD_CONFIG.target.food) return '供应充足 · 等待库存消耗';
  return '范围内暂无可执行作业';
}
