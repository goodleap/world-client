import type { Economy, EconomyState } from './economy.ts';
import type { Combat } from './combat.ts';
import type { Point, Obstacle } from './movement.ts';
import type { BuildingSite } from './construction.ts';
import { buildingDoor } from './construction.ts';
import { isBlocked } from './movement.ts';
import { inBounds } from './wander.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { economyObstacles } from './economy-config.ts';
import { maxHealth, needsFood } from './vitals.ts';
import { TOWER_SHAPE } from './tower-shape.ts';
import { BUILDING_STATS } from './building-state.ts';
import { BODY_RADIUS } from './body-shape.ts';

export const TOWER_CONFIG={hp:BUILDING_STATS.tower.hp,armor:BUILDING_STATS.tower.armor,range:12,height:TOWER_SHAPE.deck,cost:{wood:20,stone:12,food:0,iron:0},fallDamage:.25} as const;
export interface TowerState extends Point {id:string;hp:number;unit?:string;phase:'empty'|'approach'|'occupied'|'meal'}
export const towerPlatform=(tower:Point):Point=>({x:tower.x,z:tower.z});
export const newTower=(site:BuildingSite):TowerState=>({id:site.id,x:site.x,z:site.z,hp:TOWER_CONFIG.hp,phase:'empty'});
export const assignedTower=(state:EconomyState,id:string)=>state.towers.find(t=>t.hp>0&&t.unit===id);
export const occupiedTower=(state:EconomyState,id:string)=>state.towers.find(t=>t.hp>0&&t.unit===id&&t.phase==='occupied');
export const towerHeight=(state:EconomyState,id:string)=>occupiedTower(state,id)?TOWER_CONFIG.height:state.combat.units.find(u=>u.id===id)?.deathElevation??0;
export function releaseTower(state:EconomyState,id:string){const tower=assignedTower(state,id);if(tower){tower.unit=undefined;tower.phase='empty';}}
export function towerExit(state:EconomyState,tower:TowerState,solids:readonly Obstacle[],crowd:readonly Obstacle[]=[]):Point|undefined {
  const site=state.sites.find(s=>s.id===tower.id);if(!site)return;
  const door=buildingDoor(site);
  const candidates=Array.from({length:5},(_,row)=>[0,-1,1,-2,2].map(col=>({x:door.x+col*.85,z:door.z-row*.65}))).flat();
  return candidates.find(p=>inBounds(p,.4,WORLD_BOUNDS)&&!isBlocked(p,.4,[...solids,...crowd]));
}
/** Removed structures leave no obstacle or build task that could resurrect them. */
export function damageTower(e:Economy,id:string,amount:number,onFall:(id:string,damage:number)=>void){
  const tower=e.state.towers.find(t=>t.id===id);if(!tower||tower.hp<=0)return;
  tower.hp=Math.max(0,tower.hp-Math.max(1,amount));e.revision++;
  if(tower.hp)return;
  const site=e.state.sites.find(s=>s.id===id)!,unit=e.state.combat.units.find(u=>u.id===tower.unit);
  e.state.sites=e.state.sites.filter(s=>s.id!==id);e.state.buildings=e.state.buildings.filter(s=>s!==id);
  e.state.tasks=e.state.tasks.filter(t=>t.target!==id);
  if(unit){
    if(tower.phase==='occupied'){
      const solids=economyObstacles(e.state.depleted,e.state.sites,e.state.buildings);
      const crowd=e.state.combat.units.filter(u=>u!==unit&&u.life==='active'&&!u.departed&&!occupiedTower(e.state,u.id)).map(u=>({kind:'circle' as const,...u.position,radius:BODY_RADIUS[u.role]}));
      // The former platform's center is now free ground if the door is occupied.
      const candidates=[buildingDoor(site),{x:tower.x,z:tower.z}];
      unit.position={...(candidates.find(p=>!isBlocked(p,.4,[...solids,...crowd]))??candidates[1])};
      unit.route=[];unit.goal=undefined;unit.attack=undefined;unit.target=undefined;unit.order='guard';unit.speed=0;
      e.state.vitals[unit.id].rest=undefined;unit.deathElevation=undefined;unit.deathTower=undefined;
      tower.unit=undefined;tower.phase='empty';
      onFall(unit.id,maxHealth(unit.id, e.state)*TOWER_CONFIG.fallDamage);
    }else{tower.unit=undefined;tower.phase='empty';}
  }
  for(const body of e.state.combat.units)if(body.deathTower===id){body.deathTower=undefined;body.deathElevation=0;}
}
/** Preview only: never interrupts orders or changes group membership. */
export function garrisonAvailability(e:Economy,combat:Combat,towerId:string,selectedIds:readonly string[]=[]){
  const tower=e.state.towers.find(t=>t.id===towerId&&t.hp>0&&!t.unit),site=e.state.sites.find(s=>s.id===towerId);
  if(!tower||!site)return {candidate:undefined,reason:'哨塔不可入驻'};
  const door=buildingDoor(site),selected=selectedIds.length===1?combat.controllable(selectedIds).find(u=>u.role==='archer'):undefined;
  if(selected)return {candidate:combat.canMoveTo(selected.id,door,true)?selected:undefined,reason:'指定弓兵无法到达入口'};
  const grouped=new Set(e.state.groups.flat());
  const archers=combat.state.units.filter(u=>u.team==='home'&&u.role==='archer'&&u.life==='active'&&!u.departed);
  const idle=archers.filter(u=>!assignedTower(e.state,u.id)&&!e.state.vitals[u.id].rest&&!u.attack&&!u.target&&!u.goal&&!u.route.length&&!e.active(u.id))
    .sort((a,b)=>Number(grouped.has(a.id))-Number(grouped.has(b.id))
      ||Math.hypot(a.position.x-door.x,a.position.z-door.z)-Math.hypot(b.position.x-door.x,b.position.z-door.z)||a.id.localeCompare(b.id));
  const candidate=idle.find(u=>combat.canMoveTo(u.id,door,true));
  const reason=!archers.length?'需要一名弓兵':idle.length?'入口无法到达'
    :archers.every(u=>!!assignedTower(e.state,u.id))?'弓兵已驻守或预约'
    :archers.every(u=>!!e.state.vitals[u.id].rest)?'弓兵正在休整':'弓兵正在执行其他指令';
  return {candidate,reason};
}
export function garrisonCandidate(e:Economy,combat:Combat,towerId:string,selectedIds:readonly string[]=[]){return garrisonAvailability(e,combat,towerId,selectedIds).candidate;}
export function requestGarrison(e:Economy,combat:Combat,towerId:string,unitId:string){
  const tower=e.state.towers.find(t=>t.id===towerId&&t.hp>0),unit=combat.unit(unitId);
  if(!tower||!unit||unit.team!=='home'||unit.role!=='archer'||unit.life!=='active')return {ok:false,message:'需要一名存活的我方弓兵'};
  if(tower.unit)return {ok:false,message:'哨塔已有驻守或预约单位'};
  const site=e.state.sites.find(s=>s.id===tower.id)!;
  if(!combat.move([unitId],buildingDoor(site),false,false,false,true,undefined,true))return {ok:false,message:'无法到达哨塔入口'};
  tower.unit=unitId;tower.phase='approach';e.revision++;return {ok:true,message:'前往哨塔驻守'};
}
export function evictTower(e:Economy,combat:Combat,towerId:string){
  const tower=e.state.towers.find(t=>t.id===towerId&&t.hp>0);if(!tower?.unit)return false;
  const site=e.state.sites.find(s=>s.id===tower.id)!;
  return combat.move([tower.unit],buildingDoor(site))>0;
}
export function updateTowers(e:Economy,combat:Combat){
  for(const tower of e.state.towers){
    if(!tower.hp||!tower.unit)continue;
    const u=combat.unit(tower.unit),site=e.state.sites.find(s=>s.id===tower.id);
    if(!u||!site||u.life!=='active'){releaseTower(e.state,tower.unit);e.revision++;continue;}
    if(tower.phase==='approach'){
      const door=buildingDoor(site);
      if(Math.hypot(u.position.x-door.x,u.position.z-door.z)<.25&&!u.route.length){
        u.position=towerPlatform(tower);u.goal=undefined;u.route=[];u.order='guard';u.attack=undefined;u.target=undefined;u.speed=0;
        tower.phase='occupied';e.revision++;
      }
    }else if(tower.phase==='meal'&&!e.state.vitals[u.id].rest&&!needsFood(e.state,u.id)&&!u.goal&&!u.target&&!u.attack){
      if(combat.move([u.id],buildingDoor(site),false,false,true,true)){tower.phase='approach';e.revision++;}
    }
  }
}
/** Tower state is decoded after combat and building identities are known. */
export function validateTowers(state:EconomyState){
  const units=new Set<string>();
  if(!Array.isArray(state.towers)||state.towers.length>10000||new Set(state.towers.map(t=>t.id)).size!==state.towers.length)throw new Error('哨塔存档无效');
  for(const t of state.towers){
    const site=state.sites.find(s=>s.id===t.id),u=state.combat.units.find(u=>u.id===t.unit);
    if(!t||!/^site-\d+$/.test(t.id)||Number(t.id.slice(5))>=state.nextSiteId||!Number.isFinite(t.hp)||t.hp<0||t.hp>TOWER_CONFIG.hp||!inBounds(t,0,WORLD_BOUNDS)
      ||!['empty','approach','occupied','meal'].includes(t.phase)||(t.unit===undefined)!==(t.phase==='empty')
      ||t.hp>0&&(!site||site.kind!=='tower'||!state.buildings.includes(t.id)||site.x!==t.x||site.z!==t.z)
      ||t.hp===0&&(!!site||!!t.unit)||t.unit&&(!u||u.role!=='archer'||u.team!=='home'||u.life!=='active'||units.has(t.unit))
      ||t.phase==='occupied'&&u&&(Math.hypot(u.position.x-towerPlatform(t).x,u.position.z-towerPlatform(t).z)>.01||!!u.goal||u.route.length>0))throw new Error('哨塔驻守存档无效');
    if(t.unit)units.add(t.unit);
  }
  if(state.sites.some(s=>s.kind==='tower'&&state.buildings.includes(s.id)&&!state.towers.some(t=>t.id===s.id&&t.hp>0)))throw new Error('建成哨塔缺少状态');
}
