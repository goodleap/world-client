import { BUILD_SITES, ECONOMY_CONFIG as C, FARM_PLOTS, RESOURCE_NODES } from './economy-config.ts';

export type Resource = 'wood' | 'stone' | 'food';
export type Inventory = Record<Resource, number>;
export type CropKind = keyof typeof C.crops;
export type WorkKind = keyof typeof C.workSeconds;
export type TaskStatus = 'waiting' | 'travelling' | 'working' | 'storage' | 'done' | 'cancelled' | 'invalid';
export interface FarmPlot { id: string; tilled: boolean; crop?: CropKind; growth: number }
export interface WorkTask {
  id: number; kind: WorkKind; target: string; crop?: CropKind; status: TaskStatus;
  progress: number; reserved: boolean; reason: string; retryAt: number;
}
export interface EconomyState {
  version: 1; nextId: number; seconds: number; inventory: Inventory;
  plots: FarmPlot[]; depleted: string[]; buildings: string[]; tasks: WorkTask[];
}
export const RESOURCE_NAMES: Record<Resource, string> = { wood: '木材', stone: '石材', food: '粮食' };
export const WORK_NAMES: Record<WorkKind, string> = { till: '开垦', sow: '播种', harvest: '收获', chop: '伐木', mine: '采石', build: '建设民房' };
export const STATUS_NAMES: Record<TaskStatus, string> = { waiting: '等待', travelling: '前往', working: '作业中', storage: '等待入库', done: '完成', cancelled: '已取消', invalid: '已失效' };
const resources: Resource[] = ['wood', 'stone', 'food'];
export const pending = (task: WorkTask) => !['done', 'cancelled', 'invalid'].includes(task.status);
const emptyCost = (): Inventory => ({ wood: 0, stone: 0, food: 0 });
function matchesTarget(kind: WorkKind, target: string) {
  if (kind === 'till' || kind === 'sow' || kind === 'harvest') return FARM_PLOTS.some(p => p.id === target);
  if (kind === 'build') return BUILD_SITES.some(s => s.id === target);
  return RESOURCE_NODES.some(n => n.id === target && n.kind === (kind === 'chop' ? 'wood' : 'stone'));
}

export function initialEconomy(): EconomyState {
  return {
    version: 1, nextId: 1, seconds: 0, inventory: { ...C.initialInventory },
    plots: FARM_PLOTS.map((p, i) => ({ id: p.id, tilled: i < 3, crop: i === 0 ? 'carrot' : i === 1 ? 'wheat' : undefined,
      growth: i === 0 ? C.crops.carrot.growthSeconds : 0 })),
    depleted: [], buildings: [], tasks: [],
  };
}

/** Gameplay state is independent of meshes, animation callbacks and frame rate. */
export class Economy {
  readonly state: EconomyState;
  revision = 0;
  constructor(state = initialEconomy()) { this.state = state; }
  plot(id: string) { return this.state.plots.find(p => p.id === id); }
  taskFor(target: string) { return this.state.tasks.find(t => t.target === target && pending(t)); }
  active() { return this.state.tasks.find(t => t.status === 'travelling' || t.status === 'working'); }
  cost(kind: WorkKind): Inventory { return kind === 'build' ? { ...C.houseCost } : emptyCost(); }
  reserved(): Inventory {
    const sum = emptyCost();
    for (const task of this.state.tasks) if (pending(task) && task.reserved) {
      const cost = this.cost(task.kind); for (const key of resources) sum[key] += cost[key];
    }
    return sum;
  }
  available(): Inventory {
    const reserved = this.reserved();
    return { wood: this.state.inventory.wood - reserved.wood, stone: this.state.inventory.stone - reserved.stone, food: this.state.inventory.food - reserved.food };
  }
  private invalidReason(kind: WorkKind, target: string, crop?: CropKind): string {
    const plot = this.plot(target);
    if (kind === 'till') return !plot ? '不是耕作地块' : plot.tilled ? '土地已经开垦' : '';
    if (kind === 'sow') return !plot?.tilled ? '请先开垦土地' : plot.crop ? '地里已有作物' : !crop || !Object.hasOwn(C.crops, crop) ? '请选择作物' : '';
    if (kind === 'harvest') return !plot?.crop ? '没有可收获的作物' : plot.growth < C.crops[plot.crop].growthSeconds ? '作物尚未成熟' : '';
    if (kind === 'chop' || kind === 'mine') {
      const node = RESOURCE_NODES.find(n => n.id === target && n.kind === (kind === 'chop' ? 'wood' : 'stone'));
      return !node ? '没有对应的资源点' : this.state.depleted.includes(target) ? '资源已采集' : '';
    }
    if (kind === 'build') return !BUILD_SITES.some(s => s.id === target) ? '请选择建设用地' : this.state.buildings.includes(target) ? '此处已经建成' : '';
    return '未知任务';
  }
  private reserve(task: WorkTask) {
    if (task.reserved) return true;
    const cost = this.cost(task.kind), available = this.available();
    const missing = resources.filter(key => cost[key] > available[key]);
    if (missing.length) { task.reason = '缺少' + missing.map(key => `${RESOURCE_NAMES[key]} ${cost[key] - available[key]}`).join('、'); return false; }
    task.reserved = true; task.reason = ''; return true;
  }
  request(kind: WorkKind, target: string, crop?: CropKind): { ok: boolean; message: string; task?: WorkTask } {
    const invalid = this.invalidReason(kind, target, crop);
    if (invalid) return { ok: false, message: invalid };
    if (this.taskFor(target)) return { ok: false, message: '该目标已有任务' };
    if (this.state.tasks.filter(pending).length >= C.queueLimit) return { ok: false, message: '作业队列已满，请等待农民完成任务' };
    const task: WorkTask = { id: this.state.nextId++, kind, target, crop: kind === 'sow' ? crop : undefined,
      status: 'waiting', progress: 0, reserved: false, reason: '', retryAt: 0 };
    this.state.tasks = this.state.tasks.filter(t => pending(t) || this.state.tasks.filter(t => !pending(t)).slice(-11).includes(t));
    this.state.tasks.push(task); this.reserve(task); this.changed();
    return { ok: true, message: task.reason ? `已排队，${task.reason}` : '已加入作业队列', task };
  }
  claim(): WorkTask | undefined {
    if (this.active()) return;
    for (const task of this.state.tasks) {
      if (task.status !== 'waiting' || task.retryAt > this.state.seconds) continue;
      const invalid = this.invalidReason(task.kind, task.target, task.crop);
      if (invalid) { task.status = 'invalid'; task.reason = invalid; task.reserved = false; this.changed(); continue; }
      if (!this.reserve(task)) continue;
      task.status = 'travelling'; task.reason = ''; this.changed(); return task;
    }
  }
  arrive(id: number) {
    const task = this.state.tasks.find(t => t.id === id);
    if (task?.status !== 'travelling') return;
    task.status = 'working'; task.reason = ''; this.changed();
  }
  defer(id: number, reason: string) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task || !['travelling', 'working'].includes(task.status)) return;
    task.status = 'waiting'; task.reason = reason; task.retryAt = this.state.seconds + C.retrySeconds; this.changed();
  }
  cancel(id: number): boolean {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task || !pending(task) || task.status === 'storage') return false;
    task.status = 'cancelled'; task.reserved = false; task.reason = '已取消，预留材料已释放'; this.changed(); return true;
  }
  /** Called only with active foreground elapsed time. Pause/resume supplies 0. */
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.state.seconds += seconds;
    for (const plot of this.state.plots) if (plot.crop && plot.growth < C.crops[plot.crop].growthSeconds) {
      const previous = Math.floor(plot.growth / C.crops[plot.crop].growthSeconds * 3);
      plot.growth = Math.min(C.crops[plot.crop].growthSeconds, plot.growth + seconds);
      if (Math.floor(plot.growth / C.crops[plot.crop].growthSeconds * 3) !== previous) this.changed();
    }
    const task = this.active();
    if (task?.status === 'working') {
      task.progress = Math.min(C.workSeconds[task.kind], task.progress + seconds);
      if (task.progress >= C.workSeconds[task.kind]) this.settle(task);
    }
    for (const waiting of this.state.tasks) if (waiting.status === 'storage') this.settle(waiting);
  }
  private settle(task: WorkTask) {
    if (!['working', 'storage'].includes(task.status)) return;
    if (task.progress < C.workSeconds[task.kind]) return;
    if (!task.reserved && !this.reserve(task)) { task.status = 'waiting'; this.changed(); return; }
    const invalid = this.invalidReason(task.kind, task.target, task.crop);
    if (invalid) { task.status = 'invalid'; task.reason = invalid; task.reserved = false; this.changed(); return; }
    const output = emptyCost(), plot = this.plot(task.target);
    if (task.kind === 'harvest' && plot?.crop) output.food = C.crops[plot.crop].yield;
    if (task.kind === 'chop' || task.kind === 'mine') {
      const node = RESOURCE_NODES.find(n => n.id === task.target)!; output[node.kind] = node.yield;
    }
    if (resources.some(key => this.state.inventory[key] + output[key] > C.capacity[key])) {
      if (task.status !== 'storage') { task.status = 'storage'; task.reason = '仓储不足，保留本次产出等待入库'; this.changed(); }
      return;
    }
    const cost = this.cost(task.kind);
    // All validation happens before this single settlement. No animation event
    // can grant output, and a terminal task cannot settle a second time.
    for (const key of resources) this.state.inventory[key] += output[key] - cost[key];
    if (task.kind === 'till') plot!.tilled = true;
    if (task.kind === 'sow') { plot!.crop = task.crop; plot!.growth = 0; }
    if (task.kind === 'harvest') { plot!.crop = undefined; plot!.growth = 0; }
    if (task.kind === 'chop' || task.kind === 'mine') this.state.depleted.push(task.target);
    if (task.kind === 'build') this.state.buildings.push(task.target);
    task.status = 'done'; task.reserved = false; task.reason = ''; this.changed();
  }
  private changed() { this.revision++; }
}

/** Saves contain domain state only; no rendering objects or wall-clock catch-up. */
export function encodeEconomy(economy: Economy): string {
  const state = economy.state;
  return JSON.stringify({ ...state, tasks: [...state.tasks.filter(t => !pending(t)).slice(-12), ...state.tasks.filter(pending)] });
}
export function decodeEconomy(text: string): Economy {
  const saved: unknown = JSON.parse(text);
  if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1) throw new Error('不支持的存档版本');
  const raw = saved as EconomyState, state = initialEconomy();
  const number = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  if (!raw.inventory || !resources.every(k => number(raw.inventory[k], C.capacity[k]) && Number.isInteger(raw.inventory[k]))) throw new Error('库存存档无效');
  if (!Array.isArray(raw.plots) || raw.plots.length !== state.plots.length || !Array.isArray(raw.tasks) || raw.tasks.length > C.queueLimit + 12) throw new Error('作业存档无效');
  state.inventory = { ...raw.inventory };
  state.plots = state.plots.map(plot => {
    const value = raw.plots.find(p => p.id === plot.id);
    if (!value || typeof value.tilled !== 'boolean' || !number(value.growth, 1e6)
      || value.crop !== undefined && (!Object.hasOwn(C.crops, value.crop) || !value.tilled)) throw new Error('耕地存档无效');
    return { id: plot.id, tilled: value.tilled, crop: value.crop, growth: value.crop ? Math.min(value.growth, C.crops[value.crop].growthSeconds) : 0 };
  });
  if (!Array.isArray(raw.depleted) || !raw.depleted.every(id => RESOURCE_NODES.some(n => n.id === id))
    || !Array.isArray(raw.buildings) || !raw.buildings.every(id => BUILD_SITES.some(s => s.id === id))) throw new Error('地图存档无效');
  state.depleted = [...new Set(raw.depleted)]; state.buildings = [...new Set(raw.buildings)];
  const ids = new Set<number>(), targets = new Set<string>();
  for (const task of raw.tasks) {
    if (!task || !Number.isSafeInteger(task.id) || task.id < 1 || ids.has(task.id) || !Object.hasOwn(C.workSeconds, task.kind)
      || !Object.hasOwn(STATUS_NAMES, task.status) || !number(task.progress, C.workSeconds[task.kind])
      || !matchesTarget(task.kind, task.target)
      || task.kind === 'sow' && (task.crop === undefined || !Object.hasOwn(C.crops, task.crop))
      || task.status === 'storage' && (!['chop', 'mine', 'harvest'].includes(task.kind) || task.progress !== C.workSeconds[task.kind])) throw new Error('任务存档无效');
    ids.add(task.id);
    if (pending(task)) { if (targets.has(task.target)) throw new Error('重复目标'); targets.add(task.target); }
    state.tasks.push({ id: task.id, kind: task.kind, target: task.target, crop: task.crop,
      status: task.status === 'travelling' || task.status === 'working' ? 'waiting' : task.status,
      progress: task.progress, reserved: false, reason: task.status === 'storage' ? '等待入库' : '', retryAt: 0 });
  }
  state.nextId = Math.max(0, ...ids) + 1;
  // Re-establish reservations deterministically from actual inventory on resume.
  const economy = new Economy(state);
  for (const task of state.tasks) if (pending(task)) {
    const cost = economy.cost(task.kind), available = economy.available();
    task.reserved = resources.every(k => cost[k] <= available[k]);
  }
  return economy;
}
