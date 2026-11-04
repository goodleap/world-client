import { pathInDanger, decodeDangerZones } from './danger-zones.ts';
import type { DangerZone } from './danger-zones.ts';
import { TOWER_CONFIG, newTower, validateTowers } from './towers.ts';
import type { TowerState } from './towers.ts';
import { initialRaids, decodeRaids, allWolves } from './raid-state.ts';
import type { RaidState } from './raid-state.ts';
import { initialCombat, decodeCombat } from './combat.ts';
import type { CombatState } from './combat.ts';
import type { Point, Obstacle } from './movement.ts';
import { WAREHOUSE_DOOR, WORLD_BOUNDS, GRID_SIZE, LANDSCAPE } from './world-data.ts';
import { ECONOMY_CONFIG as C, FARM_PLOTS, RESOURCE_NODES, economyObstacles } from './economy-config.ts';
import { buildingAt, buildingDoor, placementReason, placementWarning, BUILDING_TYPES } from './construction.ts';
import type { BuildingSite, BuildingKind } from './construction.ts';
import { insidePolygon } from './polygon.ts';
import { planPaths } from './path-planner.ts';
import { canResidentWork, canResidentSupply } from './resident-data.ts';
import { initialRecruitment, decodeRecruitment, homeResidents, POPULATION_LIMIT, DOG_LIMIT } from './recruitment.ts';
import type { RecruitmentState } from './recruitment.ts';
import { initialGroups, GROUP_COUNT, GROUP_SIZE, pruneGroups } from './groups.ts';
import { CAMPFIRE_CONFIG as F, newCampfire, advanceCampfire } from './campfire.ts';
import type { Campfire } from './campfire.ts';
import { initialVitals, initialVital, alive, bodiesFor, needsFood, VITAL_CONFIG, maxHealth, vitalIds } from './vitals.ts';
import type { Vitals } from './vitals.ts';
import { BUILDINGS } from './world-data.ts';
import { buildingInfo, buildingList, buildingOperational, repairQuote, repairAmount, setBuildingHealth, validateBuildingHealth } from './building-state.ts';

export type Resource = 'wood' | 'stone' | 'food' | 'iron';
export type Inventory = Record<Resource, number>;
export type CropKind = keyof typeof C.crops;
export type WorkKind = keyof typeof C.workSeconds;
export type TaskStatus = 'waiting' | 'travelling' | 'working' | 'delivering' | 'storage' | 'done' | 'cancelled' | 'invalid';
export type TaskOrigin = 'manual' | 'steward' | 'continuation';
export interface FarmPlot extends Point { id: string; tilled: boolean; crop?: CropKind; growth: number; harvests?: number; lastCrop?: CropKind }
export interface WorkTask {
  id: number; kind: WorkKind; target: string; crop?: CropKind; status: TaskStatus;
  worker?: string; origin?: TaskOrigin;
  progress: number; reserved: boolean; reason: string; retryAt: number;
  resource?: 'wood' | 'food'; amount?: number; cargo?: string;
  repair?: {hp:number;cost:Inventory};
  watchPath?: Point[]; danger?: Record<string, never>;
  threat?: { source:string; point:Point; safeSince?:number };
}
export interface Goods extends Point { id: string; resource: Resource; amount: number; crop?: CropKind; state: 'ground' | 'transit'; carrier?: string; destination?: string }
export interface SavedResident { position: Point; manualGoal?: Point }
export interface EconomyState {
  recruitment: RecruitmentState; groups: string[][]; groupMoves:Record<string,{members:string[];center:Point;route:Point[]}>; towers:TowerState[];
  residents: Record<string, SavedResident>;
  steward: { enabled: boolean; nextDecision: number; reason: string };
  combat: CombatState; raids: RaidState;
  vitals: Vitals; campfires: Campfire[];
  buildingHealth:Record<string,number>; autoRepair: boolean; dangerZones: DangerZone[];
  version: 24; debug: boolean; upgrades: { tools: number; arms: number }; regrowth: Record<string, number>; sites: BuildingSite[]; nextSiteId: number; nextPlotId: number; goods: Goods[]; nextId: number; seconds: number; inventory: Inventory;
  plots: FarmPlot[]; depleted: string[]; buildings: string[]; tasks: WorkTask[];
}
export const RESOURCE_NAMES: Record<Resource, string> = { wood: '木材', stone: '石材', food: '粮食', iron: '铁矿' };
export const WORK_NAMES: Record<WorkKind, string> = { till: '开垦', sow: '播种', harvest: '收获', chop: '伐木', mine: '采矿', build: '建造', repair:'维修', demolish:'拆除', haul: '搬运', supply: '补给火堆', gather: '采集食物', tools: '加工工具', arms: '锻制装备' };
export const STATUS_NAMES: Record<TaskStatus, string> = { waiting: '等待', travelling: '前往', working: '作业中', delivering: '运送仓库', storage: '等待入库', done: '完成', cancelled: '已取消', invalid: '已失效' };
export const resources: Resource[] = ['wood', 'stone', 'food', 'iron'];
export const pending = (task: WorkTask) => !['done', 'cancelled', 'invalid'].includes(task.status);
export const queued = (task: WorkTask) => pending(task) && !(task.origin !== 'manual' && (task.danger||task.threat));
const emptyCost = (): Inventory => ({ wood: 0, stone: 0, food: 0, iron: 0 });
function matchesTarget(kind: WorkKind, target: string, sites: BuildingSite[], plots: FarmPlot[], terminal: boolean) {
  if(kind==='demolish')return sites.some(s=>s.id===target)||plots.some(p=>p.id===target)||terminal&&/^(site|plot)-\d+$/.test(target);
  if(kind==='repair')return BUILDINGS.some(b=>b.id===target)||sites.some(s=>s.id===target)||terminal&&/^site-\d+$/.test(target);
  if (kind === 'till' || kind === 'sow' || kind === 'harvest') return plots.some(p => p.id === target) || terminal && /^plot-\d+$/.test(target);
  if (kind === 'tools' || kind === 'arms') return target === 'warehouse' || sites.some(s => s.id === target && s.kind === 'warehouse') || terminal && /^site-\d+$/.test(target);
  if (kind === 'haul') return /^goods-\d+$/.test(target);
  if (kind === 'build' || kind === 'supply') return sites.some(s => s.id === target) || terminal && /^site-\d+$/.test(target);
  return RESOURCE_NODES.some(n => n.id === target && (kind === 'chop' ? n.kind === 'wood' : kind === 'gather' ? n.kind === 'food' : n.kind === 'stone' || n.kind === 'iron'));
}

export const DEBUG_RESOURCES = 100_000;
export const debugRequested = (search: string) => new URLSearchParams(search).has('debug');
export function initialEconomy(seed?: number, debug = false): EconomyState {
  return {
    towers: [], recruitment: initialRecruitment(), groups: initialGroups(), groupMoves:{}, combat: initialCombat(), raids: initialRaids(0, seed), vitals: initialVitals(), campfires: [], buildingHealth:{}, autoRepair:true, dangerZones:[], version: 24, debug, upgrades: { tools: 0, arms: 0 }, regrowth: {}, sites: [], nextSiteId: 0, nextPlotId: FARM_PLOTS.length, goods: [], residents: {}, steward: { enabled: true, nextDecision: 0, reason: '正在安排作业' }, nextId: 1, seconds: 0, inventory: debug ? { wood: DEBUG_RESOURCES, stone: DEBUG_RESOURCES, food: DEBUG_RESOURCES, iron: DEBUG_RESOURCES } : { ...C.initialInventory },
    plots: FARM_PLOTS.map((p, i) => ({ ...p, tilled: true, crop: i === 0 ? 'carrot' : i === 1 ? 'wheat' : undefined,
      growth: i === 0 ? C.crops.carrot.growthSeconds : 0 })),
    depleted: [], buildings: [], tasks: [],
  };
}

/** Gameplay state is independent of meshes, animation callbacks and frame rate. */
export class Economy {
  readonly state: EconomyState;
  revision = 0;
  private liveOccupants?: () => readonly Point[];
  private prepareDemolition:(id:string)=>boolean=id=>!this.state.towers.find(t=>t.id===id)?.unit;
  setDemolitionPreparation(prepare:(id:string)=>boolean){this.prepareDemolition=prepare;}
  setOccupancy(read: () => readonly Point[]) { this.liveOccupants = read; }
  constructor(state = initialEconomy(Math.floor(Math.random() * 0xffffffff) + 1)) { this.state = state; }
  setLeadership(enabled: boolean) {
    if (this.state.steward.enabled === enabled) return;
    this.state.steward.enabled = enabled;
    this.state.steward.nextDecision = 0;
    // Already accepted work and its delivery continue; this only controls
    // whether the leader may issue new orders to idle farmers.
    this.changed();
  }
  setAutoRepair(enabled: boolean) {
    if (this.state.autoRepair === enabled) return;
    this.state.autoRepair = enabled;
    this.arrangeRepairs(); this.changed();
  }
  arrangeRepairs() {
    if (!this.state.autoRepair) return;
    for (const b of buildingList(this.state)) {
      if (!b.built || b.hp >= b.maxHealth || this.taskFor(b.id) || pathInDanger(this.state.dangerZones, [b])) continue;
      this.request('repair', b.id, undefined, 'steward');
    }
  }
  taskPoint(task: WorkTask): Point | undefined {
    return this.plot(task.target) ?? RESOURCE_NODES.find(n=>n.id===task.target)
      ?? this.state.goods.find(g=>g.id===task.target) ?? this.state.sites.find(s=>s.id===task.target)
      ?? BUILDINGS.find(b=>b.id===task.target);
  }
  placeBuilding(kind: BuildingKind, point: Point, occupants: readonly Obstacle[] = []): { ok: boolean; message: string; warning?: string; task?: WorkTask } {
    if (!Object.hasOwn(BUILDING_TYPES, kind)) return { ok: false, message: '未知建筑类型' };
    const shortage = this.buildingShortage(kind);
    if (shortage) return { ok: false, message: shortage };
    const farm = kind === 'farm';
    if (farm ? this.state.plots.length >= 10000 : this.state.sites.length >= 100) return { ok: false, message: '已达到家园用地上限' };
    const site = buildingAt(kind, point, farm ? `plot-${this.state.nextPlotId}` : `site-${this.state.nextSiteId}`);
    const reason = placementReason(site, this.state, occupants);
    if (reason) return { ok: false, message: reason };
    const obstacles = economyObstacles(this.state.depleted, farm ? this.state.sites : [...this.state.sites, site], this.state.buildings);
    const access=planPaths(farm?site:buildingDoor(site),this.warehouseDoors(),.35,WORLD_BOUNDS,obstacles);
    // Unknown connectivity is not a failure and never blocks a manual build.
    // The assigned worker resumes its own background plan once it is ready.
    const warning = access===undefined ? '与仓库之间暂无通路，仍可建造' : placementWarning(site, this.state);
    if (farm) {
      this.state.plots.push({ id: site.id, x: site.x, z: site.z, tilled: false, growth: 0 });
      const result = this.request('till', site.id);
      if (result.ok) this.state.nextPlotId++;
      else this.state.plots.pop();
      return result.ok ? { ...result, warning } : result;
    }
    this.state.sites.push(site);
    const result = this.request('build', site.id);
    if (result.ok) this.state.nextSiteId++;
    else this.state.sites.pop();
    return result.ok ? { ...result, warning } : result;
  }
  demolition(id:string) {
    const site=this.state.sites.find(s=>s.id===id),plot=this.plot(id);
    if(!site&&!plot)return;
    const built=!!site&&this.state.buildings.includes(id),cost=site?this.cost('build',id):emptyCost();
    return {name:site?BUILDING_TYPES[site.kind].name:'耕地',built,refund:{wood:built?Math.floor(cost.wood/2):0,stone:built?Math.floor(cost.stone/2):0}};
  }
  demolish(id:string) {
    if(!this.demolition(id))return {ok:false,message:'此建筑不可拆除'};
    const existing=this.taskFor(id);
    if(existing?.kind==='demolish')return {ok:false,message:'已安排拆除'};
    if(this.state.tasks.filter(t=>queued(t)&&t.target!==id).length>=C.queueLimit)return {ok:false,message:'作业队列已满，请等待农民完成任务'};
    // Supersede the old work without removing an unfinished site/field. It must
    // remain solid until a farmer completes demolition, including after reload.
    for(const task of this.state.tasks)if(task.target===id&&pending(task)){
      this.dropCargo(task);this.releasePersonalSupply(task);
      task.status='cancelled';task.reserved=false;task.danger=undefined;task.reason='已改为拆除';
    }
    return this.request('demolish',id);
  }
  private removeBuilding(id:string,task:WorkTask) {
    const quote=this.demolition(id);if(!quote)return {ok:false,message:'此建筑不可拆除'};
    const site=this.state.sites.find(s=>s.id===id),point=site??this.plot(id)!;
    if(!this.prepareDemolition(id))return {ok:false,message:'入口被占用，等待弓兵安全撤出'};
    const fire=this.campfire(id);
    const refund:Partial<Inventory>={...quote.refund,food:fire?fire.food+fire.meals+(fire.cook>0?1:0):0};
    refund.wood!+=fire?.wood??0;
    task.status='done';task.reserved=false;task.reason='';
    for(const task of [...this.state.tasks])if(task.target===id&&pending(task)){
      // Completed production is already represented by independent ground goods.
      if(task.status==='storage'){task.status='cancelled';task.reserved=false;}
      else this.cancel(task.id);
    }
    this.state.tasks=this.state.tasks.filter(t=>t.target!==id||t===task);
    for(const v of Object.values(this.state.vitals))if(v.rest?.camp===id)v.rest=undefined;
    for(const g of this.state.goods)if(g.destination===id){g.destination=undefined;if(g.state==='transit'){g.state='ground';g.carrier=undefined;}}
    this.state.sites=this.state.sites.filter(s=>s.id!==id);this.state.plots=this.state.plots.filter(p=>p.id!==id);
    this.state.buildings=this.state.buildings.filter(b=>b!==id);this.state.campfires=this.state.campfires.filter(f=>f.id!==id);
    this.state.towers=this.state.towers.filter(t=>t.id!==id);delete this.state.buildingHealth[id];
    for(const u of [...this.state.combat.units,...allWolves(this.state.raids)]){
      if(u.commandTarget===id)u.commandTarget=undefined;
      if(u.target===id||u.attack?.target===id){u.target=undefined;u.attack=undefined;u.route=[];u.goal=undefined;u.speed=0;u.order=u.commandTarget?'attack':'guard';}
      if(u.deathTower===id){u.deathTower=undefined;u.deathElevation=0;}
    }
    this.state.combat.projectiles=this.state.combat.projectiles.filter(p=>p.target!==id);
    // Capacity may shrink: spill only the excess, never discard stored resources.
    const cap=this.capacity();for(const key of resources){const excess=Math.max(0,this.state.inventory[key]-cap[key]);this.state.inventory[key]-=excess;refund[key]=(refund[key]??0)+excess;}
    for(const t of this.state.tasks)t.reserved=false;
    for(const t of this.state.tasks)if(pending(t))this.reserve(t);
    this.dropReward(point,refund,false);this.changed();return {ok:true,message:'已拆除，返还物资留在地面等待搬运'};
  }
  regionLocked(point: Point) {
    const region = LANDSCAPE.regions.find(r => insidePolygon(point, r.area));
    return region && 'camp' in region && !this.state.combat.camps.find(c => c.id === region.camp)?.cleared ? `先清理${region.name}的守卫` : '';
  }
  /** One transaction with combat.rewardGranted; output uses normal hauling and capacity. */
  dropReward(point: Point, reward: Partial<Inventory>, spread = true) {
    const ids: string[] = [];
    for (const [i, resource] of resources.entries()) {
      if (!reward[resource]) continue;
      const id = `goods-${this.state.nextId++}`; ids.push(id);
      this.state.goods.push({ id, resource, amount: reward[resource]!,
        x: point.x + (spread ? i - 1 : 0), z: point.z, state: 'ground' });
    }
    this.changed(); return ids;
  }
  plot(id: string) { return this.state.plots.find(p => p.id === id); }
  campfire(id: string) { return this.state.campfires.find(f => f.id === id); }
  setFire(id: string, enabled: boolean) {
    const fire = this.campfire(id); if (!fire) return;
    if(enabled&&!buildingOperational(this.state,id))return;
    fire.enabled = enabled;
    const task = this.taskFor(id);
    if (!enabled && task?.kind === 'supply' && !task.cargo) this.cancel(task.id);
    this.changed();
  }
  setCooking(id: string, enabled: boolean) { const fire = this.campfire(id); if (fire) { fire.cooking = enabled; this.changed(); } }
  damageBuilding(id:string,damage:number){
    const b=buildingInfo(this.state,id);if(!b?.built||b.hp<=0)return;
    setBuildingHealth(this.state,id,b.hp-damage);
    if(b.hp<=damage){
      for(const task of [...this.state.tasks])if(task.target===id&&task.kind!=='repair'&&task.kind!=='demolish'&&pending(task))this.cancel(task.id);
      this.setFire(id,false);
    }
    this.changed();
  }
  warehouseDoors(): Point[] { return [...(buildingOperational(this.state,'warehouse')?[WAREHOUSE_DOOR]:[]), ...this.state.sites.filter(s => s.kind === 'warehouse' && this.state.buildings.includes(s.id)&&buildingOperational(this.state,s.id)).map(buildingDoor)]; }
  capacity(): Inventory {
    // Damage stops deliveries, not ownership of resources already stored.
    const count = 1+this.state.sites.filter(s=>s.kind==='warehouse'&&this.state.buildings.includes(s.id)).length;
    const capacity = (key: Resource) => C.capacity[key] * count + (this.state.debug ? DEBUG_RESOURCES : 0);
    return { wood: capacity('wood'), stone: capacity('stone'), food: capacity('food'), iron: capacity('iron') };
  }
  taskFor(target: string) { return this.state.tasks.find(t => (t.target === target || t.cargo === target) && pending(t)); }
  active(worker = 'farmer') { return this.state.tasks.find(t => (t.worker ?? 'farmer') === worker && (t.status === 'travelling' || t.status === 'working' || t.status === 'delivering')); }
  cost(kind: WorkKind, target?: string): Inventory {
    if(kind==='repair'){
      const quote=this.state.tasks.find(t=>t.kind==='repair'&&t.target===target&&pending(t))?.repair??repairQuote(this.state,target??'');
      return {...(quote?.cost??emptyCost())};
    }
    if (kind === 'tools' || kind === 'arms') return { ...C[kind === 'tools' ? 'toolsCost' : 'armsCost'] };
    if (kind === 'supply') {
      const task = this.state.tasks.find(t => t.kind === 'supply' && t.target === target && pending(t));
      return task?.resource && !task.cargo ? { ...emptyCost(), [task.resource]: task.amount! } : emptyCost();
    }
    const type = this.state.sites.find(s => s.id === target)?.kind;
    return kind === 'build' ? this.buildingCost(type ?? 'house') : emptyCost();
  }
  buildingCost(kind: BuildingKind): Inventory {
    return { ...emptyCost(), ...(kind === 'farm' ? {} : kind === 'tower' ? TOWER_CONFIG.cost : kind === 'campfire' ? F.cost : kind === 'warehouse' ? C.warehouseCost : C.houseCost) };
  }
  private shortage(cost: Inventory, available = this.available()) {
    const missing = resources.filter(key => cost[key] > available[key]);
    return missing.length ? '缺少' + missing.map(key => `${RESOURCE_NAMES[key]} ${cost[key] - available[key]}`).join('、') : '';
  }
  buildingShortage(kind: BuildingKind, available = this.available()) { return this.shortage(this.buildingCost(kind), available); }
  reserved(): Inventory {
    const sum = emptyCost();
    for (const task of this.state.tasks) if (pending(task) && task.reserved) {
      const cost = this.cost(task.kind, task.target); for (const key of resources) sum[key] += cost[key];
    }
    return sum;
  }
  available(): Inventory {
    const reserved = this.reserved();
    return { wood: this.state.inventory.wood - reserved.wood, stone: this.state.inventory.stone - reserved.stone, food: this.state.inventory.food - reserved.food, iron: this.state.inventory.iron - reserved.iron };
  }
  private invalidReason(kind: WorkKind, target: string, crop?: CropKind): string {
    if(kind==='demolish')return this.demolition(target)?'':'此建筑已不存在';
    if(kind==='repair'){const b=buildingInfo(this.state,target);return !b?.built?'建筑尚未建成或已倒塌':b.hp>=b.maxHealth?'建筑完好，无需维修':'';}
    if((kind==='tools'||kind==='arms'||kind==='supply')&&!buildingOperational(this.state,target))return '建筑已损毁，请先维修';
    if (kind === 'tools' || kind === 'arms') return target !== 'warehouse' && !this.state.sites.some(s => s.id === target && s.kind === 'warehouse' && this.state.buildings.includes(s.id)) ? '请在仓库加工' : this.state.upgrades[kind] >= C.upgradeLimit ? '本轮强化已完成' : '';
    if (kind === 'supply') return this.campfire(target) ? '' : '火堆尚未建成';
    if (kind === 'haul') return this.state.goods.some(g => g.id === target && g.amount > 0) ? '' : '资源已入库';
    const plot = this.plot(target);
    if (kind === 'till') return !plot ? '不是耕作地块' : plot.tilled ? '土地已经开垦' : '';
    if (kind === 'sow') return !plot?.tilled ? '请先开垦土地' : plot.crop ? '地里已有作物' : !crop || !Object.hasOwn(C.crops, crop) ? '请选择作物' : '';
    if (kind === 'harvest') return !plot?.crop ? '没有可收获的作物' : plot.growth < C.crops[plot.crop].growthSeconds ? '作物尚未成熟' : '';
    if (kind === 'chop' || kind === 'mine' || kind === 'gather') {
      const node = RESOURCE_NODES.find(n => n.id === target && (kind === 'chop' ? n.kind === 'wood' : kind === 'gather' ? n.kind === 'food' : n.kind === 'stone' || n.kind === 'iron'));
      return !node ? '没有对应的资源点' : this.state.depleted.includes(target) ? '资源正在恢复' : this.regionLocked(node);
    }
    if (kind === 'build') return !this.state.sites.some(s => s.id === target) ? '请选择建设用地' : this.state.buildings.includes(target) ? '此处已经建成' : '';
    return '未知任务';
  }
  private reserve(task: WorkTask) {
    if (task.reserved) return true;
    const cost = this.cost(task.kind, task.target), available = this.available();
    const missing = resources.filter(key => cost[key] > available[key]);
    if (missing.length) { task.reason = '缺少' + missing.map(key => `${RESOURCE_NAMES[key]} ${cost[key] - available[key]}`).join('、'); return false; }
    task.reserved = true; task.reason = ''; return true;
  }
  request(kind: WorkKind, target: string, crop?: CropKind, origin: TaskOrigin = 'manual', supply?: { resource: 'wood' | 'food'; amount: number }): { ok: boolean; message: string; task?: WorkTask } {
    if (kind === 'supply' && (!supply || !Number.isInteger(supply.amount) || supply.amount <= 0 || supply.amount > F.batch[supply.resource])) return { ok: false, message: '补给批量无效' };
    const invalid = this.invalidReason(kind, target, crop);
    if (invalid) return { ok: false, message: invalid };
    if (this.taskFor(target)) return { ok: false, message: '该目标已有任务' };
    if (kind === 'build') { const shortage = this.shortage(this.cost(kind, target)); if (shortage) return { ok: false, message: shortage }; }
    if (this.state.tasks.filter(queued).length >= C.queueLimit) return { ok: false, message: '作业队列已满，请等待农民完成任务' };
    const task: WorkTask = { ...supply, origin, id: this.state.nextId++, kind, target, crop: kind === 'sow' ? crop : undefined,
      status: 'waiting', progress: 0, reserved: false, reason: '', retryAt: 0 };
    if(kind==='repair')task.repair=repairQuote(this.state,target);
    const recent = new Set(this.state.tasks.filter(t => !pending(t)).slice(-11));
    this.state.tasks = this.state.tasks.filter(t => pending(t) || recent.has(t));
    this.state.tasks.push(task); this.reserve(task); this.changed();
    return { ok: true, message: task.reason ? `已排队，${task.reason}` : '已加入作业队列', task };
  }
  claim(worker = 'farmer', position?: Point, eligible: (task: WorkTask) => boolean = () => true): WorkTask | undefined {
    if (!this.state.vitals[worker] || !alive(this.state, worker)) return;
    if (this.active(worker)) return;
    const rank: Record<WorkKind, number> = { haul: 0, supply: 0, repair:0, demolish:0, harvest: 1, sow: 2, chop: 4, mine: 4, till: 3, build: 5, gather: 2, tools: 5, arms: 5 };
    // Expanding the fields must not leave requested construction permanently
    // unfunded while every farmer repeatedly harvests and replants food.
    const available = this.available(), needed = emptyCost();
    for (const task of this.state.tasks) if (pending(task) && task.kind === 'build' && !task.reserved) {
      const cost = this.cost(task.kind, task.target);
      for (const key of resources) needed[key] += cost[key];
    }
    const priority = (task: WorkTask) => task.kind === 'chop' && needed.wood > available.wood
      || task.kind === 'mine' && needed.stone > available.stone ? .5 : rank[task.kind];
    const distance = (t: WorkTask) => {
      const point = this.plot(t.target) ?? RESOURCE_NODES.find(n => n.id === t.target) ?? this.state.goods.find(g => g.id === t.target);
      return point && position ? Math.hypot(point.x - position.x, point.z - position.z) : 0;
    };
    const ordered = [...this.state.tasks].sort((a, b) => Number(a.origin === 'steward') - Number(b.origin === 'steward')
      || (a.origin === 'steward' ? priority(a) - priority(b) || distance(a) - distance(b) : 0) || a.id - b.id);
    for (const task of ordered) {
      if (!(task.kind === 'supply' ? canResidentSupply(worker) : canResidentWork(worker))) continue;
      if (task.threat || task.danger || task.status !== 'waiting' || task.retryAt > this.state.seconds) continue;
      if (!eligible(task)) continue;
      const destination = this.taskPoint(task);
      if (task.origin !== 'manual' && destination && pathInDanger(this.state.dangerZones, [destination])) {
        task.watchPath=[{x:destination.x,z:destination.z}]; this.holdDanger(task); continue;
      }
      const invalid = this.invalidReason(task.kind, task.target, task.crop);
      if (invalid) { task.status = 'invalid'; task.reason = invalid; task.reserved = false; this.changed(); continue; }
      const production = task.kind === 'chop' ? 'wood' : task.kind === 'mine' ? RESOURCE_NODES.find(n => n.id === task.target)?.kind
        : ['till', 'sow', 'harvest', 'gather'].includes(task.kind) ? 'food' : undefined;
      if (task.origin === 'steward' && production && this.state.inventory[production] >= this.capacity()[production]) {
        task.reason = `${RESOURCE_NAMES[production]}仓位已满，等待腾出空间`; continue;
      }
      if (task.kind === 'haul') {
        const goods = this.state.goods.find(g => g.id === task.target)!;
        if (this.state.inventory[goods.resource] >= this.capacity()[goods.resource]) { task.reason = '仓库已满，资源保留在地面'; continue; }
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
    this.releasePersonalSupply(task);
    task.worker = undefined; task.status = 'waiting'; task.reason = '等待恢复'; task.retryAt = 0; this.changed();
  }
  holdDanger(task:WorkTask,position?:Point){
    if(task.origin==='manual'||!pending(task)||task.status==='storage')return;
    this.defer(task.id,'危险，等待清场',position);task.danger={};task.retryAt=0;this.changed();
  }
  checkDanger(unsafe:(path:readonly Point[])=>boolean){
    let room = C.queueLimit - this.state.tasks.filter(queued).length;
    for(const task of this.state.tasks){
      if(!task.danger||!pending(task)||!task.watchPath?.length)continue;
      if(unsafe(task.watchPath) || room <= 0)continue;
      room--;
      task.danger=undefined;task.reason='';task.retryAt=0;this.changed();
    }
  }
  assign(id: number, worker = 'farmer', origin: TaskOrigin = 'manual'): { ok: boolean; message: string } {
    if (!this.state.vitals[worker] || !alive(this.state, worker)) return { ok: false, message: '该单位已经死亡' };
    const task = this.state.tasks.find(t => t.id === id);
    if (!task || !['waiting', 'travelling', 'working', 'delivering'].includes(task.status)) return { ok: false, message: '该作业暂不可执行' };
    if (!(task.kind === 'supply' ? canResidentSupply(worker) : canResidentWork(worker))) return { ok: false, message: '该单位不能执行这项作业' };
    if (task.worker && task.worker !== worker && task.status !== 'waiting') return { ok: false, message: '其他人物正在执行该任务' };
    const invalid = this.invalidReason(task.kind, task.target, task.crop);
    if (invalid) return { ok: false, message: invalid };
    if((task.danger||task.threat)&&origin!=='manual')return {ok:false,message:'危险，等待清场'};
    if (!this.reserve(task)) { this.changed(); return { ok: false, message: `已排队，${task.reason}` }; }
    if (this.active(worker)?.id !== id) this.interrupt(undefined, worker);
    task.worker = worker; task.origin = origin;
    if(origin==='manual'){task.danger=undefined;task.watchPath=undefined;task.threat=undefined;}
    if (task.status !== 'working' && task.status !== 'delivering') task.status = 'travelling';
    task.reason = ''; task.retryAt = 0; this.changed();
    return { ok: true, message: `优先${WORK_NAMES[task.kind]}` };
  }
  arrive(id: number) {
    const task = this.state.tasks.find(t => t.id === id);
    if (task?.status === 'delivering') { this.deliver(task); return; }
    if (task?.status !== 'travelling') return;
    if (task.kind === 'supply') {
      let goods = this.state.goods.find(g => g.id === task.cargo);
      if (!goods) {
        if (!task.resource || !task.amount || !this.reserve(task)) return;
        this.state.inventory[task.resource] -= task.amount;
        goods = { id: `goods-${this.state.nextId++}`, resource: task.resource, amount: task.amount, ...WAREHOUSE_DOOR, state: 'ground', destination: task.target };
        this.state.goods.push(goods); task.cargo = goods.id; task.reserved = false;
      }
      goods.state = 'transit'; goods.carrier = task.worker;
      task.status = 'delivering'; this.changed(); return;
    }
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
    this.releasePersonalSupply(task);
    task.worker = undefined; task.status = 'waiting'; task.reason = task.danger?'危险，等待清场':reason; task.retryAt = this.state.seconds + C.retrySeconds; this.changed();
  }
  pauseUnderAttack(task:WorkTask,source:string,position:Point) {
    this.defer(task.id,'受到攻击，等待安全',position);
    task.threat={source,point:{...position}};
    if(task.origin!=='manual'){task.watchPath??=[{...position}];task.danger={};}
    this.changed();
  }
  cancel(id: number, position?: Point): boolean {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task || !pending(task) || task.status === 'storage') return false;
    this.dropCargo(task, position);
    this.releasePersonalSupply(task);
    if (task.kind === 'till' && !this.plot(task.target)?.tilled) this.state.plots = this.state.plots.filter(p => p.id !== task.target);
    if (task.kind === 'build') this.state.sites = this.state.sites.filter(s => s.id !== task.target);
    task.status = 'cancelled'; task.threat=undefined; task.danger=undefined; task.reserved = false; task.reason = '已取消，预留材料已释放';
    if (task.kind === 'supply' && task.cargo) {
      const goods = this.state.goods.find(g => g.id === task.cargo);
      if (goods) { goods.destination = undefined; this.request('haul', goods.id, undefined, 'continuation'); }
    }
    this.changed(); return true;
  }
  /** One shared reservation/delivery per fire, including goods already en route. */
  requestFireSupply(id: string) {
    const fire = this.campfire(id);
    if (!fire?.enabled) return;
    const pending = this.taskFor(id); if (pending) return pending;
    for (const resource of ['wood', 'food'] as const) {
      if (resource === 'food' && !fire.cooking || fire[resource] > F.low[resource]) continue;
      const amount = Math.min(F.batch[resource], F.capacity[resource] - fire[resource], this.available()[resource]);
      if (amount > 0) return this.request('supply', id, undefined, 'continuation', { resource, amount }).task;
    }
  }
  /** Called only with active foreground elapsed time. Pause/resume supplies 0. */
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.state.seconds += seconds;
    for (const [id, at] of Object.entries(this.state.regrowth)) if (this.state.seconds >= at) {
      const node = RESOURCE_NODES.find(n => n.id === id)!;
      const occupied = this.state.sites.some(s => Math.abs(s.x - node.x) < s.width / 2 + node.radius + 1 && Math.abs(s.z - node.z) < s.depth / 2 + node.radius + 1)
        || this.state.plots.some(p => Math.abs(p.x - node.x) < GRID_SIZE / 2 + node.radius + 1 && Math.abs(p.z - node.z) < GRID_SIZE / 2 + node.radius + 1)
        || [...(this.liveOccupants?.() ?? []), ...Object.values(this.state.residents).map(r => r.position), ...this.state.combat.units.filter(u => u.life !== 'defeated').map(u => u.position)]
          .some(p => Math.hypot(p.x - node.x, p.z - node.z) < node.radius + 2);
      if (occupied) { this.state.regrowth[id] = this.state.seconds + 10; continue; }
      this.state.depleted = this.state.depleted.filter(n => n !== id); delete this.state.regrowth[id]; this.changed();
    }
    for (const fire of this.state.campfires) {
      const demand = Object.entries(this.state.vitals).filter(([, v]) => v.rest?.camp === fire.id)
        .flatMap(([id]) => bodiesFor(id)).filter(id => needsFood(this.state, id, VITAL_CONFIG.stopAt) && !this.state.vitals[id].meal).length;
      const before = `${fire.wood}/${fire.food}/${fire.meals}/${fire.cook > 0}`;
      advanceCampfire(fire, seconds, demand);
      if (before !== `${fire.wood}/${fire.food}/${fire.meals}/${fire.cook > 0}`) this.changed();
      this.requestFireSupply(fire.id);
    }
    for (const goods of this.state.goods) {
      if (this.state.combat.rewardGoods.includes(goods.id) && goods.state === 'ground' && !this.taskFor(goods.id)) this.request('haul', goods.id, undefined, 'continuation');
    }
    for (const plot of this.state.plots) if (plot.crop && plot.growth < C.crops[plot.crop].growthSeconds) {
      const previous = Math.floor(plot.growth / C.crops[plot.crop].growthSeconds * 3);
      plot.growth = Math.min(C.crops[plot.crop].growthSeconds, plot.growth + seconds);
      if (Math.floor(plot.growth / C.crops[plot.crop].growthSeconds * 3) !== previous) this.changed();
    }
    for (const task of this.state.tasks) if (task.status === 'working') {
      task.progress = Math.min(C.workSeconds[task.kind], task.progress + seconds * (['chop', 'mine', 'gather', 'harvest', 'till', 'build'].includes(task.kind) ? 1 + this.state.upgrades.tools * .25 : 1));
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
    if(task.kind==='demolish'){
      const result=this.removeBuilding(task.target,task);
      if(!result.ok&&task.reason!==result.message){task.reason=result.message;this.changed();}
      return;
    }
    const output = emptyCost(), plot = this.plot(task.target);
    if (task.kind === 'harvest' && plot?.crop) output.food = C.crops[plot.crop].yield;
    if (task.kind === 'chop' || task.kind === 'mine' || task.kind === 'gather') {
      const node = RESOURCE_NODES.find(n => n.id === task.target)!; output[node.kind] = node.yield;
    }
    const cost = this.cost(task.kind, task.target);
    // All validation happens before this single settlement. No animation event
    // can grant output, and a terminal task cannot settle a second time.
    for (const key of resources) this.state.inventory[key] -= cost[key];
    if (task.kind === 'till') plot!.tilled = true;
    if (task.kind === 'sow') { plot!.crop = task.crop; plot!.growth = 0; }
    if (task.kind === 'harvest') {
      plot!.lastCrop = plot!.crop; plot!.harvests = (plot!.harvests ?? 0) + 1;
      plot!.crop = undefined; plot!.growth = 0;
    }
    if (task.kind === 'chop' || task.kind === 'mine' || task.kind === 'gather') { this.state.depleted.push(task.target); this.state.regrowth[task.target] = this.state.seconds + RESOURCE_NODES.find(n => n.id === task.target)!.renew; }
    if (task.kind === 'tools' || task.kind === 'arms') this.state.upgrades[task.kind]++;
    if(task.kind==='repair'){const b=buildingInfo(this.state,task.target)!;setBuildingHealth(this.state,task.target,b.hp+task.repair!.hp);}
    if (task.kind === 'build') {
      this.state.buildings.push(task.target);
      const built=this.state.sites.find(s=>s.id===task.target)!;if(built.kind==='tower')this.state.towers.push(newTower(built));
      if (this.state.sites.find(s => s.id === task.target)?.kind === 'campfire') this.state.campfires.push(newCampfire(task.target));
    }
    task.status = 'done'; task.reserved = false; task.reason = ''; this.changed();
    for (const resource of resources) if (output[resource]) {
      const point = this.plot(task.target) ?? RESOURCE_NODES.find(n => n.id === task.target)!;
      const goods: Goods = { id: `goods-${task.id}`, resource, amount: output[resource], crop: task.kind === 'harvest' ? plot!.lastCrop : undefined, x: point.x, z: point.z, state: 'ground' };
      this.state.goods.push(goods);
      // Finishing production frees its queue slot. Its actual output gets one
      // delivery task, reserved immediately for the producer before another
      // idle worker can take it. This works with leadership switched off too.
      const haul = this.request('haul', goods.id, undefined, task.origin==='manual'?'manual':'continuation').task!;
      if (task.worker && this.state.inventory[resource] < this.capacity()[resource]) {
        haul.worker = task.worker; haul.status = 'travelling';
      }
    }
  }
  private releasePersonalSupply(task: WorkTask) {
    for (const v of Object.values(this.state.vitals)) if (v.rest?.supply === task.id) { v.rest.supply = undefined; v.rest.supplyGoal = undefined; }
  }
  private dropCargo(task: WorkTask, position?: Point) {
    const goods = this.state.goods.find(g => g.id === (task.cargo ?? task.target));
    if (goods?.state === 'transit') {
      if (position) { goods.x = position.x; goods.z = position.z; }
      goods.state = 'ground'; goods.carrier = undefined;
    }
  }
  updateCargo(position: Point, carrier = 'farmer') {
    for (const goods of this.state.goods) if (goods.carrier === carrier) { goods.x = position.x; goods.z = position.z; }
  }
  private deliver(task: WorkTask) {
    const goods = this.state.goods.find(g => g.id === (task.cargo ?? task.target));
    if (!goods || goods.state !== 'transit') return;
    if (task.kind === 'supply') {
      const fire = this.campfire(task.target), resource = task.resource!; if (!fire) return;
      const amount = Math.min(goods.amount, F.capacity[resource] - fire[resource]);
      fire[resource] += amount; goods.amount -= amount;
      if (!goods.amount) { this.state.goods = this.state.goods.filter(g => g !== goods); task.status = 'done'; task.reserved = false; }
      else { this.dropCargo(task); task.status = 'waiting'; task.reason = '火堆库存已满'; task.retryAt = this.state.seconds + C.retrySeconds; }
      this.changed(); return;
    }
    if(!this.warehouseDoors().length){this.dropCargo(task);task.status='waiting';task.reason='仓库已损毁，等待维修';task.retryAt=this.state.seconds+C.retrySeconds;this.changed();return;}
    const amount = Math.min(goods.amount, this.capacity()[goods.resource] - this.state.inventory[goods.resource]);
    this.state.inventory[goods.resource] += amount; goods.amount -= amount;
    if (!goods.amount) {
      this.state.goods = this.state.goods.filter(g => g !== goods);
      task.status = 'done'; task.reserved = false; task.reason = '';
    } else {
      this.dropCargo(task); task.status = 'waiting'; task.reason = '仓库已满，余量留在门口';
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
  if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 24) throw new Error('不支持的存档版本');
  const raw = saved as EconomyState, state = initialEconomy();
  const number = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  if (typeof raw.debug !== 'boolean') throw new Error('调试存档无效');
  state.debug = raw.debug;
  if (!raw.inventory || !resources.every(k => number(raw.inventory[k], C.capacity[k] * 101 + (raw.debug ? DEBUG_RESOURCES : 0)) && Number.isInteger(raw.inventory[k]))) throw new Error('库存存档无效');
  if (!Array.isArray(raw.plots) || raw.plots.length > 10000 || new Set(raw.plots.map(p => p.id)).size !== raw.plots.length || !Array.isArray(raw.tasks) || raw.tasks.length > C.queueLimit + 12 + 10000) throw new Error('作业存档无效');
  // Explicitly taking over held work may briefly exceed the new-order limit.
  if (raw.tasks.filter(t => !pending(t)).length > 12) throw new Error('作业队列超出上限');
  if (!number(raw.seconds, 1e12)) throw new Error('游戏时间无效');
  state.recruitment=decodeRecruitment(raw.recruitment);
  const residents=homeResidents(state),residentIds=new Set(residents.map(r=>r.id));
  if(!Array.isArray(raw.groups)||raw.groups.length!==GROUP_COUNT||raw.groups.some(g=>!Array.isArray(g)||g.length>GROUP_SIZE||g.some(id=>!residentIds.has(id)))
    ||new Set(raw.groups.flat()).size!==raw.groups.flat().length)throw new Error('编队存档无效');
  state.groups=raw.groups.map(g=>[...g]);
  const structures=[...BUILDINGS,...(Array.isArray(raw.sites)?raw.sites.filter(s=>s&&s.kind!=='farm'):[])];
  state.raids = decodeRaids(raw.raids, raw.combat?.nextAttack,residents,structures.map(s=>s.id));
  state.towers=structuredClone(raw.towers);
  state.combat = decodeCombat(raw.combat, allWolves(state.raids),residents,structures);
  const raiderIds=state.combat.units.filter(u=>u.id.startsWith('enemy-raid-')).map(u=>u.id);
  if(raiderIds.length!==state.raids.soldiers.length||raiderIds.some(id=>!state.raids.soldiers.includes(id))
    ||state.raids.phase==='peace'&&state.combat.units.some(u=>raiderIds.includes(u.id)&&u.life==='active'&&!u.departed))throw new Error('敌袭编队存档不一致');
  const currentVitalIds=[...new Set([...vitalIds,...state.recruitment.roster.flatMap(r=>bodiesFor(r.id)),...state.combat.units.map(u=>u.id)])];
  for(const id of currentVitalIds)state.vitals[id]=initialVital(id);
  if ([...state.combat.units, ...allWolves(state.raids)].some(u => u.diedAt !== undefined && u.diedAt > raw.seconds)) throw new Error('死亡时间超出游戏时间');
  if (!raw.upgrades || !['tools', 'arms'].every(k => Number.isInteger(raw.upgrades[k as 'tools']) && number(raw.upgrades[k as 'tools'], C.upgradeLimit))) throw new Error('加工存档无效');
  state.upgrades = { ...raw.upgrades };
  if (!raw.regrowth || Object.entries(raw.regrowth).some(([id, at]) => !RESOURCE_NODES.some(n => n.id === id) || !raw.depleted.includes(id) || !number(at, 1e12))) throw new Error('资源恢复存档无效');
  state.regrowth = { ...raw.regrowth };
  state.inventory = { ...raw.inventory };
  state.seconds = raw.seconds;
  if (typeof raw.autoRepair !== 'boolean') throw new Error('自动维修存档无效');
  state.autoRepair = raw.autoRepair; state.dangerZones = decodeDangerZones(raw.dangerZones, state.seconds);
  if (raw.steward) {
    if (typeof raw.steward.enabled !== 'boolean' || !number(raw.steward.nextDecision, 1e12)) throw new Error('领头调度存档无效');
    state.steward = { enabled: raw.steward.enabled, nextDecision: Math.min(raw.steward.nextDecision, state.seconds + .5), reason: '正在恢复经营' };
  }
  const validPoint = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= WORLD_BOUNDS.minX && p.x <= WORLD_BOUNDS.maxX && p.z >= WORLD_BOUNDS.minZ && p.z <= WORLD_BOUNDS.maxZ;
  if(!raw.groupMoves||typeof raw.groupMoves!=='object'||Object.keys(raw.groupMoves).length>GROUP_COUNT)throw new Error('编队目标无效');
  for(const [key,order] of Object.entries(raw.groupMoves)){
    if(!/^[0-3]$/.test(key)||!order||!validPoint(order.center)||!Array.isArray(order.members)||order.members.length>GROUP_SIZE
      ||order.members.some(id=>!residentIds.has(id))||!Array.isArray(order.route)||!order.route.length||order.route.length>512||order.route.some(p=>!validPoint(p))
      ||Math.hypot(order.route.at(-1)!.x-order.center.x,order.route.at(-1)!.z-order.center.z)>.001)throw new Error('编队目标无效');
    state.groupMoves[key]=structuredClone(order);
  }
  if (raw.residents && typeof raw.residents === 'object') for (const [id, entry] of Object.entries(raw.residents)) {
    if (!residentIds.has(id)) continue;
    if (!entry || !validPoint(entry.position) || entry.manualGoal && !validPoint(entry.manualGoal)) throw new Error('居民存档无效');
    state.residents[id] = { position: { ...entry.position }, manualGoal: entry.manualGoal && { ...entry.manualGoal } };
  }
  if (!Array.isArray(raw.goods) || raw.goods.some(g => !g || !/^goods-\d+$/.test(g.id) || !resources.includes(g.resource) || !Number.isSafeInteger(g.amount) || g.amount <= 0 || !validPoint(g) || g.crop !== undefined && !Object.hasOwn(C.crops, g.crop) || !['ground', 'transit'].includes(g.state))) throw new Error('运输存档无效');
  if (new Set(raw.goods.map(g => g.id)).size !== raw.goods.length) throw new Error('重复产出');
  state.goods = raw.goods.map(g => ({ ...g }));
  const cells = new Set<string>();
  state.plots = raw.plots.map(value => {
    if (!value || !/^plot-\d+$/.test(value.id) || !validPoint(value) || typeof value.tilled !== 'boolean' || !number(value.growth, 1e6)
      || value.crop !== undefined && (!Object.hasOwn(C.crops, value.crop) || !value.tilled)) throw new Error('耕地存档无效');
    const canonical = buildingAt('farm', value), cell = `${Math.round((canonical.x - GRID_SIZE / 2) / GRID_SIZE)},${Math.round((canonical.z - GRID_SIZE / 2) / GRID_SIZE)}`;
    if (Math.abs(canonical.x - value.x) > 1e-6 || Math.abs(canonical.z - value.z) > 1e-6 || cells.has(cell)) throw new Error('耕地网格存档无效');
    cells.add(cell);
    return { id: value.id, x: canonical.x, z: canonical.z, tilled: value.tilled, crop: value.crop,
      harvests: number(value.harvests, 1e9) ? value.harvests : 0,
      lastCrop: value.lastCrop && Object.hasOwn(C.crops, value.lastCrop) ? value.lastCrop : undefined,
      growth: value.crop ? Math.min(value.growth, C.crops[value.crop].growthSeconds) : 0 };
  });
  state.nextPlotId = Math.max(-1, ...state.plots.map(p => Number(p.id.slice(5))),
    ...raw.tasks.filter(t => /^plot-\d+$/.test(t.target)).map(t => Number(t.target.slice(5))),
    Number.isSafeInteger(raw.nextPlotId) ? raw.nextPlotId - 1 : -1) + 1;
  if (!Array.isArray(raw.buildings)) throw new Error('建筑存档无效');
  const sites = raw.sites;
  if (!Array.isArray(sites) || sites.length > 100 || new Set(sites.map(s => s.id)).size !== sites.length) throw new Error('建筑位置存档无效');
  state.sites = sites.map(s => {
    if (!s || !/^site-\d+$/.test(s.id) || !Object.hasOwn(BUILDING_TYPES, s.kind) || s.kind === 'farm' || !validPoint(s)) throw new Error('建筑位置存档无效');
    const canonical = buildingAt(s.kind, s, s.id);
    if (Math.abs(canonical.x - s.x) > 1e-6 || Math.abs(canonical.z - s.z) > 1e-6 || s.width !== canonical.width || s.depth !== canonical.depth || s.height !== canonical.height) throw new Error('建筑网格存档无效');
    return canonical;
  });
  state.nextSiteId = Math.max(-1, ...state.sites.map(s => Number(s.id.slice(5))), ...raw.tasks.filter(t => t.kind === 'build').map(t => Number(t.target.slice(5))).filter(Number.isSafeInteger), Number.isSafeInteger(raw.nextSiteId) ? raw.nextSiteId - 1 : -1) + 1;
  if (!Array.isArray(raw.depleted) || !raw.depleted.every(id => RESOURCE_NODES.some(n => n.id === id))
    || !raw.buildings.every(id => state.sites.some(s => s.id === id))) throw new Error('地图存档无效');
  state.depleted = [...new Set(raw.depleted)]; state.buildings = [...new Set(raw.buildings)];
  validateBuildingHealth(state,raw.buildingHealth);
  const fireSites = state.sites.filter(s => s.kind === 'campfire' && state.buildings.includes(s.id));
  if (!Array.isArray(raw.campfires) || raw.campfires.length !== fireSites.length || new Set(raw.campfires.map(f => f.id)).size !== raw.campfires.length) throw new Error('火堆存档无效');
  state.campfires = raw.campfires.map(f => {
    if (!f || !fireSites.some(s => s.id === f.id) || typeof f.enabled !== 'boolean' || typeof f.cooking !== 'boolean'
      || !number(f.wood, F.capacity.wood) || !Number.isInteger(f.wood) || !number(f.food, F.capacity.food) || !Number.isInteger(f.food)
      || !number(f.fuel, F.fuelSeconds) || !number(f.cook, F.cookSeconds) || !number(f.meals, F.mealCapacity) || !Number.isInteger(f.meals)) throw new Error('火堆存档无效');
    return { ...f };
  });
  if (!raw.vitals || Object.keys(raw.vitals).length !== currentVitalIds.length) throw new Error('生命体力存档无效');
  for (const id of currentVitalIds) {
    const v = raw.vitals[id], template = state.vitals[id];
    if (!v || !number(v.stamina, 100) || !number(v.manualUntil, 1e12) || !number(v.retryAt, 1e12) || !number(v.hurtUntil, 1e12)
      || v.lastAttack && (typeof v.lastAttack.source!=='string'||v.lastAttack.source.length>100||!number(v.lastAttack.at,raw.seconds))
      || v.diedAt !== undefined && (!number(v.diedAt, raw.seconds) || v.hp !== 0)
      || v.hp === 0 && v.diedAt === undefined
      || (template.hp === undefined ? v.hp !== undefined : !number(v.hp, maxHealth(id)))
      || v.meal && (!number(v.meal.remaining, VITAL_CONFIG.mealSeconds) || v.meal.remaining <= 0)
      || v.rest && (!state.campfires.some(f => f.id === v.rest!.camp) || !validPoint(v.rest.goal) || !residentIds.has(id)
        || v.rest.supply !== undefined && (!Number.isSafeInteger(v.rest.supply) || v.rest.supply < 1 || !canResidentSupply(id))
        || v.rest.supplyGoal && (!validPoint(v.rest.supplyGoal) || v.rest.supply === undefined))) throw new Error('生命体力存档无效');
    state.vitals[id] = structuredClone(v);
  }
  for(const dog of [true,false]){
    const count=residents.filter(r=>(r.role==='dog')===dog&&alive(state,r.id)).length+state.recruitment.queue.filter(q=>(q.role==='dog')===dog).length;
    if(count>(dog?DOG_LIMIT:POPULATION_LIMIT))throw new Error('招募名额存档无效');
  }
  validateTowers(state);
  const ids = new Set<number>(), targets = new Set<string>(), carriers = new Set<string>();
  for (const task of raw.tasks) {
    if (!task || task.worker !== undefined && !residentIds.has(task.worker) || !Number.isSafeInteger(task.id) || task.id < 1 || ids.has(task.id) || !Object.hasOwn(C.workSeconds, task.kind)
      || !Object.hasOwn(STATUS_NAMES, task.status) || !number(task.progress, C.workSeconds[task.kind])
      || !matchesTarget(task.kind, task.target, state.sites, state.plots, !pending(task))
      || task.kind === 'sow' && (task.crop === undefined || !Object.hasOwn(C.crops, task.crop))
      || task.status === 'storage' && (!['chop', 'mine', 'harvest', 'gather'].includes(task.kind) || task.progress !== C.workSeconds[task.kind])) throw new Error('任务存档无效');
    if(task.watchPath&&(!Array.isArray(task.watchPath)||!task.watchPath.length||task.watchPath.length>2048||task.watchPath.some(p=>!validPoint(p)))
      ||task.danger&&(task.origin==='manual'||!task.watchPath?.length||pending(task)&&task.status!=='waiting'||typeof task.danger!=='object'||Array.isArray(task.danger)||Object.keys(task.danger).length>0))throw new Error('危险作业存档无效');
    if(task.threat&&(typeof task.threat.source!=='string'||task.threat.source.length>100||!validPoint(task.threat.point)||task.threat.safeSince!==undefined&&!number(task.threat.safeSince,raw.seconds)))throw new Error('受击暂停存档无效');
    if(task.kind==='repair'){
      const b=buildingInfo(state,task.target),q=task.repair;
      if(!b?.built||!q||!number(q.hp,b.maxHealth)||q.hp<=0||!q.cost
        ||resources.some(key=>q.cost[key]!==repairAmount(b.kind,q.hp).cost[key]))throw new Error('维修存档无效');
    }else if(task.repair!==undefined)throw new Error('维修存档无效');
    if (task.status === 'delivering') {
      const goods = state.goods.find(g => g.id === (task.cargo ?? task.target));
      if (!['haul', 'supply'].includes(task.kind) || !task.worker || !(task.kind === 'supply' ? canResidentSupply(task.worker) : canResidentWork(task.worker)) || carriers.has(task.worker)
        || !goods || goods.state !== 'transit' || goods.carrier !== task.worker) throw new Error('运输任务不一致');
      carriers.add(task.worker);
    }
    const personalSupply = task.kind === 'supply' && task.worker && state.vitals[task.worker]?.rest?.supply === task.id;
    const resumingPickup = task.status === 'travelling' && !!task.worker && (task.kind === 'haul' && (task.origin === 'manual' || task.origin === 'continuation') || personalSupply);
    if (task.kind === 'supply' && (!task.resource || !['wood', 'food'].includes(task.resource) || !Number.isInteger(task.amount) || !number(task.amount, F.batch[task.resource]) || !task.amount
      || pending(task) && (!state.campfires.some(f => f.id === task.target) || task.cargo && !state.goods.some(g => g.id === task.cargo && g.destination === task.target && g.resource === task.resource && g.amount <= task.amount!)))) throw new Error('补给存档无效');
    if (resumingPickup) {
      if (carriers.has(task.worker!) || (personalSupply ? !canResidentSupply(task.worker!) : !canResidentWork(task.worker!) || !state.goods.some(g => g.id === task.target && g.state === 'ground'))) throw new Error('运输任务不一致');
      carriers.add(task.worker!);
    }
    ids.add(task.id);
    if (pending(task)) { if (targets.has(task.target)) throw new Error('重复目标'); targets.add(task.target); }
    state.tasks.push({ id: task.id, kind: task.kind, target: task.target, crop: task.crop,
      threat:pending(task)&&task.threat?structuredClone(task.threat):undefined,repair:task.repair&&structuredClone(task.repair),watchPath:task.watchPath&&structuredClone(task.watchPath),danger:pending(task)&&task.danger?{...task.danger}:undefined,
      resource: task.resource, amount: task.amount, cargo: task.cargo,
      status: task.status === 'travelling' && !resumingPickup || task.status === 'working' ? 'waiting' : task.status,
      worker: task.status === 'delivering' || resumingPickup ? task.worker : undefined,
      origin: task.origin === 'steward' || task.origin === 'continuation' ? task.origin : 'manual', progress: task.progress, reserved: false, reason: task.threat?'受到攻击，等待安全':task.danger?'危险，等待清场':task.status === 'storage' ? '等待入库' : '', retryAt: number(task.retryAt, 1e12) ? task.retryAt : 0 });
  }
  for (const goods of state.goods) {
    if (goods.destination && !state.tasks.some(t => pending(t) && t.kind === 'supply' && t.cargo === goods.id && t.target === goods.destination)) throw new Error('补给物资缺少配送任务');
    if (goods.state === 'transit' && !state.tasks.some(t => t.status === 'delivering' && (t.cargo ?? t.target) === goods.id && t.worker === goods.carrier)) throw new Error('在途资源缺少运输任务');
  }
  for (const [id, vital] of Object.entries(state.vitals)) if (vital.rest?.supply !== undefined
    && !state.tasks.some(t => t.id === vital.rest!.supply && t.kind === 'supply' && t.target === vital.rest!.camp && pending(t)
      && (!t.worker || t.worker === id))) throw new Error('进食补给任务不一致');
  state.nextId = Math.max(0, ...ids, ...state.goods.map(g => Number(g.id.slice(6))), Number.isSafeInteger(raw.nextId) ? raw.nextId - 1 : 0) + 1;
  // Re-establish reservations deterministically from actual inventory on resume.
  const economy = new Economy(state);
  if (resources.some(k => state.inventory[k] > economy.capacity()[k])) throw new Error('库存超过仓库容量');
  for (const task of state.tasks) if (pending(task)) {
    const cost = economy.cost(task.kind, task.target), available = economy.available();
    task.reserved = resources.every(k => cost[k] <= available[k]);
  }
  for (const u of state.combat.units.filter(u => u.life === 'defeated')) {
    economy.interrupt(u.position, u.id);
    for (const id of bodiesFor(u.id)) {
      state.vitals[id].rest = undefined; state.vitals[id].meal = undefined;
    }
    if (state.residents[u.id]) state.residents[u.id].manualGoal = undefined;
  }
  for (const r of residents) if (state.vitals[r.id].hp === 0) {
    if (r.effects?.includes('leader')) state.steward.enabled = false;
    economy.interrupt(state.residents[r.id]?.position ?? r.spawn, r.id);
    state.vitals[r.id].rest = undefined; state.vitals[r.id].meal = undefined;
    if (state.residents[r.id]) state.residents[r.id].manualGoal = undefined;
    delete state.raids.evading[r.id];
  }
  pruneGroups(economy);return economy;
}
