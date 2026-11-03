import type { GameUI, SelectionDetails } from '../ui.ts';
import { ECONOMY_CONFIG as C, RESOURCE_NODES } from './economy-config.ts';
import { Economy, pending, RESOURCE_NAMES, STATUS_NAMES, WORK_NAMES, resources } from './economy.ts';
import type { WorldObject } from './world-selection.ts';
import { fireIsLit } from './campfire.ts';
import { BUILDING_TYPES } from './construction.ts';
import { buildingInfo, repairQuote } from './building-state.ts';

export function buildingSelection(e:Economy,id:string,details:SelectionDetails):SelectionDetails{
  const b=buildingInfo(e.state,id);if(!b?.built)return details;
  const task=e.taskFor(id),quote=repairQuote(e.state,id);
  const actions=b.hp<=0?(details.actions??[]).filter(a=>a.id==='cancel'):details.actions??[];
  if(quote&&!task)actions.push({id:'repair',label:`维修 · 木${quote.cost.wood} 石${quote.cost.stone}`});
  else if(task?.kind==='repair'&&!actions.some(a=>a.id==='cancel'))actions.push({id:'cancel',label:'取消维修'});
  const repairing=task?.kind==='repair';
  const state=repairing?`维修 · ${STATUS_NAMES[task.status]}${task.status==='working'?` ${Math.floor(task.progress/C.workSeconds.repair*100)}%`:''}${task.reason?' · '+task.reason:''}`:b.hp<=0?'损毁，等待维修':'';
  return {...details,showHint:true,hint:`生命 ${Math.ceil(b.hp)}/${b.maxHealth} · 防御 ${b.armor}${state?' · '+state:''}${!repairing&&details.hint&&details.hint!=='暂无可用操作'?' · '+details.hint:''}`,actions};
}

export function economySelection(economy: Economy, object: WorldObject): SelectionDetails {
  const kinds = { building: '建筑', tree: '树木', crop: '农作物', scenery: '景物', plot: '土地', rock: '资源', site: '建设', goods: '待入库资源' };
  const details: SelectionDetails = { name: object.name, kind: kinds[object.kind], hint: '暂无可用操作', actions: [] };
  const fire = economy.campfire(object.id);
  if (fire) {
    const task = economy.taskFor(object.id);
    details.showHint = true;
    details.hint = `${fireIsLit(fire) ? '燃烧' : fire.enabled ? '待补柴' : '熄火'} · 木${fire.wood} 粮${fire.food} 熟食${fire.meals}${task ? ' · 补给中' : ''}`;
    details.actions = [{ id: 'fire-toggle', label: fire.enabled ? '熄火' : '点火' },
      { id: 'cook-toggle', label: fire.cooking ? '停止烹饪' : '开启烹饪' }];
    return details;
  }
  const task = economy.taskFor(object.id);
  if (task) {
    details.hint = `${WORK_NAMES[task.kind]} · ${STATUS_NAMES[task.status]}${task.reason ? ' · ' + task.reason : ''}`;
    if (task.status === 'working') details.hint += ` · ${Math.floor(task.progress / C.workSeconds[task.kind] * 100)}%`;
    if (task.status !== 'storage') details.actions = [{ id: 'cancel', label: '取消作业' }];
    return details;
  }
  if (object.kind === 'goods') {
    const goods = economy.state.goods.find(g => g.id === object.id)!;
    details.hint = `${RESOURCE_NAMES[goods.resource]} ${goods.amount} · 尚未入库`;
    details.actions = [{ id: 'haul', label: '运送仓库' }]; return details;
  }
  if (object.id === 'warehouse' || economy.state.sites.some(s => s.id === object.id && s.kind === 'warehouse' && economy.state.buildings.includes(s.id))) {
    details.showHint = true; details.hint = `工具 ${economy.state.upgrades.tools}/3 · 装备 ${economy.state.upgrades.arms}/3`;
    details.actions = [{ id: 'tools', label: '工具 · 铁8 木4', disabled: economy.state.upgrades.tools >= C.upgradeLimit }, { id: 'arms', label: '装备 · 铁12 木6', disabled: economy.state.upgrades.arms >= C.upgradeLimit }];
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
    details.showHint = true;
    const locked = economy.regionLocked(node);
    if (locked) details.hint = locked;
    details.actions = [{ id: node.kind === 'wood' ? 'chop' : node.kind === 'food' ? 'gather' : 'mine', label: node.kind === 'wood' ? '伐木' : node.kind === 'food' ? '采集' : '采矿', disabled: !!locked }];
  } else if (object.kind === 'site') {
    const cost = economy.cost('build', object.id), site = economy.state.sites.find(s => s.id === object.id)!;
    details.hint = `需木材 ${cost.wood}、石材 ${cost.stone}`;
    details.actions = [{ id: 'build', label: `建造${BUILDING_TYPES[site.kind].name}` }];
  }
  return details;
}

export function updateEconomyUI(ui: GameUI, economy: Economy) {
  const reserved = economy.reserved();
  ui.setResources(resources.map(key => ({ name: RESOURCE_NAMES[key], amount: economy.state.inventory[key], capacity: economy.capacity()[key], reserved: reserved[key], ground: economy.state.goods.filter(g => g.resource === key && g.state === 'ground').reduce((n,g)=>n+g.amount,0), transit: economy.state.goods.filter(g => g.resource === key && g.state === 'transit').reduce((n,g)=>n+g.amount,0) })));
  const active = economy.state.tasks.filter(pending), recent = economy.state.tasks.filter(t => !pending(t)).slice(-3).reverse();
  ui.setQueue([...active, ...recent].map(task => {
    const plotIndex = economy.state.plots.findIndex(plot => plot.id === task.target);
    const target = task.kind === 'repair' ? buildingInfo(economy.state,task.target)?.name ?? '建筑' : task.target === 'warehouse' ? '仓库工坊' : task.target.startsWith('iron-') ? '铁矿' : task.target.startsWith('forage-') ? '林间食物' : task.kind === 'supply' ? `火堆 · ${RESOURCE_NAMES[task.resource!]} ${task.amount}` : plotIndex >= 0 ? `土地 ${plotIndex + 1}` : task.target.startsWith('goods-') ? '待入库资源' : task.target.startsWith('site') ? `用地 ${Number(task.target.slice(5)) + 1}` : task.target.startsWith('tree') ? '阔叶树' : '石材';
    return { id: task.id, title: `${WORK_NAMES[task.kind]} · ${target}`, status: task.kind === 'supply' && task.status === 'delivering' ? '送往火堆' : STATUS_NAMES[task.status],
      progress: Math.floor(task.progress / C.workSeconds[task.kind] * 100), reason: task.reason,
      cancellable: pending(task) && task.status !== 'storage' };
  }), active.length);
}
