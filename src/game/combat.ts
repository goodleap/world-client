import { createProjectileSight } from './projectile-sight.ts';
import { Octree } from '@babylonjs/core/Culling/Octrees/octree.js';
import { BoundingBox } from '@babylonjs/core/Culling/boundingBox.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { combineObstacles } from './navigation-geometry.ts';
import { MAP_DEVELOPMENT } from './opening-profile.ts';
import { navigationRuntime } from './navigation-runtime.ts';
import { surfaceHeight } from './terrain-height.ts';
import { RAID_CONFIG, DEBUG_RAID_CONFIG } from './raid-state.ts';
import { BODY_RADIUS, bodyObstacle, turnTowards } from './body-shape.ts';
import { assignedTower, occupiedTower, towerHeight, towerExit, releaseTower, damageTower, TOWER_CONFIG } from './towers.ts';
import type { Point, Obstacle } from './movement.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { RESIDENTS, ENEMIES, newResident } from './resident-data.ts';
import type { ResidentDefinition } from './resident-data.ts';
import { homeResidents } from './recruitment.ts';
import { segmentIsClear } from './wander.ts';
import { createRouteState, resetRouteState, stepRoute } from './route-following.ts';
import type { RouteState, Neighbour } from './route-following.ts';
import { occupiedApproach, planMoveDestination, planWorkApproach } from './work-navigation.ts';
import { validateNavigation } from './navigation-plan.ts';
import { COMBAT_CONFIG as C, ENCOUNTERS, MELEE_CONTACT_GRACE } from './combat-config.ts';
import { leadShot } from './combat-aim.ts';
import type { CombatRole } from './combat-config.ts';
import type { Economy } from './economy.ts';
import { VITAL_CONFIG, changeHealth, bodiesFor } from './vitals.ts';
import { hitDamage } from './combat-damage.ts';
import { soldierLevel, levelHealth, MAX_EXPERIENCE } from './unit-progression.ts';
import { buildingInfo, buildingList } from './building-state.ts';
import { chooseTarget, hostile } from './targeting.ts';
import type { CombatTarget } from './targeting.ts';

export type CombatOrder = 'guard' | 'move' | 'attack' | 'retreat' | 'hold' | 'rest';
export type CombatLife = 'active' | 'defeated';
export interface Fighter {
  id: string; role: CombatRole; team: 'home' | 'enemy'; position: Point; home: Point;
  hp: number; experience: number; life: CombatLife; order: CombatOrder; goal?: Point; target?: string; commandTarget?:string;
  diedAt?: number; departed?:boolean; deathElevation?:number; deathTower?:string;
  facing: number; speed: number; cooldown: number; defendFrom?: Point; hurtAt?: number;
  pursuitQuiet?: number;
  targetSwitchIn?: number;
  provoked?: { from: Point; leash: number };
  attackApproach?: Point;
  attack?: { id: number; target: string; elapsed: number; released: boolean };
  route: Point[]; navigation: RouteState; planIn: number;
}
export interface Projectile { id: number; source: string; target: string; from: Point & {y?:number}; to: Point & {y?:number}; elapsed: number; duration: number; damage: number }
export interface CampState { id: string; cleared: boolean; discovered: boolean; rewardGranted: boolean; respawnAt: number; cycle: number }
export interface CombatState { camps: CampState[]; units: Fighter[]; projectiles: Projectile[]; nextAttack: number; discovered: boolean; cleared: boolean; rewardGranted: boolean; rewardGoods: string[] }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const enemyDefinitions = new Map(ENEMIES.map(enemy => [enemy.id, enemy]));
const campConfigs = new Map(ENCOUNTERS.map(c => [c.id,c]));
export function fighterStats(u: Pick<Fighter, 'role' | 'team'> & { id?: string }) {
  return u.role === 'wolf' ? C.wolf : u.team === 'home' ? C[u.role] : u.role === 'cavalry' ? C.enemyCavalry : enemyDefinitions.get(u.id ?? '')?.variant === 'heavy' ? C.enemyHeavy : u.role === 'infantry' ? C.enemyMelee : C.enemyArcher;
}
/** Share movement intent with Crowd. An assault without a current target is
 * still a march; only an actual camp patrol uses the slower patrol pace. */
export function fighterMovementSpeed(u:Fighter) {
  const patrolling=u.team==='enemy'&&enemyDefinitions.has(u.id)&&u.order==='guard'&&!u.target&&!u.goal;
  return fighterStats(u).speed*(patrolling?.65:1);
}
/** One effective-stat calculation for combat and inspection panels. */
export function effectiveFighterStats(u: Parameters<typeof fighterStats>[0] & { experience?: number }, arms: number) {
  const base = fighterStats(u), equipment = u.team === 'home' ? arms : 0;
  const rank = u.role === 'wolf' ? 0 : soldierLevel(u.experience) - 1;
  return { ...base, hp: levelHealth(base.hp, rank ? u.experience : 0),
    attack: Math.round(base.attack * (1 + rank * .1) * 10) / 10 + equipment * 3,
    armor: base.armor + rank + equipment };
}
// The route's final target anchor is shared with guidance; reserve the reachable firing/contact point.
export const fighterDestination = (u: Fighter | undefined) => u?.attackApproach ?? u?.route.at(-1);
export const fighterRadius = (u: Pick<Fighter, 'role'>) => BODY_RADIUS[u.role];
// Keep the established melee reach/approach spacing, independently of ground discs.
export const fighterContactRadius = (u: Pick<Fighter, 'role'>) => u.role === 'cavalry' ? 1.12 : fighterRadius(u);
const reach = (u: Fighter, target: CombatTarget) => fighterStats(u).range + (u.role === 'archer' ? 0 : Math.max(0, (target.contactRadius ?? target.radius) - .4));
export function createFighter(r:ResidentDefinition):Fighter {
  const role=r.role as CombatRole,team=r.id.startsWith('enemy-')?'enemy' as const:'home' as const;
  return {id:r.id,role,team,position:{...r.spawn},home:{...r.home},hp:fighterStats({id:r.id,role,team}).hp,experience:0,
    life:'active',order:'guard',facing:Math.PI,speed:0,cooldown:0,route:[],navigation:createRouteState(),planIn:0};
}
export function initialCombat(definitions:readonly ResidentDefinition[]=[...RESIDENTS,...ENEMIES]): CombatState {
  return { camps: ENCOUNTERS.map(c => ({ id: c.id, cleared: MAP_DEVELOPMENT, discovered: MAP_DEVELOPMENT, rewardGranted: MAP_DEVELOPMENT, respawnAt: 0, cycle: 0 })), nextAttack: 1, discovered: MAP_DEVELOPMENT, cleared: MAP_DEVELOPMENT, rewardGranted: MAP_DEVELOPMENT, rewardGoods: [], projectiles: [],
    units: definitions.filter(r=>!['farmer','dog'].includes(r.role)).map(createFighter) };
}

/** Owns combat time and settlement. Animation callbacks never apply damage.
 * All state, including an in-flight shot and release flag, is saved atomically
 * with the economy. Navigation reuses the game's swept crowd route follower. */
export class Combat {
  readonly state: CombatState;
  private economy: Economy;
  private solids: () => readonly Obstacle[];
  private civilians: () => Neighbour[];
  private residentPosition?: (id: string) => Point;
  private units: Map<string, Fighter>;
  private threats: readonly Fighter[] = [];
  private statCache = new Map<string, { level: number; rank: number; role:CombatRole;team:'home'|'enemy'; value: ReturnType<typeof fighterStats> }>();
  private motion = new Map<string, { position: Point; velocity: Point }>();
  private motionStep = .05;
  private projectileSight:ReturnType<typeof createProjectileSight>;
  private frameTargets?: { all:CombatTarget[]; home:CombatTarget[]; enemy:CombatTarget[]; byId:Map<string,CombatTarget>; padding:number };
  private targetPoint=new Vector3();
  private frameDestinations=new Map<string,Point>();
  private targetIndex=new Octree<{id:string;position:Point}>((t,block)=>{
    this.targetPoint.set(t.position.x,1/3,t.position.z);
    if(BoundingBox.IntersectsSphere(block.minPoint,block.maxPoint,this.targetPoint,.001)){block.entries.push(t);return;}
    const destination=this.frameDestinations.get(t.id);
    if(destination){this.targetPoint.set(destination.x,1/3,destination.z);if(BoundingBox.IntersectsSphere(block.minPoint,block.maxPoint,this.targetPoint,.001))block.entries.push(t);}
  },16,4);
  private frameNeighbours = new Map<string,Map<string,Neighbour>>();
  private planning = new Map<string,{intent:string;start:Point;points:Point[];nearby?:Point;solids:readonly Obstacle[];neighbours:ReturnType<Combat['reservations']>}>();
  private targetViews = new WeakMap<Fighter,CombatTarget>();
  private neighbourViews = new WeakMap<Fighter,Map<string,Neighbour>>();
  private levelFeedback?: (id:string,level:number)=>void;
  setLevelFeedback(callback:(id:string,level:number)=>void){this.levelFeedback=callback;}
  private damageFeedback?: (hit:import('./damage-numbers.ts').DamageNumber)=>void;
  setDamageFeedback(callback:(hit:import('./damage-numbers.ts').DamageNumber)=>void){this.damageFeedback=callback;}
  constructor(state: CombatState, economy: Economy, solids: () => readonly Obstacle[], civilians: () => Neighbour[] = () => []) {
    this.projectileSight=createProjectileSight(economy.state);
    this.state = state; this.economy = economy; this.solids = solids; this.civilians = civilians;
    this.units = new Map(state.units.map(unit => [unit.id, unit]));
  }
  private camp(u: Fighter) { return campConfigs.get(enemyDefinitions.get(u.id)?.camp ?? '')
    ?? {...ENCOUNTERS[0],id:'raid',x:(u.defendFrom??u.position).x,z:(u.defendFrom??u.position).z,leash:C.chase,patrol:[]}; }
  private stats(u: Fighter) {
    const level = u.team === 'home' ? this.economy.state.upgrades.arms : 0, cached = this.statCache.get(u.id);
    const rank = soldierLevel(u.experience);
    if (cached?.level === level && cached.rank === rank && cached.role===u.role && cached.team===u.team) return cached.value;
    const value = effectiveFighterStats(u, level);
    this.statCache.set(u.id, { level, rank, role:u.role,team:u.team,value }); return value;
  }
  private reach(u:Fighter,target:CombatTarget){return occupiedTower(this.economy.state,u.id)?TOWER_CONFIG.range:reach(u,target);}
  private alertRange(u:Fighter){return occupiedTower(this.economy.state,u.id)?TOWER_CONFIG.range:u.team==='home'?C.homeAcquire:C.acquire;}
  canTarget(u:Pick<Fighter,'role'>,target:CombatTarget){return u.role==='archer'||(target.elevation??0)<.5;}
  visible(from:Point,to:Point,sourceId?:string,targetId?:string){
    const state=this.economy.state;
    const ignored=state.towers.filter(t=>t.hp>0&&(t.id===targetId||t.phase==='occupied'&&(t.unit===sourceId||t.unit===targetId)
      ||((from as {y?:number}).y??0)>2&&Math.hypot(from.x-t.x,from.z-t.z)<1.2));
    const building=targetId?buildingInfo(state,targetId):undefined;
    if(this.unit(sourceId??'')?.role==='archer'||'y'in from){
      const start={...from,y:(from as Point&{y?:number}).y??surfaceHeight(from.x,from.z)+towerHeight(state,sourceId??'')+1.25};
      const end={...to,y:(to as Point&{y?:number}).y??surfaceHeight(to.x,to.z)+towerHeight(state,targetId??'')+1.25};
      return this.projectileSight.clear(start,end,this.solids(),new Set([...ignored.map(t=>t.id),...(building?.built?[building.id]:[])]));
    }
    return segmentIsClear(from,to,.05,WORLD_BOUNDS,this.solids(),ignored.length||building?.built?o=>ignored.some(t=>o.kind==='box'&&o.x===t.x&&o.z===t.z)
      ||!!(building?.built&&o.kind!=='polygon'&&o.x===building.x&&o.z===building.z):undefined);
  }
  syncUnits() { this.units=new Map(this.state.units.map(u=>[u.id,u]));for(const u of this.threats)this.units.set(u.id,u); }
  unit(id: string) { return this.units.get(id) ?? this.state.units.find(u=>u.id===id); }
  setResidentPositions(read: (id: string) => Point) { this.residentPosition = read; }
  private unitTarget(u:Fighter):CombatTarget {
    let view=this.targetViews.get(u);
    if(!view){
      const state=this.economy.state;
      view={id:u.id,get team(){return u.team;},get position(){return u.position;},get hp(){return u.hp;},get life(){return u.departed?'defeated':u.life;},
        get radius(){return fighterRadius(u);},get contactRadius(){return fighterContactRadius(u);},canAttack:true,get elevation(){return towerHeight(state,u.id);}};
      this.targetViews.set(u,view);
    }
    return view;
  }
  private collectTargets(): CombatTarget[] {
    const state=this.economy.state, neighbours = this.residentPosition ? [] : this.civilians(), read=this.residentPosition;
    return [...this.units.values()].filter(u=>!u.departed).map(u=>this.unitTarget(u))
      .concat(homeResidents(state).filter(r => !this.unit(r.id)).map(r => ({ id: r.id, team: 'home' as const,
        get position(){return read?.(r.id) ?? neighbours.find(n=>n.id===r.id)?.position ?? state.residents[r.id]?.position ?? r.spawn;},
        get hp(){return state.vitals[r.id].hp!;}, get life(){return state.vitals[r.id].hp!>0?'active' as const:'defeated' as const;},
        radius: r.bodyRadius, canAttack: false, elevation:0 })))
      .concat(buildingList(state).filter(b=>b.built&&b.hp>0).map(b=>({id:b.id,team:'home' as const,position:{x:b.x,z:b.z},
        get hp(){return buildingInfo(state,b.id)?.hp??0;}, get life(){return this.hp>0?'active' as const:'defeated' as const;},
        radius:Math.max(b.width,b.depth)/2,canAttack:state.towers.some(t=>t.id===b.id&&t.phase==='occupied'),kind:'building' as const,elevation:0})));
  }
  targets(opponentsOf?:'home'|'enemy'): CombatTarget[] {
    const frame=this.frameTargets;
    if(frame)return opponentsOf==='home'?frame.enemy:opponentsOf==='enemy'?frame.home:frame.all;
    return this.collectTargets().filter(t=>t.team!==opponentsOf);
  }
  private beginFrame(dt:number) {
    const all=this.collectTargets();
    let padding=0;
    for(const t of all){
      const u=this.unit(t.id);if(u)padding=Math.max(padding,this.stats(u).speed*dt);
    }
    this.frameDestinations.clear();
    for(const u of [...this.state.units,...this.threats]){const goal=fighterDestination(u);if(goal)this.frameDestinations.set(u.id,goal);}
    const civilians=this.civilians(),ids=new Set(all.map(t=>t.id));
    for(const n of civilians){const goal=(n as Neighbour&{destination?:Point}).destination;if(goal)this.frameDestinations.set(n.id,goal);}
    this.targetIndex.update(new Vector3(WORLD_BOUNDS.minX,0,WORLD_BOUNDS.minZ),new Vector3(WORLD_BOUNDS.maxX,1,WORLD_BOUNDS.maxZ),[...all,...civilians.filter(n=>!ids.has(n.id))]);
    this.frameTargets={all,home:all.filter(t=>t.team==='home'),enemy:all.filter(t=>t.team==='enemy'),byId:new Map(all.map(t=>[t.id,t])),padding};
  }
  nearbyTargets(u:Pick<Fighter,'position'|'team'>,radius:number) {
    const frame=this.frameTargets;if(!frame)return this.targets(u.team);
    // Earlier units may already have moved this step. Expand the native index query by
    // the largest possible step; final targeting checks read live positions.
    const range=radius+frame.padding;
    this.targetPoint.set(u.position.x,1/3,u.position.z);
    const found=this.targetIndex.intersects(this.targetPoint,range,false);
    return found.data.slice(0,found.length).flatMap(n=>{const t=frame.byId.get(n.id);return t&&t.team!==u.team?[t]:[];});
  }

  target(id: string) { const cached=this.frameTargets?.byId.get(id);if(cached)return cached;const unit=this.unit(id);return unit?(unit.departed?undefined:this.unitTarget(unit)):this.targets('enemy').find(t=>t.id===id); }
  setThreats(threats: readonly Fighter[]) {
    this.threats = threats;
    this.units = new Map([...this.state.units, ...threats].map(u => [u.id, u]));
    for (const u of this.state.units) {
      if (u.target && !this.target(u.target)) u.target = undefined;
      if (u.attack && !this.target(u.attack.target)) u.attack = undefined;
    }
    this.state.projectiles = this.state.projectiles.filter(p => this.target(p.target) && this.units.has(p.source));
    for (const id of this.statCache.keys()) if (!this.units.has(id)) this.statCache.delete(id);
    for (const id of this.planning.keys()) if (!this.units.has(id)) this.planning.delete(id);
  }
  hurt(id: string, damage: number, source: string) { const target = this.target(id); if (target) this.damage(target, damage, source); }
  private awardDamage(sourceId: string, damage: number) {
    const u = this.unit(sourceId);
    if (u && damage > 0 && enemyDefinitions.has(u.id)) u.pursuitQuiet = 0;
    if (!u || u.role === 'wolf' || damage <= 0 || u.experience >= MAX_EXPERIENCE) return;
    const maximum = this.stats(u).hp,previousLevel=soldierLevel(u.experience);
    u.experience = Math.min(MAX_EXPERIENCE, u.experience + damage);
    // Keep the amount of existing injury; a projectile cannot revive its owner.
    if (u.life === 'active') u.hp += this.stats(u).hp - maximum;
    if(u.life==='active'&&soldierLevel(u.experience)>previousLevel)this.levelFeedback?.(u.id,soldierLevel(u.experience));
    this.economy.revision++;
  }
  canAssist(id:string){
    const u=this.unit(id),vital=this.economy.state.vitals[id];
    return !!u&&u.team==='home'&&u.life==='active'&&!u.target&&!u.attack&&!u.goal
      &&['guard','hold'].includes(u.order)&&!vital.rest&&vital.manualUntil<=this.economy.state.seconds&&!this.economy.active(id);
  }
  assist(id: string, target: string) {
    const u = this.unit(id), foe = this.unit(target);
    if(!this.canAssist(id)||!u||!foe||foe.life!=='active'||u.defendFrom&&(distance(foe.position,u.defendFrom)>C.chase||distance(u.position,u.defendFrom)>C.chase))return false;
    u.target = target; u.order = 'guard'; u.defendFrom ??= { ...u.position }; this.stop(u); return true;
  }
  controllable(ids: readonly string[]) { return this.state.units.filter(u => ids.includes(u.id) && u.team === 'home' && u.life === 'active'); }
  private neighbours(u: Fighter,area?:{point:Point;radius:number}) {
    let list=this.frameTargets?this.frameNeighbours.get(u.team):undefined;
    if(!list){
      const neighbours=[...this.civilians().map(n=>({...n,yield:u.team==='home'?n.yield:undefined})), ...[...this.state.units,...this.threats].map(n=>{
        let views=this.neighbourViews.get(n);if(!views){views=new Map();this.neighbourViews.set(n,views);}
        let view=views.get(u.team);if(view)return view;
        const team=u.team;
        view={id:n.id,get position(){return n.position;},get radius(){return fighterRadius(n);},
          get heading(){return n.route.length?Math.atan2(n.route[0].x-n.position.x,n.route[0].z-n.position.z):n.facing;},get team(){return n.team;},
          get moving(){return n.speed>.08;},get purposeful(){return !!n.route.length;},get waiting(){return n.navigation.waiting;}};
        views.set(team,view);return view;
      })];
      list=new Map(neighbours.map(n=>[n.id,n]));
      if(this.frameTargets)this.frameNeighbours.set(u.team,list);
    }
    let candidates:Neighbour[];
    if(area&&this.frameTargets){
      this.targetPoint.set(area.point.x,1/3,area.point.z);
      const found=this.targetIndex.intersects(this.targetPoint,area.radius+this.frameTargets.padding+1.5,false);
      candidates=found.data.slice(0,found.length).flatMap(t=>{const n=list!.get(t.id);return n?[n]:[];});
    }else candidates=[...list.values()];
    return candidates.filter(n=>{const other=this.unit(n.id);return n.id!==u.id&&(!other||other.life!=='defeated'&&!other.departed&&!occupiedTower(this.economy.state,n.id));});
  }

  private face(u:Fighter,point:Point,dt:number){
    u.facing = turnTowards(u.facing, Math.atan2(point.x-u.position.x, point.z-u.position.z), dt, u.role === 'cavalry' ? 7 : 14);
  }

  private reservations(u: Fighter,area?:{point:Point;radius:number}) {
    return this.neighbours(u,area).map(n => ({ position:n.position, radius:n.radius,
      destination: fighterDestination(this.unit(n.id)) ?? (n as {destination?:Point}).destination }));
  }
  private stop(u: Fighter) { this.planning.delete(u.id);u.attackApproach = undefined; u.route.length = 0; u.speed = 0; resetRouteState(u.navigation); }
  movementInput(id:string,goal:Point){
    const u=this.controllable([id])[0];if(!u)return;
    const tower=occupiedTower(this.economy.state,u.id);
    const exit=tower?towerExit(this.economy.state,tower,this.solids(),this.neighbours(u).map(n=>({kind:'circle' as const,...n.position,radius:n.radius}))):undefined;
    if(tower&&!exit)return;
    const start=exit??u.position;
    return {start:{x:start.x,z:start.z},goal:{x:goal.x,z:goal.z},radius:fighterRadius(u),bounds:WORLD_BOUNDS,solids:this.solids(),
      neighbours:this.reservations(u).map(n=>({position:{x:n.position.x,z:n.position.z},radius:n.radius,destination:n.destination?{x:n.destination.x,z:n.destination.z}:undefined})),exit};
  }
  private movePlan(u:Fighter,goal:Point,exact:boolean,prepared?:readonly Point[],waitForArrival=false){
    const p=this.movementInput(u.id,goal);if(!p)return;
    if(waitForArrival)p.neighbours=[];
    const path=prepared?validateNavigation(p,prepared):exact?planWorkApproach(p.start,[goal],p.radius,p.bounds,p.solids,p.neighbours)
      :planMoveDestination(p.start,goal,p.radius,p.bounds,p.solids,p.neighbours);
    return path!==undefined?{path,exit:p.exit}:undefined;
  }
  canMoveTo(id:string,point:Point,waitForArrival=false){
    const u=this.controllable([id])[0];
    return !!u&&Number.isFinite(point.x)&&Number.isFinite(point.z)&&!!this.movePlan(u,point,true,undefined,waitForArrival);
  }
  move(ids: readonly string[], point: Point, retreat = false, rest = false, preserveTower = false, exact = false,prepared?:readonly Point[],waitForArrival=false) {
    let accepted = 0;
    for (const u of this.state.units.filter(u => ids.includes(u.id) && u.team === 'home' && u.life !== 'defeated')) {
      const requested = retreat ? u.home : point;
      if (!Number.isFinite(requested.x) || !Number.isFinite(requested.z)) continue;
      // Picking returns a Babylon Vector3 whose x/z are prototype accessors.
      // Copy coordinates explicitly before pathfinding: a direct path retains
      // its destination, and spreading a Vector3 loses x/z in live goals/saves.
      const goal: Point = { x: requested.x, z: requested.z };
      const tower=assignedTower(this.economy.state,u.id),plan=this.movePlan(u,goal,rest||exact,prepared,waitForArrival);
      if(!plan||plan.path===null&&!exact&&!rest)continue;
      const {exit}=plan,path=plan.path??[];
      if(exit)u.position={...exit};
      if(tower){if(rest){tower.phase='meal';}else if(!preserveTower)releaseTower(this.economy.state,u.id);this.economy.revision++;}
      // Cancelling the windup never refunds the committed cooldown.
      u.attack = undefined; u.target = undefined; u.commandTarget=undefined; u.order = rest ? 'rest' : retreat ? 'retreat' : 'move';
      if (!rest) this.manual(u.id,preserveTower);
      const destination = path.at(-1) ?? goal;
      u.attackApproach = undefined; u.goal = { x: destination.x, z: destination.z }; u.route = path; u.planIn = 0; resetRouteState(u.navigation); accepted++;
    }
    return accepted;
  }
  private manual(id: string,preserveTower=false) {
    if(!preserveTower&&assignedTower(this.economy.state,id)?.phase!=='occupied')releaseTower(this.economy.state,id);
    this.unit(id)!.defendFrom = undefined;this.unit(id)!.commandTarget=undefined;
    if (this.economy.active(id)?.kind === 'supply') this.economy.interrupt(this.unit(id)!.position, id);
    const v = this.economy.state.vitals[id]; v.rest = undefined; v.manualUntil = this.economy.state.seconds + VITAL_CONFIG.manualGrace;
  }
  attack(ids: readonly string[], target: string) {
    const foe = this.target(target); if (!foe || foe.life !== 'active') return 0;
    let accepted = 0;
    for (const u of this.controllable(ids)) {
      if (!hostile(u, foe)) continue;
      // Repeated attack clicks do not restart or accelerate an attack.
      this.manual(u.id); if (u.target !== foe.id) { u.attack = undefined; this.stop(u); }
      u.order = 'attack'; u.commandTarget=foe.id; u.target = foe.id; u.goal = undefined; accepted++;
    }
    return accepted;
  }
  guard(ids: readonly string[]) {
    for (const u of this.controllable(ids)) { this.manual(u.id); u.order = 'guard'; u.goal = undefined; u.target = undefined; u.attack = undefined; this.stop(u); }
  }
  private retaliationTarget(u: Fighter, source: CombatTarget): CombatTarget | undefined {
    if (this.canTarget(u, source)) return source;
    const tower = occupiedTower(this.economy.state, source.id);
    return tower ? this.target(tower.id) : undefined;
  }
  private canRetaliate(u: Fighter, current: CombatTarget | undefined, aggressor:CombatTarget) {
    if (u.attack || u.team === 'home' && u.order === 'attack' && current?.life === 'active' && this.canStrike(u,current)) return false;
    return !current || current.life !== 'active' || !this.canTarget(u, current) || u.team==='home'&&u.order==='attack'&&!this.canStrike(u,current)&&!u.targetSwitchIn&&this.canStrike(u,aggressor)
      || !current.canAttack && !this.canStrike(u, current) && !(u.targetSwitchIn ?? 0);
  }
  /** Both soldiers and wolves can stop a chase to engage a reachable fighter.
   * Keep an attackable opponent and finish a committed action before switching. */
  nearbyOpponent(u: Fighter, current: CombatTarget | undefined) {
    if (!current && !u.provoked || u.attack || current?.life === 'active' && ((u.targetSwitchIn ?? 0) > 0 || this.canStrike(u, current))) return;
    const radius=this.alertRange(u);
    return chooseTarget(u, this.nearbyTargets(u,radius), radius,
      t => t.id !== current?.id && t.canAttack && t.kind !== 'building' && this.canTarget(u, t) && this.canStrike(u, t));
  }
  private damage(victim: CombatTarget, amount: number, sourceId: string, ignoreArmor = false) {
    const source = this.target(sourceId);
    if (victim.life !== 'active' || source && !hostile(victim, source)) return;
    const beforeHP=victim.hp;
    const hitPoint={x:victim.position.x,y:surfaceHeight(victim.position.x,victim.position.z)+(victim.elevation??0)+(victim.kind==='building'?3:this.unit(victim.id)?.role==='cavalry'?3:2.2),z:victim.position.z};
    const report=(remaining:number)=>{const amount=beforeHP-Math.max(0,remaining);if(amount>0)this.damageFeedback?.({target:victim.id,amount,team:victim.team,point:hitPoint});};
    if(victim.kind==='building'){
      const building=buildingInfo(this.economy.state,victim.id)!,damage=hitDamage(amount,building.armor);
      if(building.kind==='tower')damageTower(this.economy,victim.id,damage,(id,fall)=>{const target=this.target(id)!;this.damage(target,fall,'tower-collapse',true);});
      else this.economy.damageBuilding(victim.id,damage);
      report(buildingInfo(this.economy.state,victim.id)?.hp??0);
      this.awardDamage(sourceId, building.hp - (buildingInfo(this.economy.state, victim.id)?.hp ?? 0));
      if(!buildingInfo(this.economy.state,victim.id)?.hp){
        for(const u of [...this.state.units,...this.threats]){
          if(u.target===victim.id){u.target=undefined;this.stop(u);}
          if(u.attack?.target===victim.id)u.attack=undefined;
        }
        this.state.projectiles=this.state.projectiles.filter(p=>p.target!==victim.id);
      }
      return;
    }
    const target = this.unit(victim.id);
    if (!target) {
      changeHealth(this.economy.state, victim.id, -hitDamage(amount));
      report(this.economy.state.vitals[victim.id].hp!);
      this.awardDamage(sourceId, beforeHP - this.economy.state.vitals[victim.id].hp!);
      this.economy.state.vitals[victim.id].hurtUntil = this.economy.state.seconds + 3;
      this.economy.state.vitals[victim.id].lastAttack={source:sourceId,at:this.economy.state.seconds};
      if (!this.economy.state.vitals[victim.id].hp) {
        this.economy.interrupt(victim.position, victim.id);
        if (RESIDENTS.find(r => r.id === victim.id)?.effects?.includes('leader')) this.economy.setLeadership(false);
        delete this.economy.state.raids.evading[victim.id];
        if (this.economy.state.residents[victim.id]) this.economy.state.residents[victim.id].manualGoal = undefined;
      }
      this.economy.revision++; return;
    }
    target.hp = Math.max(0, target.hp - hitDamage(amount, ignoreArmor ? 0 : this.stats(target).armor));
    report(target.hp);
    if (enemyDefinitions.has(target.id) && target.hp < beforeHP) target.pursuitQuiet = 0;
    this.awardDamage(sourceId, beforeHP - target.hp);
    target.hurtAt = this.economy.state.seconds;
    if (target.role === 'wolf') {
      const aggressor = source && this.retaliationTarget(target, source), current = target.target ? this.target(target.target) : undefined;
      if (aggressor?.team === 'home' && aggressor.life === 'active' && target.hp < beforeHP
        && this.canRetaliate(target, current, aggressor)) {
        if (current && current.id !== aggressor.id) target.targetSwitchIn = C.targetSwitchSeconds;
        target.target = aggressor.id;
        target.provoked ??= { from: { ...target.position }, leash: Math.max(RAID_CONFIG.chase, distance(target.position, aggressor.position)) + C.campPursuit.buffer };
        this.stop(target); target.planIn = 0;
      }
      if (!target.hp) { target.life = 'defeated'; target.provoked = undefined; target.diedAt = this.economy.state.seconds; target.attack = undefined; target.target = undefined; this.stop(target); }
      return;
    }
    this.economy.state.vitals[target.id].hurtUntil = this.economy.state.seconds + 3;
    if (target.hp) {
      const aggressor = source && this.retaliationTarget(target, source), current = target.target ? this.target(target.target) : undefined;
      // Damage is its own trigger. Home movement keeps player authority; enemy
      // automatic approaches/returns can respond even outside passive alert.
      const commanded = target.team === 'home' && (['move', 'retreat'].includes(target.order) || target.order === 'hold' && !!target.goal);
      if (target.hp < beforeHP && aggressor?.life === 'active' && hostile(target, aggressor) && !commanded
        && !(target.team === 'enemy' && target.order === 'retreat')
        && this.canRetaliate(target, current, aggressor)) {
        if (current && current.id !== aggressor.id) target.targetSwitchIn = C.targetSwitchSeconds;
        this.economy.interrupt(target.position, target.id);
        this.economy.state.vitals[target.id].rest = undefined;
        if (target.team === 'enemy') target.provoked ??= { from: { ...target.position },
          leash: Math.max(C.chase, distance(target.position, aggressor.position)) + C.campPursuit.buffer };
        target.defendFrom ??= { ...target.position };
        target.order = target.commandTarget?'attack':'guard'; target.targetSwitchIn=C.targetSwitchSeconds; target.target = aggressor.id; target.goal = undefined;
        this.stop(target); target.planIn = 0;
      }
      return;
    }
    this.economy.interrupt(target.position, target.id);
    this.economy.state.vitals[target.id].rest = undefined;
    this.stop(target); target.provoked = undefined; target.attack = undefined; target.target = undefined; target.goal = undefined;
    target.commandTarget=undefined;target.life = 'defeated'; target.diedAt = this.economy.state.seconds;
    const tower=occupiedTower(this.economy.state,target.id);
    if(tower){target.deathElevation=TOWER_CONFIG.height;target.deathTower=tower.id;}
    releaseTower(this.economy.state,target.id);this.economy.revision++;
    for (const id of bodiesFor(target.id)) {
      const vital = this.economy.state.vitals[id]; if (vital) { vital.rest = undefined; vital.meal = undefined; }
    }
    target.order = 'hold'; target.planIn = 0;
    if(target.id.startsWith('enemy-raid-'))this.economy.dropReward(target.position,{food:2,wood:1},false);
  }
  movementRoute(u:Fighter):readonly Point[]{return u.attackApproach?u.route.slice(0,-1):u.route;}
  movementDestination(u:Fighter):Point|undefined{
    if(!u.attackApproach||!u.target)return;
    const target=this.target(u.target);
    // Detour decelerates near its goal. Chase the opponent's feet when that
    // final segment is walkable; combat still stops at the unchanged reach.
    // Elevated/blocked targets retain their validated approach destination.
    if(target?.life==='active'&&!target.elevation&&segmentIsClear(u.attackApproach,target.position,fighterRadius(u),WORLD_BOUNDS,this.solids()))return target.position;
  }
  private travel(u: Fighter, dt: number) {
    // One route includes the target anchor, but its occupied feet are not a
    // walking destination. Replan/yield along the same reachable prefix, then
    // restore the anchor before rendering. Range/LOS can stop movement earlier.
    const anchor = u.attackApproach ? u.route.pop() : undefined;
    const step = stepRoute(u.id, u.position, u.route, u.navigation, dt, fighterMovementSpeed(u), fighterRadius(u), WORLD_BOUNDS, this.solids(), navigationRuntime()?.batched?[]:this.neighbours(u));
    if (anchor) u.route.push(anchor);
    u.position = step.position; u.speed = step.distance / dt;
    if (step.facing !== undefined) u.facing = turnTowards(u.facing, step.facing, dt, u.role === 'cavalry' ? 7 : 14);
    if (step.unreachable) { this.stop(u); u.planIn = 1; }
    // Crowd avoidance may keep circling an occupied endpoint instead of fully
    // stopping. Recheck its reservation on approach, not just after zero speed.
    // Keep the movement intent and let Detour choose a nearby stop.
    if(u.order==='move'&&u.goal&&!u.planIn&&!assignedTower(this.economy.state,u.id)
      &&(u.navigation.waited>=.6||distance(u.position,u.goal)<2.5)
      &&this.neighbours(u).some(n=>!n.moving&&distance(u.goal!,n.position)<fighterRadius(u)+n.radius+.08)){
      this.stop(u);u.planIn=0;
    }
  }
  private plan(u: Fighter, points: Point[],nearby?:Point) {
    const intent=`${u.order}/${u.target??''}/${u.goal?.x}/${u.goal?.z}`;
    // The tower already reserves its sole garrison. A transient person at the
    // ladder is handled by the normal collision/yield follower, not a failed
    // endpoint reservation. Static obstacles still participate in every sweep.
    const solids=this.solids(),neighbours=assignedTower(this.economy.state,u.id)?.phase==='approach'?[]:this.reservations(u,points.length?{point:points[0],radius:Math.max(12,...points.map(p=>distance(p,points[0])))}:undefined),radius=fighterRadius(u);
    let pending=this.planning.get(u.id);
    if(!pending||pending.intent!==intent)pending={intent,start:{...u.position},points,nearby:nearby&&{...nearby},solids,
      neighbours:neighbours.map(n=>({position:{x:n.position.x,z:n.position.z},radius:n.radius,destination:n.destination&&{...n.destination}}))};
    // Keep the outstanding crowd snapshot stable; validate the reply against
    // live occupancy. Moving front ranks must not invalidate every request.
    let path=planWorkApproach(pending.start,pending.points,radius,WORLD_BOUNDS,pending.solids,pending.neighbours);
    if(path===undefined&&pending.nearby)path=planMoveDestination(pending.start,pending.nearby,radius,WORLD_BOUNDS,pending.solids,pending.neighbours);
    if(path===null){this.planning.set(u.id,pending);u.planIn=.05;return false;}
    this.planning.delete(u.id);u.planIn=.8;u.attackApproach=undefined;
    u.route=path?validateNavigation({start:u.position,goal:path.at(-1)!,radius,bounds:WORLD_BOUNDS,solids,neighbours},path)??[]:[];
    if(u.order==='move'&&u.route.length)u.goal={...u.route.at(-1)!};
    return true;
  }
  private sampleMotion(dt: number) {
    const next = new Map<string, { position: Point; velocity: Point }>();
    for (const target of this.targets().filter(t => t.life === 'active')) {
      const previous = this.motion.get(target.id), unit = this.unit(target.id);
      const speed = unit ? fighterStats(unit).speed : 10;
      let velocity = { x: 0, z: 0 };
      if (previous) {
        velocity = { x: (target.position.x - previous.position.x) / this.motionStep, z: (target.position.z - previous.position.z) / this.motionStep };
        // Repositioning/teleports are not a useful motion estimate.
        if (Math.hypot(velocity.x, velocity.z) > speed + .1) velocity = { x: 0, z: 0 };
      } else if (unit && unit.route.length > (unit.attackApproach ? 1 : 0) && !unit.attack && !unit.navigation.waiting) {
        const goal = unit.route[0], length = distance(unit.position, goal);
        if (length > 1e-6) velocity = { x: (goal.x - unit.position.x) * speed / length, z: (goal.z - unit.position.z) * speed / length };
      }
      next.set(target.id, { position: { ...target.position }, velocity });
    }
    this.motion = next; this.motionStep = dt;
  }
  private targetMotion(target: CombatTarget) {
    const velocity = this.motion.get(target.id)?.velocity ?? { x: 0, z: 0 };
    const unit = this.unit(target.id);
    const end = unit && unit.route.length === (unit.attackApproach ? 2 : 1) ? fighterDestination(unit) : undefined;
    const speed = Math.hypot(velocity.x, velocity.z), length = end ? distance(target.position, end) : 0;
    const stop = end && length > 1e-6 && speed > .01
      && ((end.x - target.position.x) * velocity.x + (end.z - target.position.z) * velocity.z) / (length * speed) > .995 ? end : undefined;
    return { velocity, speed, stop };
  }
  private forecast(target: CombatTarget, seconds: number) {
    const { velocity, speed, stop } = this.targetMotion(target);
    if (stop && distance(target.position, stop) <= speed * seconds) return stop;
    return { x: target.position.x + velocity.x * seconds, z: target.position.z + velocity.z * seconds };
  }
  private canStrike(u: Fighter, target: CombatTarget) {
    return distance(u.position, target.position) <= this.reach(u, target)
      && this.visible(u.position, target.position, u.id, target.id)
      && distance(u.position, this.forecast(target, this.stats(u).windup + .05)) <= this.reach(u, target)
        + (u.role === 'archer' ? .05 : MELEE_CONTACT_GRACE - .05);
  }
  private pursue(u: Fighter, target: CombatTarget, dt: number) {
    const range = this.reach(u, target), stats = this.stats(u);
    const radius = Math.max(fighterContactRadius(u) + (target.contactRadius ?? target.radius) + .12,
      // Allow one step for contact quantization and one for the target moving
      // after this approach point was sampled (either faction's update order).
      Math.min(range * .8, range - this.targetMotion(target).speed * (stats.windup + .1) - .1));
    const length = distance(u.position, target.position) || 1;
    const direct = { x: target.position.x + (u.position.x - target.position.x) * radius / length,
      z: target.position.z + (u.position.z - target.position.z) * radius / length };
    const neighbours = this.reservations(u,{point:{x:(u.position.x+target.position.x)/2,z:(u.position.z+target.position.z)/2},radius:length/2+range});
    // Refresh a clear direct approach every simulation step; no A* is needed
    // to follow an opponent running through open ground. Keep detours when
    // crowds or solids obstruct it, and retain the shared swept collision check.
    const obstacles=combineObstacles(this.solids(),neighbours.map(n=>bodyObstacle(n.position,n.radius)));
    const directClear=segmentIsClear(u.position,direct,fighterRadius(u),WORLD_BOUNDS,obstacles);
    if (u.attackApproach && distance(u.attackApproach,target.position)<=range && !this.visible(u.attackApproach, target.position, u.id, target.id)) u.planIn = 0;
    if (this.visible(direct, target.position, u.id, target.id) && !occupiedApproach(direct, fighterRadius(u), neighbours) && directClear) {
      this.planning.delete(u.id);
      u.attackApproach = direct;
      u.route = [direct, { x: target.position.x, z: target.position.z }];
    } else if (u.planIn <= 0) {
      const points = Array.from({ length: 12 }, (_, i) => ({ x: target.position.x + Math.cos(i * Math.PI / 6) * radius,
        z: target.position.z + Math.sin(i * Math.PI / 6) * radius }))
        .filter(p => this.visible(p, target.position, u.id, target.id));
      const completed=this.plan(u, points,target.position);
      if (completed && u.route.length) {
        u.attackApproach = { ...u.route.at(-1)! };
        u.route.push({ x: target.position.x, z: target.position.z });
      }
    } else if (u.attackApproach && u.route.length) {
      u.route[u.route.length - 1] = { x: target.position.x, z: target.position.z };
    }
    // The normal strike test stops us early on this shared route; its target
    // anchor also works when the feet are on a tower or across a river.
    this.travel(u, dt);
  }
  update(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.syncUnits();
    // Bound catch-up. The game feeds the same active delta to every system.
    let remaining = Math.min(seconds, .25);
    while (remaining > 1e-8) {
      const dt = Math.min(remaining, .05); this.beginFrame(dt);
      try{this.tick(dt);}finally{this.frameTargets=undefined;this.frameNeighbours.clear();}
      remaining -= dt;
    }
  }
  private tick(dt: number) {
    this.sampleMotion(dt);
    for (const shot of [...this.state.projectiles]) {
      shot.elapsed += dt;
      if (shot.elapsed < shot.duration) continue;
      this.state.projectiles.splice(this.state.projectiles.indexOf(shot), 1);
      const target = this.target(shot.target);
      // A shot lands at its committed point. A moving target can dodge it.
      if (target && distance(target.position, shot.to) < .8 && this.visible(shot.from,shot.to,shot.source,shot.target)) this.damage(target, shot.damage, shot.source);
    }
    for (const u of this.state.units) {
      const stats = this.stats(u);
      u.speed = 0; u.cooldown = u.cooldown <= dt + 1e-8 ? 0 : u.cooldown - dt; u.planIn = Math.max(0, u.planIn - dt);
      if (u.targetSwitchIn) u.targetSwitchIn = Math.max(0, u.targetSwitchIn - dt);
      if (u.life === 'defeated'||u.departed) continue;
      if (u.team === 'home') for (const camp of this.state.camps) { const definition = ENCOUNTERS.find(c => c.id === camp.id)!; if (distance(u.position, definition) < definition.discover) camp.discovered = true; }
      // Commands to move and a return to the engagement anchor take priority.
      const stationary=!!occupiedTower(this.economy.state,u.id);
      const returning = u.order === 'hold' && !!u.goal;
      let target = u.target ? this.target(u.target) : undefined;
      if (u.target && (!target || target.life !== 'active')) { target = undefined; u.target = undefined; this.stop(u); }
      if(target&&(!this.canTarget(u,target)||stationary&&(distance(u.position,target.position)>TOWER_CONFIG.range||!this.visible(u.position,target.position,u.id,target.id)))){target=undefined;u.target=undefined;u.attack=undefined;this.stop(u);}
      if(stationary){u.route=[];u.attackApproach=undefined;u.goal=undefined;}
      if(u.team==='home'&&u.order==='attack'){
        const requested=u.commandTarget?this.target(u.commandTarget):undefined;
        if(!requested||requested.life!=='active')u.commandTarget=undefined;
        if(!u.attack&&(!target||!(u.targetSwitchIn??0))){
          const next=requested?.life==='active'&&this.canStrike(u,requested)?requested
            :(!target||!this.canStrike(u,target))?(this.nearbyOpponent(u,target??requested)??(requested?.life==='active'?requested:undefined)):undefined;
          if(next&&next.id!==target?.id){target=next;u.target=next.id;u.targetSwitchIn=C.targetSwitchSeconds;this.stop(u);u.planIn=0;}
        }
      }
      const explicit = u.order === 'attack' && (target?.life === 'active'||!!u.commandTarget);
      if (!explicit && !returning && !['move', 'retreat', 'rest'].includes(u.order)) {
        const nearby = this.nearbyOpponent(u, target);
        if (nearby) {
          target = nearby; u.target = nearby.id; u.targetSwitchIn = C.targetSwitchSeconds;
          this.stop(u); u.planIn = 0;
        }
      }
      const anchor = u.team === 'enemy' ? u.provoked?.from ?? this.camp(u) : u.defendFrom ?? u.position;
      const leash = u.team === 'enemy' ? u.provoked?.leash ?? Math.max(C.chase, this.camp(u).leash) : C.chase;
      const campGuard = u.team === 'enemy' && enemyDefinitions.has(u.id);
      const opponent = target?.life === 'active' ? target : undefined;
      if (u.provoked && !opponent && !u.attack && !returning && u.order !== 'retreat') {
        u.goal = { ...u.home }; u.order = 'hold'; u.target = undefined; this.stop(u); continue;
      }
      const outside = distance(u.position, anchor) > leash || !!opponent
        && (distance(opponent.position, anchor) > leash || distance(u.position, opponent.position) > (u.provoked?.leash ?? C.chase));
      let disengage = !campGuard && !!target && outside;
      if (campGuard && !explicit && !returning) {
        const close = opponent && distance(u.position, opponent.position) <= Math.max(C.campPursuit.closeRange, this.reach(u, opponent))
          && this.visible(u.position, opponent.position, u.id, opponent.id);
        u.pursuitQuiet = outside && !close ? Math.min(C.campPursuit.quietSeconds, (u.pursuitQuiet ?? 0) + dt) : 0;
        disengage = distance(u.position, anchor) > leash + (u.provoked ? 0 : C.campPursuit.buffer)
          || !!opponent && distance(opponent.position, anchor) > leash + (u.provoked ? 0 : C.campPursuit.buffer)
          || outside && u.pursuitQuiet >= C.campPursuit.quietSeconds - 1e-8;
      }
      if (!explicit && !returning && disengage) {
        u.goal = u.team === 'enemy' ? { ...u.home } : { x: anchor.x, z: anchor.z }; u.order = 'hold'; u.target = undefined; u.attack = undefined;
        u.pursuitQuiet = undefined;
        this.stop(u); continue;
      }
      if (!['move', 'retreat'].includes(u.order) && !returning && !explicit) {
        if (!target || target.life !== 'active' || !hostile(u, target)) target = undefined;
        // Existing opponents were evaluated above using actual attack reach,
        // not just alert range. Acquire normally only when no target remains.
        if (!target) {
          const radius=this.alertRange(u);
          const candidate = chooseTarget(u, this.nearbyTargets(u,radius), radius, t => this.canTarget(u,t) && distance(t.position, anchor) <= leash
            && this.visible(u.position,t.position,u.id,t.id));
          if (candidate) target = candidate;
        }
        if (target) {
          if (u.target !== target.id || this.economy.state.vitals[u.id].rest) {
            this.economy.interrupt(u.position, u.id); this.economy.state.vitals[u.id].rest = undefined;
            u.attack = undefined; this.stop(u);
          }
          u.defendFrom ??= { x: anchor.x, z: anchor.z };
          u.target = target.id; u.order = 'guard'; u.goal = undefined;
        } else { u.target = undefined; u.attack = undefined; u.defendFrom = undefined; }
      }
      if (returning && campGuard) {
        const nearby = (t: CombatTarget) => this.canTarget(u, t)
          && distance(u.position, t.position) <= Math.min(C.campPursuit.returnAttackRange, this.reach(u, t))
          && this.visible(u.position, t.position, u.id, t.id);
        target = opponent && nearby(opponent) ? opponent : chooseTarget(u, this.nearbyTargets(u,C.campPursuit.returnAttackRange), C.campPursuit.returnAttackRange, nearby);
        u.target = target?.id;
      }
      // A returning guard may strike in place, but keeps its home destination
      // and resumes that route during cooldown. Never pursue from this state.
      const returnStrike = returning && campGuard && (!!u.attack
        || !!target && !u.cooldown && distance(u.position, u.goal!) > .15 && this.canStrike(u, target));
      if (u.order === 'move' || u.order === 'retreat' || u.order === 'rest' || returning && !returnStrike) {
        if (u.goal && distance(u.position, u.goal) > .15) {
          if (!u.route.length && u.planIn <= 0) this.plan(u, [u.goal],u.order==='move'?u.goal:undefined);
          this.travel(u, dt);
        } else { this.stop(u); u.goal = undefined; u.order = 'guard'; if (returning) { u.defendFrom = undefined; u.target = undefined; u.pursuitQuiet = undefined; u.provoked = undefined; } }
        continue;
      }
      if (!target && this.economy.state.vitals[u.id]?.rest) continue;
      if (u.attack) {
        const action = u.attack; action.elapsed += dt;
        const victim = this.target(action.target);
        if (victim) this.face(u,victim.position,dt);
        if (!action.released && action.elapsed >= stats.windup) {
          action.released = true;
          if (victim?.life === 'active' && distance(u.position, victim.position) <= this.reach(u, victim) + (u.role === 'archer' ? .15 : MELEE_CONTACT_GRACE)
            && this.visible(u.position,victim.position,u.id,victim.id)) {
            if (u.role !== 'archer') this.damage(victim, stats.attack, u.id);
            else {
              const { velocity, stop } = this.targetMotion(victim);
              let aim = leadShot(u.position, victim.position, velocity, C.projectileSpeed, stop);
              if (!this.visible(u.position, aim.point, u.id, victim.id)) aim = leadShot(u.position, victim.position, { x: 0, z: 0 }, C.projectileSpeed);
              this.state.projectiles.push({ id: action.id, source: u.id, target: victim.id, from: { ...u.position,y:surfaceHeight(u.position.x,u.position.z)+towerHeight(this.economy.state,u.id)+1.25 }, to: { ...aim.point,y:surfaceHeight(victim.position.x,victim.position.z)+(victim.elevation??0)+1.25 },
                elapsed: 0, duration: aim.duration, damage: stats.attack });
            }
          }
        }
        if (action.elapsed + 1e-8 < stats.windup + stats.recovery) continue;
        u.attack = undefined;
        if (returning) { u.target = undefined; continue; }
        target = u.target ? this.target(u.target) : undefined;
        // Re-evaluate immediately at the end of recovery; do not add a hidden
        // simulation step to every attack cycle.
      }
      if (!target || target.life !== 'active') {
        u.target = undefined;
        if(u.id.startsWith('enemy-raid-')&&u.goal) {
          if(distance(u.position,u.goal)>.2){if(!u.route.length&&u.planIn<=0)this.plan(u,[u.goal]);this.travel(u,dt);}
          else {this.stop(u);u.goal=undefined;}
          continue;
        }
        const patrol = u.team === 'enemy' ? this.camp(u).patrol : [];
        if (patrol.length) {
          const offset = Number(u.id.slice(-1)) * 1.1;
          const index = Math.floor(this.economy.state.seconds / 12) % patrol.length;
          const goal = { x: patrol[index].x + offset, z: patrol[index].z };
          if (distance(u.position, goal) > .5 && u.planIn <= 0 && !u.route.length) { this.plan(u, [goal]); u.planIn = 3; }
          this.travel(u, dt);
        } else this.stop(u);
        if (u.order === 'attack'&&!u.commandTarget) u.order = 'guard'; continue;
      }
      // Plant the feet only when the target is expected to remain within reach
      // at contact, including only the bounded committed-swing allowance.
      let canStrike=this.canStrike(u,target);
      if(!canStrike&&!stationary&&!returning){
        this.pursue(u,target,dt);
        // The target may already have advanced this tick (wolves update
        // before soldiers). Test again from our accepted Crowd position;
        // otherwise a reachable runner can stay one simulation step ahead.
        canStrike=this.canStrike(u,target);
      }
      if (canStrike) {
        this.stop(u); this.face(u,target.position,dt);
        if (!u.cooldown) { u.cooldown = stats.interval; u.attack = { id: this.state.nextAttack++, target: target.id, elapsed: 0, released: false }; }
      } else if(stationary || returning){this.stop(u);u.target=undefined;}
    }
    // Later units in the simulation order may have moved since pursuit was
    // planned. Keep the shared terminal anchor at this step's target position.
    for (const u of this.state.units) if (u.attackApproach && u.route.length && u.target) {
      const target = this.target(u.target);
      if (target?.life === 'active') {
        const previous=u.route.at(-1)!;
        // Keep a direct approach relative to the same target snapshot as its
        // visible anchor. The next shared Crowd step must not steer toward a
        // point one tick behind an opponent that moved later in this step.
        if(u.route.length===2){const next={x:u.route[0].x+target.position.x-previous.x,z:u.route[0].z+target.position.z-previous.z};
          if(segmentIsClear(u.position,next,fighterRadius(u),WORLD_BOUNDS,this.solids())){u.route[0]=next;u.attackApproach=next;}}
        u.route[u.route.length-1]={x:target.position.x,z:target.position.z};
      }
    }
    for (const camp of this.state.camps) {
      if(MAP_DEVELOPMENT)continue;
      const config = ENCOUNTERS.find(c => c.id === camp.id)!;
      const units = this.state.units.filter(u => u.team === 'enemy' && enemyDefinitions.get(u.id)?.camp === camp.id);
      if (!camp.cleared && units.every(u => u.life === 'defeated')) {
        camp.cleared = camp.discovered = true;
        camp.respawnAt = config.repeat ? this.economy.state.seconds + config.repeat : 0;
      }
      if (camp.cleared && !camp.rewardGranted) {
        camp.rewardGranted = true;
        this.state.rewardGoods.push(...this.economy.dropReward(config, config.reward));
      }
      if (camp.cleared && config.repeat && this.economy.state.seconds >= camp.respawnAt
        && ![...this.civilians().map(n => n.position), ...Object.values(this.economy.state.residents).map(r => r.position), ...this.state.units.filter(u => u.team === 'home').map(u => u.position)]
          .some(p => distance(p, config) < config.leash + 8)
        && !this.economy.state.sites.some(s => distance(s, config) < config.leash + 8)) {
        // Patrol routes only. Captured construction regions never repopulate.
        camp.cleared = camp.rewardGranted = false; camp.cycle++;
        for (const u of units) { u.experience = 0; u.hp = fighterStats(u).hp; u.life = 'active'; u.diedAt = undefined; u.order = 'guard'; u.position = { ...u.home }; u.cooldown = 0; this.economy.state.vitals[u.id].stamina = 100; this.economy.state.vitals[u.id].hurtUntil = 0; }
      }
    }
    this.state.discovered = this.state.camps.some(c => c.discovered);
    this.state.cleared = this.state.camps.every(c => c.cleared);
    this.state.rewardGranted = this.state.cleared;
    this.state.rewardGoods = this.state.rewardGoods.filter(id => this.economy.state.goods.some(g => g.id === id));
  }
}

/** Strict fixed-unit and external-target save validation. Reject malformed state instead of silently healing,
 * resetting cooldowns, or minting another outpost reward. */
export function decodeCombat(raw: CombatState, threats: readonly Fighter[] = [], residents:readonly ResidentDefinition[]=RESIDENTS,towers:readonly {id:string}[]=[],debug=false): CombatState {
  const raiders=(Array.isArray(raw?.units)?raw.units:[]).filter(u=>u.id?.startsWith('enemy-raid-'));
  if(raiders.length>(debug?DEBUG_RAID_CONFIG.maxSoldiers:RAID_CONFIG.maxSoldiers)||raiders.some(u=>!/^enemy-raid-(infantry|archer|cavalry)-[1-9]\d*-(?:[0-9]|1[01])$/.test(u.id)||u.id.split('-')[2]!==u.role||!u.home))throw new Error('敌袭人物存档无效');
  const initial = initialCombat([...residents,...ENEMIES,...raiders.map(u=>newResident(u.role as 'infantry'|'archer'|'cavalry',u.id,u.home))]);
  const opponents = [...initial.units, ...threats, ...(Array.isArray(towers)?towers:[]).map(t=>({id:t.id,team:'home' as const})), ...residents.filter(r => !initial.units.some(u => u.id === r.id)).map(r => ({ id: r.id, team: 'home' as const }))];
  const num = (x: number, max = 1e9) => Number.isFinite(x) && x >= 0 && x <= max;
  const height = (y: unknown) => typeof y === 'number' && num(y + 5, 40);
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= WORLD_BOUNDS.maxX && Math.abs(p.z) <= WORLD_BOUNDS.maxZ;
  // A 200-person army may have more than 96 arrows in flight. Bound saves by
  // roster size and the validated three-second lifetime / attack cadence.
  const projectileLimit=Math.max(96,initial.units.length*(Math.ceil(3/Math.min(C.archer.interval,C.enemyArcher.interval))+1));
  if (!raw || !Array.isArray(raw.units) || raw.units.length !== initial.units.length || !Array.isArray(raw.projectiles) || raw.projectiles.length > projectileLimit
    || !Number.isSafeInteger(raw.nextAttack) || raw.nextAttack < 1 || typeof raw.discovered !== 'boolean' || typeof raw.cleared !== 'boolean'
    || typeof raw.rewardGranted !== 'boolean' || raw.rewardGranted !== raw.cleared || !Array.isArray(raw.rewardGoods) || raw.rewardGoods.length > 1000
    || new Set(raw.rewardGoods).size !== raw.rewardGoods.length || !raw.rewardGoods.every(id => /^goods-\d+$/.test(id))) throw new Error('战斗存档无效');
  if (!Array.isArray(raw.camps) || raw.camps.length !== ENCOUNTERS.length || new Set(raw.camps.map(c => c.id)).size !== ENCOUNTERS.length
    || raw.camps.some(c => !ENCOUNTERS.some(d => d.id === c.id) || typeof c.cleared !== 'boolean' || typeof c.discovered !== 'boolean'
      || c.rewardGranted !== c.cleared || !num(c.respawnAt, 1e12) || !Number.isSafeInteger(c.cycle) || c.cycle < 0)) throw new Error('区域存档无效');
  for (const template of initial.units) {
    const units = raw.units.filter(u => u.id === template.id), u = units[0];
    if (units.length !== 1 || u.role !== template.role || u.team !== template.team || !point(u.position) || !point(u.home)
      || distance(u.home, template.home) > .001 || !num(u.experience, MAX_EXPERIENCE) || !num(u.hp, effectiveFighterStats(u, 0).hp) || !num(u.cooldown, 8) || !Number.isFinite(u.facing) || !['active', 'defeated'].includes(u.life)
      || !['guard', 'move', 'attack', 'retreat', 'hold', 'rest'].includes(u.order) || u.goal && !point(u.goal)
      || u.departed!==undefined&&(typeof u.departed!=='boolean'||!u.id.startsWith('enemy-raid-'))
      || u.deathElevation!==undefined&&(!num(u.deathElevation,6)||u.life!=='defeated'||u.role!=='archer')
      || u.deathTower!==undefined&&!towers.some(t=>t.id===u.deathTower)
      || u.diedAt !== undefined && (!num(u.diedAt, 1e12) || u.life !== 'defeated')
      || u.attackApproach && !point(u.attackApproach)
      || u.provoked && (u.team !== 'enemy' || !point(u.provoked.from) || !num(u.provoked.leash, 400))
      || u.defendFrom && !point(u.defendFrom) || u.hurtAt !== undefined && !num(u.hurtAt, 1e12)
      || u.pursuitQuiet !== undefined && (!enemyDefinitions.has(u.id) || !num(u.pursuitQuiet, C.campPursuit.quietSeconds))
      || u.targetSwitchIn !== undefined && !num(u.targetSwitchIn, C.targetSwitchSeconds)
      || u.commandTarget && (u.team!=='home'||u.order!=='attack'||!opponents.some(t=>t.id===u.commandTarget&&t.team!==u.team))
      || u.target && !opponents.some(t => t.id === u.target && t.team !== u.team)
      || (u.life === 'active') !== (u.hp > 0) || u.team === 'enemy' && !['active', 'defeated'].includes(u.life)
      || !Array.isArray(u.route) || u.route.length > 1000 || !u.route.every(point)) throw new Error('战斗人物存档无效');
    if (u.attack && (!Number.isSafeInteger(u.attack.id) || u.attack.id < 1 || u.attack.id >= raw.nextAttack
      || !num(u.attack.elapsed, 3) || typeof u.attack.released !== 'boolean' || !opponents.some(t => t.id === u.attack!.target && t.team !== u.team))) throw new Error('攻击存档无效');
    if (u.life === 'defeated') { u.commandTarget=undefined; u.order = 'hold'; u.goal = undefined; u.target = undefined; u.attack = undefined; u.route = []; }
    u.navigation = createRouteState(); u.planIn = 0; u.speed = 0;
  }
  if (raw.cleared !== raw.camps.every(c => c.cleared) || raw.camps.some(c => c.cleared !== raw.units.filter(u => ENEMIES.find(r => r.id === u.id)?.camp === c.id).every(u => u.life === 'defeated'))) throw new Error('据点存档不一致');
  const ids = new Set<number>();
  for (const p of raw.projectiles) {
    const source = raw.units.find(u => u.id === p.source), target = opponents.find(u => u.id === p.target);
    if (!source || !target || source.team === target.team || !point(p.from) || !point(p.to) || !num(p.elapsed, 3) || !num(p.duration, 3)
      // Projectile endpoints use world height, including negative basins and
      // elevated terrain/towers; they are not heights above a flat ground plane.
      || p.from.y!==undefined&&!height(p.from.y)||p.to.y!==undefined&&!height(p.to.y)
      || p.duration <= 0 || p.elapsed >= p.duration || !num(p.damage, 100) || !Number.isSafeInteger(p.id) || p.id < 1 || p.id >= raw.nextAttack || ids.has(p.id)) throw new Error('投射物存档无效');
    ids.add(p.id);
  }
  return structuredClone(raw);
}
