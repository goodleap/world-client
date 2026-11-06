import { Economy, encodeEconomy, pending, WORK_NAMES } from './economy.ts';
import type { EconomyState } from './economy.ts';
import { createEconomyNavigation } from './economy-navigation.ts';
import { createResidentSimulation } from './resident-simulation.ts';
import { createEconomyController } from './economy-controller.ts';
import type { UnitCommand } from './economy-controller.ts';
import { createNeedsController } from './needs-controller.ts';
import { Combat, fighterRadius, fighterStats } from './combat.ts';
import { Raids } from './raids.ts';
import { homeResidents, advanceRecruitment } from './recruitment.ts';
import { ENEMIES, newResident, roleLeader } from './resident-data.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import { occupiedTower, evictTower, updateTowers, requestGarrison, garrisonCandidate } from './towers.ts';
import { combineObstacles } from './navigation-geometry.ts';
import { planWorkApproach } from './work-navigation.ts';
import { planNavigation } from './navigation-plan.ts';
import { groupDestinations } from './group-orders.ts';
import { pruneGroups } from './groups.ts';
import { applyHomeAction } from './home-actions.ts';
import type { HomeAction } from './home-actions.ts';
import type { BuildingKind } from './construction.ts';
import type { Bounds, Point } from './movement.ts';
import type { DamageNumber } from './damage-numbers.ts';
import { createNativeNavigation } from './native-navigation.ts';
import { createNativeMotion } from './native-motion.ts';
import { installNavigationRuntime } from './navigation-runtime.ts';
import { SystemMetrics } from './system-metrics.ts';

export type SimulationEvent={type:'damage';hit:DamageNumber}|{type:'level';id:string;level:number}|{type:'speech';id:string;text:string}
  |{type:'warehouse';point?:Point}|{type:'door';id:string};
export type SimulationCommand={type:'move';ids:string[];point:Point;group?:number}|{type:'attack';ids:string[];target:string}
  |{type:'work';id?:string;instruction:Extract<UnitCommand,{kind:'work'}>}|{type:'cancel';id:number}
  |{type:'fire';id:string;action:'fire-toggle'|'cook-toggle'}|{type:'leadership';enabled:boolean}
  |{type:'demolish';id:string}|{type:'garrison';tower:string;selected:string[]}|{type:'evict';tower:string}
  |{type:'rally';point:Point}|{type:'place';kind:BuildingKind;point:Point}|{type:'home';action:HomeAction};
export interface CommandResult{ok:boolean;message:string;count?:number;point?:Point;id?:string;token?:number|string}

/** All authoritative gameplay state lives here. Rendering reads a replica and
 * sends commands; it never advances transactions or decides damage. */
export async function createSimulation(state:EconomyState,emit:(event:SimulationEvent)=>void=()=>{}){
  const economy=new Economy(state),world=createEconomyNavigation(economy),metrics=new SystemMetrics();
  const nav=await createNativeNavigation();
  const motion=createNativeMotion(nav,WORLD_BOUNDS,()=>world.obstacles());
  const releaseNavigation=installNavigationRuntime(motion.runtime);
  // First movement must not pay for a new Recast build during combat.
  for(const radius of [.29,.4,.54,.6,.72])nav.profile(radius,WORLD_BOUNDS,world.obstacles(radius!==.29));
  const definitions=()=>[...homeResidents(state),...ENEMIES,...state.combat.units.filter(u=>u.id.startsWith('enemy-raid-'))
    .map(u=>({...newResident(u.role as 'infantry'|'archer'|'cavalry',u.id,u.home),name:u.role==='archer'?'来袭弓兵':u.role==='cavalry'?'来袭骑兵':'来袭步兵'}))];
  const residents=createResidentSimulation(definitions(),state.vitals,world.obstacles,state.raids.seed,id=>state.combat.units.find(u=>u.id===id)?.position??state.residents[id]?.position);
  residents.restoreResidents(state.residents);
  const combat=new Combat(state.combat,economy,()=>world.obstacles(true),residents.combatNeighbours);
  combat.setDamageFeedback(hit=>emit({type:'damage',hit}));combat.setLevelFeedback((id,level)=>emit({type:'level',id,level}));
  residents.syncCombat(state.combat.units);
  let visible:Bounds|undefined;
  const raids=new Raids(economy,combat,{status:residents.needsStatus,command:(p,id,path)=>residents.command(p,id,false,path),
    movementInput:residents.movementInput,release:residents.releaseFarmerWork,resting:residents.setResting,neighbours:residents.combatNeighbours},
    ()=>world.obstacles(true),p=>!!visible&&p.x>=visible.minX&&p.x<=visible.maxX&&p.z>=visible.minZ&&p.z<=visible.maxZ);
  residents.setExtraNeighbours(()=>raids.neighbours());residents.setWanderObstacles(()=>raids.workObstacles());
  const occupancy=()=>[...residents.occupancy(),...raids.occupancy()];economy.setOccupancy(occupancy);
  const needs=createNeedsController(economy,residents,combat,point=>emit({type:'warehouse',point}),{
    plan(id,goal){const p=combat.unit(id)?combat.movementInput(id,goal):residents.movementInput(id,goal);
      return p&&planWorkApproach(p.start,[goal],p.radius,p.bounds,combineObstacles(p.solids,raids.workObstacles()),p.neighbours);},
    current:id=>combat.unit(id)?.route??residents.routeFor(id),
  });
  economy.setDemolitionPreparation(id=>{
    if(state.towers.find(t=>t.id===id)?.unit&&!evictTower(economy,combat,id))return false;
    for(const [unit,v]of Object.entries(state.vitals))if(v.rest?.camp===id){if(combat.unit(unit))combat.guard([unit]);else residents.releaseFarmerWork(unit);}
    return true;
  });
  const leader=roleLeader('farmer');
  const controller=createEconomyController(economy,world,residents,!!leader,(worker,task)=>{
    if(!leader||!state.steward.enabled)return;
    const name=homeResidents(state).find(r=>r.id===worker)?.name??'农民',index=state.plots.findIndex(p=>p.id===task.target);
    const target=index>=0?`${index+1}号地`:task.kind==='haul'?'这批资源，送到仓库':task.kind==='build'?'建筑':task.kind==='chop'?'这棵树':'这处石材';
    const work=task.kind==='sow'&&task.crop?`种${ECONOMY_CONFIG.crops[task.crop].name}`:WORK_NAMES[task.kind];
    emit({type:'speech',id:leader.id,text:`${worker===leader.id?'我去':`${name}，去`}${work}${target}。`});
  },point=>emit({type:'warehouse',point}),(id,task)=>needs.canTakeWork(id)&&raids.canWork(id,task?.origin==='manual'),
    points=>raids.unsafePath(points),()=>raids.workObstacles(),id=>!!raids.state.evading[id]);
  const clearGroupMove=(id:string)=>{for(const [key,order]of Object.entries(state.groupMoves))if(order.members.includes(id))delete state.groupMoves[key];};
  const manual=(id:string,keepGroup=false)=>{if(!keepGroup)clearGroupMove(id);needs.manual(id);raids.manual(id);};
  const input=(id:string,p:Point)=>combat.unit(id)?combat.movementInput(id,p):residents.movementInput(id,p);
  const move=(id:string,p:Point,path?:readonly Point[])=>combat.unit(id)?combat.move([id],p,false,false,false,false,path)>0:controller.command(id,{kind:'move',point:p,path}).ok;
  function command(c:SimulationCommand):CommandResult{
    switch(c.type){
      case 'home':return {ok:true,message:applyHomeAction(economy,c.action)};
      case 'leadership':economy.setLeadership(c.enabled);return {ok:true,message:''};
      case 'cancel':return {ok:economy.cancel(c.id),message:''};
      case 'fire':{const fire=economy.campfire(c.id);if(!fire)return {ok:false,message:'目标不存在'};
        if(c.action==='fire-toggle')economy.setFire(c.id,!fire.enabled);else economy.setCooking(c.id,!fire.cooking);return {ok:true,message:''};}
      case 'place':{const result=economy.placeBuilding(c.kind,c.point,occupancy());world.sync();return {ok:result.ok,message:result.warning??result.message,id:result.task?.target};}
      case 'demolish':{const workers=state.tasks.filter(t=>t.target===c.id&&pending(t)&&t.worker).map(t=>t.worker!);const result=economy.demolish(c.id);
        if(result.ok)for(const id of workers)if(!economy.active(id))residents.releaseFarmerWork(id);world.sync();return result;}
      case 'garrison':{const candidate=garrisonCandidate(economy,combat,c.tower,c.selected);if(!candidate)return {ok:false,message:'没有可入驻的弓兵'};
        const result=requestGarrison(economy,combat,c.tower,candidate.id);if(result.ok)manual(candidate.id);return {...result,id:candidate.id,token:`tower:${c.tower}`};}
      case 'evict':return {ok:evictTower(economy,combat,c.tower),message:'入口被占用，暂时无法撤出'};
      case 'work':{const {instruction:i,id}=c,result=id?controller.command(id,i):economy.request(i.work,i.target,i.crop);
        if(result.ok&&id)manual(id);return {...result,id,token:id?economy.active(id)?.id:undefined};}
      case 'attack':{const count=combat.attack(c.ids,c.target);if(count)c.ids.forEach(id=>manual(id));return {ok:count>0,count,message:count?'攻击':'先选择一名士兵'};}
      case 'rally':{const path=nav.plan({start:state.recruitment.rally,goals:[c.point],radius:.4,bounds:WORLD_BOUNDS,obstacles:world.obstacles(true),move:true});
        const point=path?.at(-1);if(point){state.recruitment.rally={...point};economy.revision++;}return {ok:!!point,point,message:point?'集合点已更新':'无法到达该位置'};}
      case 'move':{
        const ids=c.ids.filter(id=>!!input(id,c.point));if(!ids.length)return {ok:false,message:'没有可移动的单位'};
        let center=c.point,common:Point[]|undefined;
        if(c.group!==undefined&&ids.length>1){const first=input(ids[0],center);common=first?planNavigation(first)??undefined:undefined;
          if(!common?.length)return {ok:false,message:'无法到达该位置'};center=common.at(-1)!;}
        const defs=homeResidents(state),slots=groupDestinations(ids.map(id=>({id,position:combat.unit(id)?.position??residents.needsStatus(id).position,radius:defs.find(r=>r.id===id)!.bodyRadius})),center);
        const accepted:string[]=[];let point=center;
        for(const slot of slots){const p=input(slot.id,slot.point),path=p?planNavigation({...p,routeHint:common})??undefined:undefined;
          if(path&&move(slot.id,slot.point,path)){manual(slot.id,true);clearGroupMove(slot.id);accepted.push(slot.id);if(c.group===undefined)point=path.at(-1)!;}}
        if(c.group!==undefined&&common&&accepted.length)state.groupMoves[c.group]={members:accepted,center:{...center},route:common};
        return {ok:accepted.length>0,count:accepted.length,point,message:accepted.length===ids.length?'':accepted.length?`${accepted.length}/${ids.length} 名已接受指令`:'无法到达该位置'};
      }
    }
  }
  let steps=0,lastMs=0,maxMs=0,definitionKey=definitions().map(d=>d.id).join(',');
  function step(dt:number){
    const begin=performance.now();world.sync();
    metrics.run('crowd',()=>motion.prepare([...residents.crowdBodies(),...[...combat.state.units,...raids.wolves].filter(u=>u.life==='active'&&!u.departed&&!occupiedTower(state,u.id)).map(u=>({
      id:u.id,position:u.position,radius:fighterRadius(u),speed:fighterStats(u).speed*(u.order==='guard'&&!u.target?.length? .65:1),
      route:u.attackApproach?u.route.slice(0,-1):u.route,solids:world.obstacles(true),moveIdle:(p:Point)=>{u.position=p;},
    }))],dt));
    metrics.run('economy',()=>controller.update(dt));metrics.run('raids',()=>raids.update(dt));
    const recruited=metrics.run('recruitment',()=>advanceRecruitment(economy,dt,occupancy()));
    const defs=definitions(),key=defs.map(d=>d.id).join(',');
    if(key!==definitionKey){definitionKey=key;residents.syncDefinitions(defs);combat.syncUnits();}
    if(recruited){emit({type:'door',id:'home-center'});move(recruited.id,state.recruitment.rally);}
    metrics.run('towers',()=>updateTowers(economy,combat));metrics.run('combat',()=>combat.update(dt));
    residents.syncCombat(combat.state.units);metrics.run('residents',()=>residents.update(dt));metrics.run('needs',()=>needs.update(dt));
    pruneGroups(economy);steps++;lastMs=performance.now()-begin;maxMs=Math.max(maxMs,lastMs);
  }
  return {economy,residents,combat,raids,step,command,setView:(bounds:Bounds)=>{visible=bounds;},
    save(){state.residents=residents.saveResidents();return encodeEconomy(economy);},
    diagnostics:()=>({thread:'simulation-worker',steps,lastMs,maxMs,systems:metrics.snapshot(),navigation:nav.snapshot(),crowd:motion.snapshot(),
      population:{residents:definitions().length,fighters:state.combat.units.length,wolves:raids.wolves.length,projectiles:state.combat.projectiles.length,tasks:state.tasks.filter(pending).length,solids:world.obstacles(true).length}}),
    dispose(){releaseNavigation();motion.dispose();nav.dispose();},
  };
}
export type Simulation=Awaited<ReturnType<typeof createSimulation>>;
