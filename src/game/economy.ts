import type { Point, Obstacle } from './movement.ts';
import { WAREHOUSE_DOOR, WORLD_BOUNDS } from './world-data.ts';
import { ECONOMY_CONFIG as C, FARM_PLOTS, RESOURCE_NODES, economyObstacles } from './economy-config.ts';
import { buildingAt, buildingDoor, placementReason, BUILDING_TYPES } from './construction.ts';
import type { BuildingSite, BuildingKind } from './construction.ts';
import { findPath } from './pathfinding.ts';

export type Resource = 'wood' | 'stone' | 'food';
export type Inventory = Record<Resource, number>;
export type CropKind = keyof typeof C.crops;
export type WorkKind = keyof typeof C.workSeconds;
export type TaskStatus = 'waiting' | 'travelling' | 'working' | 'delivering' | 'storage' | 'done' | 'cancelled' | 'invalid';
export interface FarmPlot { id: string; tilled: boolean; crop?: CropKind; growth: number; harvests?: number; lastCrop?: CropKind }
export interface WorkTask {
  id: number; kind: WorkKind; target: string; crop?: CropKind; status: TaskStatus;
  worker?: string; origin?: 'manual' | 'steward';
  progress: number; reserved: boolean; reason: string; retryAt: number;
}
export interface Goods extends Point { id: string; resource: Resource; amount: number; crop?: CropKind; state: 'ground' | 'transit'; carrier?: string }
export interface SavedResident { position: Point; manualGoal?: Point }
export interface EconomyState {
  residents: Record<string, SavedResident>;
  steward: { enabled: boolean; nextDecision: number; reason: string };
  version: 3; sites: BuildingSite[]; nextSiteId: number; goods: Goods[]; nextId: number; seconds: number; inventory: Inventory;
  plots: FarmPlot[]; depleted: string[]; buildings: string[]; tasks: WorkTask[];
}
export const RESOURCE_NAMES: Record<Resource, string> = { wood: '木材', stone: '石材', food: '粮食' };
export const WORK_NAMES: Record<WorkKind, string> = { till: '开垦', sow: '播种', harvest: '收获', chop: '伐木', mine: '采石', build: '建设民房', haul: '搬运' };
export const STATUS_NAMES: Record<TaskStatus, string> = { waiting: '等待', travelling: '前往', working: '作业中', delivering: '运送仓库', storage: '等待入库', done: '完成', cancelled: '已取消', invalid: '已失效' };
const resources: Resource[] = ['wood', 'stone', 'food'];
export const pending = (task: WorkTask) => !['done', 'cancelled', 'invalid'].includes(task.status);
const emptyCost = (): Inventory => ({ wood: 0, stone: 0, food: 0 });
function matchesTarget(kind: WorkKind, target: string, sites: BuildingSite[], terminal: boolean) {
  if (kind === 'till' || kind === 'sow' || kind === 'harvest') return FARM_PLOTS.some(p => p.id === target);
  if (kind === 'haul') return /^goods-\d+$/.test(target);
  if (kind === 'build') return sites.some(s => s.id === target) || terminal && /^site-\d+$/.test(target);
  return RESOURCE_NODES.some(n => n.id === target && n.kind === (kind === 'chop' ? 'wood' : 'stone'));
}

export function initialEconomy(): EconomyState {
  return {
    version: 3, sites: [], nextSiteId: 0, goods: [], residents: {}, steward: { enabled: true, nextDecision: 0, reason: '正在安排作业' }, nextId: 1, seconds: 0, inventory: { ...C.initialInventory },
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
  placeBuilding(kind: BuildingKind, point: Point, occupants: readonly Obstacle[] = []): { ok: boolean; message: string; task?: WorkTask } {
    if (!Object.hasOwn(BUILDING_TYPES, kind)) return { ok: false, message: '未知建筑类型' };
    if (this.state.sites.length >= 100) return { ok: false, message: '已达到家园建筑上限' };
    const site = buildingAt(kind, point, `site-${this.state.nextSiteId}`);
    const reason = placementReason(site, this.state, occupants);
    if (reason) return { ok: false, message: reason };
    const obstacles = economyObstacles(this.state.depleted, [...this.state.sites, site]);
    if (!findPath(WAREHOUSE_DOOR, buildingDoor(site), .35, WORLD_BOUNDS, obstacles)) return { ok: false, message: '入口无法从仓库到达，请换一处空地' };
    this.state.sites.push(site);
    const result = this.request('build', site.id);
    if (result.ok) this.state.nextSiteId++;
    else this.state.sites.pop();
    return result;
  }
  plot(id: string) { return this.state.plots.find(p => p.id === id); }
  taskFor(target: string) { return this.state.tasks.find(t => t.target === target && pending(t)); }
  active(worker = 'farmer') { return this.state.tasks.find(t => (t.worker ?? 'farmer') === worker && (t.status === 'travelling' || t.status === 'working' || t.status === 'delivering')); }
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
    if (kind === 'haul') return this.state.goods.some(g => g.id === target && g.amount > 0) ? '' : '资源已入库';
    const plot = this.plot(target);
    if (kind === 'till') return !plot ? '不是耕作地块' : plot.tilled ? '土地已经开垦' : '';
    if (kind === 'sow') return !plot?.tilled ? '请先开垦土地' : plot.crop ? '地里已有作物' : !crop || !Object.hasOwn(C.crops, crop) ? '请选择作物' : '';
    if (kind === 'harvest') return !plot?.crop ? '没有可收获的作物' : plot.growth < C.crops[plot.crop].growthSeconds ? '作物尚未成熟' : '';
    if (kind === 'chop' || kind === 'mine') {
      const node = RESOURCE_NODES.find(n => n.id === target && n.kind === (kind === 'chop' ? 'wood' : 'stone'));
      return !node ? '没有对应的资源点' : this.state.depleted.includes(target) ? '资源已采集' : '';
    }
    if (kind === 'build') return !this.state.sites.some(s => s.id === target) ? '请选择建设用地' : this.state.buildings.includes(target) ? '此处已经建成' : '';
    return '未知任务';
  }
  private reserve(task: WorkTask) {
    if (task.reserved) return true;
    const cost = this.cost(task.kind), available = this.available();
    const missing = resources.filter(key => cost[key] > available[key]);
    if (missing.length) { task.reason = '缺少' + missing.map(key => `${RESOURCE_NAMES[key]} ${cost[key] - available[key]}`).join('、'); return false; }
    task.reserved = true; task.reason = ''; return true;
  }
  request(kind: WorkKind, target: string, crop?: CropKind, origin: 'manual' | 'steward' = 'manual'): { ok: boolean; message: string; task?: WorkTask } {
    const invalid = this.invalidReason(kind, target, crop);
    if (invalid) return { ok: false, message: invalid };
    if (this.taskFor(target)) return { ok: false, message: '该目标已有任务' };
    if (this.state.tasks.filter(pending).length >= C.queueLimit) return { ok: false, message: '作业队列已满，请等待农民完成任务' };
    const task: WorkTask = { origin, id: this.state.nextId++, kind, target, crop: kind === 'sow' ? crop : undefined,
      status: 'waiting', progress: 0, reserved: false, reason: '', retryAt: 0 };
    const recent = new Set(this.state.tasks.filter(t => !pending(t)).slice(-11));
    this.state.tasks = this.state.tasks.filter(t => pending(t) || recent.has(t));
    this.state.tasks.push(task); this.reserve(task); this.changed();
    return { ok: true, message: task.reason ? `已排队，${task.reason}` : '已加入作业队列', task };
  }
  claim(worker = 'farmer', position?: Point): WorkTask | undefined {
    if (this.active(worker)) return;
    const rank: Record<WorkKind, number> = { haul: 0, harvest: 1, sow: 2, chop: 4, mine: 4, till: 3, build: 5 };
    const distance = (t: WorkTask) => {
      const point = FARM_PLOTS.find(p => p.id === t.target) ?? RESOURCE_NODES.find(n => n.id === t.target) ?? this.state.goods.find(g => g.id === t.target);
      return point && position ? Math.hypot(point.x - position.x, point.z - position.z) : 0;
    };
    const ordered = [...this.state.tasks].sort((a, b) => Number(a.origin === 'steward') - Number(b.origin === 'steward')
      || (a.origin === 'steward' ? rank[a.kind] - rank[b.kind] || distance(a) - distance(b) : 0) || a.id - b.id);
    for (const task of ordered) {
      if (task.status !== 'waiting' || task.retryAt > this.state.seconds) continue;
      const invalid = this.invalidReason(task.kind, task.target, task.crop);
      if (invalid) { task.status = 'invalid'; task.reason = invalid; task.reserved = false; this.changed(); continue; }
      const production = task.kind === 'chop' ? 'wood' : task.kind === 'mine' ? 'stone'
        : ['till', 'sow', 'harvest'].includes(task.kind) ? 'food' : undefined;
      if (task.origin === 'steward' && production && this.state.inventory[production] >= C.capacity[production]) {
        task.reason = `${RESOURCE_NAMES[production]}仓位已满，等待腾出空间`; continue;
      }
      if (task.kind === 'haul') {
        const goods = this.state.goods.find(g => g.id === task.target)!;
        if (this.state.inventory[goods.resource] >= C.capacity[goods.resource]) { task.reason = '仓库已满，资源保留在地面'; continue; }
      }
      if (!this.reserve(task)) continue;
      task.worker = worker; task.status = 'travelling'; task.reason = ''; this.changed(); return task;
    }
  }
  /** A player command pauses work, preserving progress and reserved materials. */
  interrupt(position?: Point, worker = 'farmer') {
    const task = this.active(worker);
    if (!task) return;
    this.dropCargo(task, position);
    task.worker = undefined; task.status = 'waiting'; task.reason = '等待恢复'; task.retryAt = 0; this.changed();
  }
  assign(id: number, worker = 'farmer'): { ok: boolean; message: string } {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task || !['waiting', 'travelling', 'working', 'delivering'].includes(task.status)) return { ok: false, message: '该作业暂不可执行' };
    if (task.worker && task.worker !== worker && task.status !== 'waiting') return { ok: false, message: '其他农民正在执行该任务' };
    const invalid = this.invalidReason(task.kind, task.target, task.crop);
    if (invalid) return { ok: false, message: invalid };
    if (!this.reserve(task)) { this.changed(); return { ok: false, message: `已排队，${task.reason}` }; }
    if (this.active(worker)?.id !== id) this.interrupt(undefined, worker);
    task.worker = worker; task.origin = 'manual';
    if (task.status !== 'working') task.status = 'travelling';
    task.reason = ''; task.retryAt = 0; this.changed();
    return { ok: true, message: `优先${WORK_NAMES[task.kind]}` };
  }
  arrive(id: number) {
    const task = this.state.tasks.find(t => t.id === id);
    if (task?.status === 'delivering') { this.deliver(task); return; }
    if (task?.status !== 'travelling') return;
    if (task.kind === 'haul') {
      const goods = this.state.goods.find(g => g.id === task.target);
      if (!goods) return;
      goods.state = 'transit'; goods.carrier = task.worker ?? 'farmer';
      task.status = 'delivering'; this.changed(); return;
    }
    task.status = 'working'; task.reason = ''; this.changed();
  }
  defer(id: number, reason: string, position?: Point) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task || !['waiting', 'travelling', 'working', 'delivering'].includes(task.status)) return;
    this.dropCargo(task, position);
    task.worker = undefined; task.status = 'waiting'; task.reason = reason; task.retryAt = this.state.seconds + C.retrySeconds; this.changed();
  }
  cancel(id: number, position?: Point): boolean {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task || !pending(task) || task.status === 'storage') return false;
    this.dropCargo(task, position);
    if (task.kind === 'build') this.state.sites = this.state.sites.filter(s => s.id !== task.target);
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
    for (const task of this.state.tasks) if (task.status === 'working') {
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
    const cost = this.cost(task.kind);
    // All validation happens before this single settlement. No animation event
    // can grant output, and a terminal task cannot settle a second time.
    for (const key of resources) this.state.inventory[key] -= cost[key];
    if (task.kind === 'till') plot!.tilled = true;
    if (task.kind === 'sow') { plot!.crop = task.crop; plot!.growth = 0; }
    if (task.kind === 'harvest') {
      plot!.lastCrop = plot!.crop; plot!.harvests = (plot!.harvests ?? 0) + 1;
      plot!.crop = undefined; plot!.growth = 0;
    }
    if (task.kind === 'chop' || task.kind === 'mine') this.state.depleted.push(task.target);
    if (task.kind === 'build') this.state.buildings.push(task.target);
    for (const resource of resources) if (output[resource]) {
      const point = FARM_PLOTS.find(p => p.id === task.target) ?? RESOURCE_NODES.find(n => n.id === task.target)!;
      this.state.goods.push({ id: `goods-${task.id}`, resource, amount: output[resource], crop: task.kind === 'harvest' ? plot!.lastCrop : undefined, x: point.x, z: point.z, state: 'ground' });
    }
    task.status = 'done'; task.reserved = false; task.reason = ''; this.changed();
  }
  private dropCargo(task: WorkTask, position?: Point) {
    const goods = this.state.goods.find(g => g.id === task.target);
    if (goods?.state === 'transit') {
      if (position) { goods.x = position.x; goods.z = position.z; }
      goods.state = 'ground'; goods.carrier = undefined;
    }
  }
  updateCargo(position: Point, carrier = 'farmer') {
    for (const goods of this.state.goods) if (goods.carrier === carrier) { goods.x = position.x; goods.z = position.z; }
  }
  private deliver(task: WorkTask) {
    const goods = this.state.goods.find(g => g.id === task.target);
    if (!goods || goods.state !== 'transit') return;
    const amount = Math.min(goods.amount, C.capacity[goods.resource] - this.state.inventory[goods.resource]);
    this.state.inventory[goods.resource] += amount; goods.amount -= amount;
    if (!goods.amount) {
      this.state.goods = this.state.goods.filter(g => g !== goods);
      task.status = 'done'; task.reserved = false; task.reason = '';
    } else {
      this.dropCargo(task, WAREHOUSE_DOOR); task.status = 'waiting'; task.reason = '仓库已满，余量留在门口';
      task.retryAt = this.state.seconds + C.retrySeconds;
    }
    this.changed();
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
  if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 3) throw new Error('不支持的存档版本');
  const raw = saved as EconomyState, state = initialEconomy();
  const number = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  if (!raw.inventory || !resources.every(k => number(raw.inventory[k], C.capacity[k]) && Number.isInteger(raw.inventory[k]))) throw new Error('库存存档无效');
  if (!Array.isArray(raw.plots) || raw.plots.length !== state.plots.length || !Array.isArray(raw.tasks) || raw.tasks.length > C.queueLimit + 12) throw new Error('作业存档无效');
  state.inventory = { ...raw.inventory };
  state.seconds = number(raw.seconds, 1e12) ? raw.seconds : 0;
  if (raw.steward) {
    if (typeof raw.steward.enabled !== 'boolean' || !number(raw.steward.nextDecision, 1e12)) throw new Error('管家存档无效');
    state.steward = { enabled: raw.steward.enabled, nextDecision: Math.min(raw.steward.nextDecision, state.seconds + .5), reason: '正在恢复经营' };
  }
  const validPoint = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= WORLD_BOUNDS.minX && p.x <= WORLD_BOUNDS.maxX && p.z >= WORLD_BOUNDS.minZ && p.z <= WORLD_BOUNDS.maxZ;
  if (raw.residents && typeof raw.residents === 'object') for (const [id, entry] of Object.entries(raw.residents)) {
    if (!['farmer', 'farmer-2', 'infantry', 'archer', 'cavalry', 'dog', 'base-human'].includes(id)) continue;
    if (!entry || !validPoint(entry.position) || entry.manualGoal && !validPoint(entry.manualGoal)) throw new Error('居民存档无效');
    state.residents[id] = { position: { ...entry.position }, manualGoal: entry.manualGoal && { ...entry.manualGoal } };
  }
  if (!Array.isArray(raw.goods) || raw.goods.some(g => !g || !/^goods-\d+$/.test(g.id) || !resources.includes(g.resource) || !Number.isSafeInteger(g.amount) || g.amount <= 0 || !validPoint(g) || g.crop !== undefined && !Object.hasOwn(C.crops, g.crop) || !['ground', 'transit'].includes(g.state))) throw new Error('运输存档无效');
  if (new Set(raw.goods.map(g => g.id)).size !== raw.goods.length) throw new Error('重复产出');
  state.goods = raw.goods.map(g => ({ ...g }));
  state.plots = state.plots.map(plot => {
    const value = raw.plots.find(p => p.id === plot.id);
    if (!value || typeof value.tilled !== 'boolean' || !number(value.growth, 1e6)
      || value.crop !== undefined && (!Object.hasOwn(C.crops, value.crop) || !value.tilled)) throw new Error('耕地存档无效');
    return { id: plot.id, tilled: value.tilled, crop: value.crop, harvests: number(value.harvests, 1e9) ? value.harvests : 0, lastCrop: value.lastCrop && Object.hasOwn(C.crops, value.lastCrop) ? value.lastCrop : undefined, growth: value.crop ? Math.min(value.growth, C.crops[value.crop].growthSeconds) : 0 };
  });
  if (!Array.isArray(raw.buildings)) throw new Error('建筑存档无效');
  const sites = raw.sites;
  if (!Array.isArray(sites) || sites.length > 100 || new Set(sites.map(s => s.id)).size !== sites.length) throw new Error('建筑位置存档无效');
  state.sites = sites.map(s => {
    if (!s || !/^site-\d+$/.test(s.id) || !Object.hasOwn(BUILDING_TYPES, s.kind) || !validPoint(s)) throw new Error('建筑位置存档无效');
    const canonical = buildingAt(s.kind, s, s.id);
    if (Math.abs(canonical.x - s.x) > 1e-6 || Math.abs(canonical.z - s.z) > 1e-6 || s.width !== canonical.width || s.depth !== canonical.depth || s.height !== canonical.height) throw new Error('建筑网格存档无效');
    return canonical;
  });
  state.nextSiteId = Math.max(-1, ...state.sites.map(s => Number(s.id.slice(5))), ...raw.tasks.filter(t => t.kind === 'build').map(t => Number(t.target.slice(5))).filter(Number.isSafeInteger), Number.isSafeInteger(raw.nextSiteId) ? raw.nextSiteId - 1 : -1) + 1;
  if (!Array.isArray(raw.depleted) || !raw.depleted.every(id => RESOURCE_NODES.some(n => n.id === id))
    || !raw.buildings.every(id => state.sites.some(s => s.id === id))) throw new Error('地图存档无效');
  state.depleted = [...new Set(raw.depleted)]; state.buildings = [...new Set(raw.buildings)];
  const ids = new Set<number>(), targets = new Set<string>(), carriers = new Set<string>();
  for (const task of raw.tasks) {
    if (!task || !Number.isSafeInteger(task.id) || task.id < 1 || ids.has(task.id) || !Object.hasOwn(C.workSeconds, task.kind)
      || !Object.hasOwn(STATUS_NAMES, task.status) || !number(task.progress, C.workSeconds[task.kind])
      || !matchesTarget(task.kind, task.target, state.sites, !pending(task))
      || task.kind === 'sow' && (task.crop === undefined || !Object.hasOwn(C.crops, task.crop))
      || task.status === 'storage' && (!['chop', 'mine', 'harvest'].includes(task.kind) || task.progress !== C.workSeconds[task.kind])) throw new Error('任务存档无效');
    if (task.status === 'delivering') {
      const goods = state.goods.find(g => g.id === task.target);
      if (task.kind !== 'haul' || !task.worker || !['farmer', 'farmer-2'].includes(task.worker) || carriers.has(task.worker)
        || !goods || goods.state !== 'transit' || goods.carrier !== task.worker) throw new Error('运输任务不一致');
      carriers.add(task.worker);
    }
    ids.add(task.id);
    if (pending(task)) { if (targets.has(task.target)) throw new Error('重复目标'); targets.add(task.target); }
    state.tasks.push({ id: task.id, kind: task.kind, target: task.target, crop: task.crop,
      status: task.status === 'travelling' || task.status === 'working' ? 'waiting' : task.status,
      worker: task.status === 'delivering' ? task.worker : undefined,
      origin: task.origin === 'steward' ? 'steward' : 'manual', progress: task.progress, reserved: false, reason: task.status === 'storage' ? '等待入库' : '', retryAt: number(task.retryAt, 1e12) ? task.retryAt : 0 });
  }
  for (const goods of state.goods) if (goods.state === 'transit' && !state.tasks.some(t => t.status === 'delivering' && t.target === goods.id && t.worker === goods.carrier)) throw new Error('在途资源缺少运输任务');
  state.nextId = Math.max(0, ...ids, ...state.goods.map(g => Number(g.id.slice(6))), Number.isSafeInteger(raw.nextId) ? raw.nextId - 1 : 0) + 1;
  // Re-establish reservations deterministically from actual inventory on resume.
  const economy = new Economy(state);
  for (const task of state.tasks) if (pending(task)) {
    const cost = economy.cost(task.kind), available = economy.available();
    task.reserved = resources.every(k => cost[k] <= available[k]);
  }
  return economy;
}
