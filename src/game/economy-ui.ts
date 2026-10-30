import type { GameUI, SelectionDetails } from '../ui.ts';
import { ECONOMY_CONFIG as C, RESOURCE_NODES, FARM_PLOTS } from './economy-config.ts';
import { Economy, pending, RESOURCE_NAMES, STATUS_NAMES, WORK_NAMES } from './economy.ts';
import type { Resource } from './economy.ts';
import type { WorldObject } from './world-selection.ts';

export function economySelection(economy: Economy, object: WorldObject): SelectionDetails {
  const kinds = { building: '建筑', tree: '树木', crop: '农作物', scenery: '景物', plot: '土地', rock: '资源', site: '建设' };
  const details: SelectionDetails = { name: object.name, kind: kinds[object.kind], hint: '暂无可用操作', actions: [] };
  const task = economy.taskFor(object.id);
  if (task) {
    details.hint = `${WORK_NAMES[task.kind]} · ${STATUS_NAMES[task.status]}${task.reason ? ' · ' + task.reason : ''}`;
    if (task.status === 'working') details.hint += ` · ${Math.floor(task.progress / C.workSeconds[task.kind] * 100)}%`;
    if (task.status !== 'storage') details.actions = [{ id: 'cancel', label: '取消作业' }];
    return details;
  }
  const plot = economy.plot(object.id);
  if (plot) {
    if (!plot.tilled) { details.hint = '未开垦'; details.actions = [{ id: 'till', label: '开垦' }]; }
    else if (!plot.crop) {
      details.hint = '选择作物';
      details.actions = [{ id: 'sow-carrot', label: '种胡萝卜' }, { id: 'sow-wheat', label: '种小麦' }];
    } else if (plot.growth >= C.crops[plot.crop].growthSeconds) {
      details.hint = `已成熟 · 粮食 +${C.crops[plot.crop].yield}`;
      details.actions = [{ id: 'harvest', label: '收获' }];
    } else details.hint = `生长中 · 还需 ${Math.ceil(C.crops[plot.crop].growthSeconds - plot.growth)} 秒`;
  } else if (object.kind === 'tree' || object.kind === 'rock') {
    const node = RESOURCE_NODES.find(n => n.id === object.id)!;
    details.hint = `${RESOURCE_NAMES[node.kind]} +${node.yield}`;
    details.actions = [{ id: object.kind === 'tree' ? 'chop' : 'mine', label: object.kind === 'tree' ? '伐木' : '采石' }];
  } else if (object.kind === 'site') {
    details.hint = `需木材 ${C.houseCost.wood}、石材 ${C.houseCost.stone}`;
    details.actions = [{ id: 'build', label: '建设民房' }];
  } else if (object.id.startsWith('site-')) details.hint = '民房已建成';
  return details;
}

export function updateEconomyUI(ui: GameUI, economy: Economy) {
  const reserved = economy.reserved();
  ui.setResources((['wood', 'stone', 'food'] as Resource[]).map(key => ({ name: RESOURCE_NAMES[key], amount: economy.state.inventory[key], capacity: C.capacity[key], reserved: reserved[key] })));
  const active = economy.state.tasks.filter(pending), recent = economy.state.tasks.filter(t => !pending(t)).slice(-3).reverse();
  ui.setQueue([...active, ...recent].map(task => {
    const plotIndex = FARM_PLOTS.findIndex(plot => plot.id === task.target);
    const target = plotIndex >= 0 ? `土地 ${plotIndex + 1}` : task.target.startsWith('site') ? `用地 ${Number(task.target.slice(5)) + 1}` : task.target.startsWith('tree') ? '阔叶树' : '石材';
    return { id: task.id, title: `${WORK_NAMES[task.kind]} · ${target}`, status: STATUS_NAMES[task.status],
      progress: Math.floor(task.progress / C.workSeconds[task.kind] * 100), reason: task.reason,
      cancellable: pending(task) && task.status !== 'storage' };
  }), active.length);
}
