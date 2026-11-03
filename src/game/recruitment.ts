import { RESIDENTS, newResident } from './resident-data.ts';
import type { ResidentDefinition, ResidentRole } from './resident-data.ts';
import type { Economy, EconomyState, Inventory } from './economy.ts';
import type { Point, Obstacle } from './movement.ts';
import { isBlocked } from './movement.ts';
import { inBounds } from './wander.ts';
import { WORLD_BOUNDS, HOME_CENTER } from './world-data.ts';
import { economyObstacles } from './economy-config.ts';
import { createFighter } from './combat.ts';
import { bodiesFor, initialVital, health } from './vitals.ts';

export const RECRUIT_CONFIG = {
  farmer: { name: '农民', seconds: 10, cost: { food: 6 } },
  infantry: { name: '步兵', seconds: 15, cost: { food: 8, iron: 2 } },
  archer: { name: '弓兵', seconds: 15, cost: { food: 8, wood: 4 } },
  cavalry: { name: '骑兵', seconds: 25, cost: { food: 12, iron: 4 } },
  dog: { name: '田园犬', seconds: 8, cost: { food: 4 } },
} satisfies Record<ResidentRole, { name: string; seconds: number; cost: Partial<Inventory> }>;
export const POPULATION_LIMIT = 200, DOG_LIMIT = 4, RECRUIT_QUEUE_LIMIT = 5;
export interface RecruitOrder { serial: number; role: ResidentRole; elapsed: number }
export interface RecruitmentState { nextId: number; roster: ResidentDefinition[]; queue: RecruitOrder[]; rally: Point }
export const initialRecruitment = (): RecruitmentState => ({ nextId: 1, roster: [], queue: [],
  rally: { x: HOME_CENTER.x, z: HOME_CENTER.z - HOME_CENTER.depth / 2 - 3.5 } });
export const homeResidents = (state: Pick<EconomyState, 'recruitment'>) => [...RESIDENTS, ...state.recruitment.roster];
export const livingResidents = (state: EconomyState) => homeResidents(state).filter(r => health(state, r.id) > 0);
export function decodeRecruitment(raw:RecruitmentState):RecruitmentState {
  const point=(p:Point)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&inBounds(p,0,WORLD_BOUNDS);
  if(!raw||!Number.isSafeInteger(raw.nextId)||raw.nextId<1||!point(raw.rally)||!Array.isArray(raw.roster)||raw.roster.length>1000
    ||!Array.isArray(raw.queue)||raw.queue.length>RECRUIT_QUEUE_LIMIT)throw new Error('招募存档无效');
  const ids=new Set<number>();
  const roster=raw.roster.map(r=>{
    const match=/^recruit-(farmer|infantry|archer|cavalry|dog)-(\d+)$/.exec(r?.id??''),serial=Number(match?.[2]);
    if(!match||match[1]!==r.role||!Number.isSafeInteger(serial)||serial<1||serial>=raw.nextId||ids.has(serial)||!point(r.spawn))throw new Error('招募人物存档无效');
    ids.add(serial);return newResident(r.role,r.id,r.spawn);
  });
  const queue=raw.queue.map((q,i)=>{
    if(!q||!Object.hasOwn(RECRUIT_CONFIG,q.role)||!Number.isSafeInteger(q.serial)||q.serial<1||q.serial>=raw.nextId||ids.has(q.serial)
      ||!Number.isFinite(q.elapsed)||q.elapsed<0||q.elapsed>RECRUIT_CONFIG[q.role].seconds||i>0&&q.elapsed!==0)throw new Error('招募队列存档无效');
    ids.add(q.serial);return {...q};
  });
  return {nextId:raw.nextId,roster,queue,rally:{...raw.rally}};
}
export function recruit(e: Economy, role: ResidentRole) {
  const state=e.state, config=RECRUIT_CONFIG[role];
  if (!config) return {ok:false,message:'请选择招募类型'};
  if(state.recruitment.queue.length>=RECRUIT_QUEUE_LIMIT)return {ok:false,message:'招募队列已满'};
  const count=livingResidents(state).filter(r=>(r.role==='dog')===(role==='dog')).length
    +state.recruitment.queue.filter(r=>(r.role==='dog')===(role==='dog')).length;
  if(count >= (role==='dog'?DOG_LIMIT:POPULATION_LIMIT))return {ok:false,message:role==='dog'?'田园犬名额已满':'人口名额已满'};
  const entries=Object.entries(config.cost) as [keyof Inventory,number][];
  const available=e.available();
  if(entries.some(([key,amount])=>available[key]<amount))return {ok:false,message:'可用库存不足'};
  entries.forEach(([key,amount])=>state.inventory[key]-=amount);
  state.recruitment.queue.push({serial:state.recruitment.nextId++,role,elapsed:0});e.revision++;
  return {ok:true,message:`${config.name}已加入招募队列`};
}
export function cancelRecruit(e: Economy, serial: number) {
  const index=e.state.recruitment.queue.findIndex(q=>q.serial===serial);if(index<0)return false;
  const [order]=e.state.recruitment.queue.splice(index,1), capacity=e.capacity();
  const overflow: Partial<Inventory>={};
  for(const [key,amount] of Object.entries(RECRUIT_CONFIG[order.role].cost) as [keyof Inventory,number][]){
    const returned=Math.min(amount,capacity[key]-e.state.inventory[key]); e.state.inventory[key]+=returned;
    if(returned<amount)overflow[key]=amount-returned;
  }
  e.dropReward(e.state.recruitment.rally,overflow);e.revision++;return true;
}
/** A completed recruit waits at 100% until its whole body fits outside the door. */
export function advanceRecruitment(e: Economy, seconds: number, occupants: readonly Obstacle[] = []) {
  if(!Number.isFinite(seconds)||seconds<=0)return;
  const state=e.state, order=state.recruitment.queue[0];if(!order)return;
  order.elapsed=Math.min(RECRUIT_CONFIG[order.role].seconds,order.elapsed+seconds);
  if(order.elapsed<RECRUIT_CONFIG[order.role].seconds)return;
  const id=`recruit-${order.role}-${order.serial}`, radius=RESIDENTS.find(r=>r.role===order.role)!.bodyRadius;
  const solids=[...economyObstacles(state.depleted,state.sites,state.buildings),...occupants];
  const door={x:HOME_CENTER.x-.35,z:HOME_CENTER.z-HOME_CENTER.depth/2-1.25};
  const candidates=Array.from({length:4},(_,row)=>[-1,0,1].map(col=>({x:door.x+col*(radius*2+.2),z:door.z-row*.7}))).flat();
  const point=candidates.find(p=>inBounds(p,radius,WORLD_BOUNDS)&&!isBlocked(p,radius,solids));if(!point)return;
  const definition=newResident(order.role,id,point);
  state.recruitment.roster.push(definition);state.recruitment.queue.shift();
  for(const body of bodiesFor(id))state.vitals[body]=initialVital(body);
  state.residents[id]={position:{...point},manualGoal:{...state.recruitment.rally}};
  if(!['farmer','dog'].includes(order.role))state.combat.units.push(createFighter(definition));
  e.revision++;return definition;
}
