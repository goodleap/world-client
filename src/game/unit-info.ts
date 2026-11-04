import { assignedTower } from './towers.ts';
import { WORK_NAMES } from './economy.ts';
import type { Economy, EconomyState } from './economy.ts';
import { effectiveFighterStats } from './combat.ts';
import type { Fighter } from './combat.ts';
import { experienceProgress } from './unit-progression.ts';
import { ENEMIES, unitRole } from './resident-data.ts';
import { homeResidents } from './recruitment.ts';
import { bodiesFor, health, maxHealth, VITAL_CONFIG } from './vitals.ts';
import { allWolves } from './raid-state.ts';

export interface UnitMeter { id: string; label: string; value: number; maximum: number; kind: 'health' | 'stamina' }
export interface UnitInfo { id: string; activity: string; meters: UnitMeter[]; progression?:ReturnType<typeof experienceProgress>; attack?:number; armor?:number; enemy?:boolean }
export interface UnitMovement { moving: boolean; speed: number; working: boolean }

/** Read authoritative gameplay state. Selecting/inspecting never creates a task,
 * consumes a meal or changes an order. Mounted bodies keep separate vitals. */
export function selectedUnitInfo(economy: Economy, id: string | undefined, movement?: UnitMovement): UnitInfo | undefined {
  if (!id || !homeResidents(economy.state).some(r => r.id === id)) return;
  const state = economy.state, fighter = state.combat.units.find(u => u.id === id);
  if (health(state, id) <= 0) return;
  const vital = state.vitals[id], task = economy.active(id), bodies = bodiesFor(id);
  const moving = fighter ? fighter.speed > .08 || fighter.route.length > 0 : !!movement?.moving || (movement?.speed ?? 0) > .08;
  let activity = '空闲';
  const tower=assignedTower(state,id);
  if(tower?.phase==='occupied')activity=fighter?.target?'塔上射击':'塔上驻守';
  else if(tower?.phase==='approach')activity='前往哨塔';
  else if (state.raids.evading[id]) activity = '正在避险';
  else if (fighter?.attack || fighter?.target) activity = '正在战斗';
  else if (vital.rest && !moving && bodies.some(body => !!state.vitals[body].meal)) activity = '正在进食';
  else if (task?.status === 'delivering') activity = task.kind === 'supply' ? '运送补给' : '搬运入库';
  else if (task?.kind === 'haul' || task?.kind === 'supply') activity = moving ? '前往取货' : '等待搬运';
  else if (vital.rest) activity = moving ? '前往火堆' : '等待供餐';
  else if (task?.status === 'working') activity = ({gather:'正在采集',supply:'运送补给',tools:'加工工具',arms:'锻制装备'} as Partial<Record<typeof task.kind,string>>)[task.kind] ?? `正在${WORK_NAMES[task.kind]}`;
  else if (task?.status === 'travelling') activity = '前往作业';
  else if (task?.status === 'waiting') activity = '等待作业';
  else if (moving) activity = fighter?.order === 'move' || movement?.moving ? '正在移动' : '闲逛';
  // The compact card shows the selected person only; mount needs still inform
  // activity and remain independent in gameplay and saves.
  const prefix = unitRole(id) === 'cavalry' ? '骑手' : '';
  const meters: UnitMeter[] = [
    { id: id + '-health', label: prefix + '生命', value: health(state, id), maximum: maxHealth(id, state), kind: 'health' },
    { id: id + '-stamina', label: prefix + '体力', value: vital.stamina, maximum: VITAL_CONFIG.maxStamina, kind: 'stamina' },
  ];
  const stats=fighter&&effectiveFighterStats(fighter,state.upgrades.arms);
  return { id, activity, meters, ...(fighter?{progression:experienceProgress(fighter.experience)}:{}), attack:stats?.attack,armor:stats?.armor??0 };
}

export function enemyUnitInfo(fighter:Fighter):UnitInfo|undefined {
  if(fighter.life!=='active'||fighter.departed||fighter.hp<=0)return;
  const stats=effectiveFighterStats(fighter,0),soldier=fighter.role!=='wolf';
  return {id:fighter.id,enemy:true,activity:fighter.attack||fighter.target?'正在战斗':fighter.order==='hold'&&!!fighter.goal?'返回据点':fighter.speed>.08?'正在移动':'警戒',
    meters:[{id:fighter.id+'-health',label:'生命',value:fighter.hp,maximum:stats.hp,kind:'health'}],attack:stats.attack,armor:stats.armor,
    ...(soldier?{progression:experienceProgress(fighter.experience)}:{})};
}

/** Persistent assignments take precedence over a temporary activity (for
 * example, a tower archer still owns that post while going for a meal). */
function populationAssignment(state:EconomyState,id:string,fighter:Fighter|undefined) {
  const tower=assignedTower(state,id);
  if(tower)return tower.phase==='approach'?'前往哨塔':tower.phase==='meal'?'哨塔驻守·进食':'驻守哨塔';
  if(state.raids.evading[id])return '避险中';
  const targetId=fighter?.commandTarget??fighter?.target;
  if(targetId){
    const target=state.combat.units.find(u=>u.id===targetId);
    const name=ENEMIES.find(r=>r.id===targetId)?.name??(target?{infantry:'敌方步兵',archer:'敌方弓兵',cavalry:'敌方骑兵',wolf:'灰狼'}[target.role]:allWolves(state.raids).some(w=>w.id===targetId)?'灰狼':'敌军');
    return `攻击·${name}`;
  }
  const task=state.tasks.find(t=>(t.worker??'farmer')===id&&['travelling','working','delivering'].includes(t.status));
  if(task)return task.status==='delivering'?(task.kind==='supply'?'补给火堆':'搬运入库'):`${task.status==='travelling'?'前往':''}${WORK_NAMES[task.kind]}`;
  if(state.vitals[id].rest)return '火堆休整';
  if(fighter?.order==='retreat')return '撤退中';
  if(fighter?.order==='move'&&fighter.goal)return '前往指定位置';
  if(fighter?.order==='hold')return '原地驻守';
  if(fighter?.order==='rest')return '休整中';
  return fighter?'待命':'空闲';
}

/** Living home units, including dogs; mounts and hostile units have no rows. */
export function populationInfo(state: EconomyState) {
  return homeResidents(state).filter(r => health(state, r.id) > 0).map(r => {
    const fighter = state.combat.units.find(u => u.id === r.id);
    const stats = fighter && effectiveFighterStats(fighter, state.upgrades.arms);
    const group = state.groups.findIndex(members => members.includes(r.id));
    return { id: r.id, name: r.name, role: r.role, health: health(state, r.id), maxHealth: maxHealth(r.id, state),
      stamina: state.vitals[r.id].stamina, maxStamina: VITAL_CONFIG.maxStamina,
      ...(fighter ? { progression: experienceProgress(fighter.experience) } : {}),
      attack: stats?.attack, armor: stats?.armor ?? 0, group: group < 0 ? undefined : group,
      assignment: populationAssignment(state,r.id,fighter) };
  });
}
