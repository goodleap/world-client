import { MAP_DEVELOPMENT } from './opening-profile.ts';
import { Combat, fighterRadius, fighterDestination, createFighter } from './combat.ts';
import { COMBAT_CONFIG } from './combat-config.ts';
import { RAID_CONFIG as C, newWolf, raidRandom, allWolves } from './raid-state.ts';
import type { Wolf } from './raid-state.ts';
import type { Economy } from './economy.ts';
import { newResident } from './resident-data.ts';
import { DANGER_CONFIG, updateDangerZones, pathInDanger, dangerObstacles } from './danger-zones.ts';
import type { AreaThreat } from './danger-zones.ts';
import { homeResidents } from './recruitment.ts';
import { initialVital } from './vitals.ts';
import { health } from './vitals.ts';
import { fireIsLit } from './campfire.ts';
import { BUILDINGS, LANDSCAPE, WORLD_BOUNDS } from './world-data.ts';
import { isBlocked } from './movement.ts';
import type { Point, Obstacle } from './movement.ts';
import { planMoveDestination, planWorkApproach } from './work-navigation.ts';
import { planNavigation, validateNavigation, type NavigationInput } from './navigation-plan.ts';
import { resetRouteState, stepRoute } from './route-following.ts';
import type { Neighbour } from './route-following.ts';
import { segmentIsClear } from './wander.ts';
import { chooseTarget } from './targeting.ts';
import { DebugRaids, RAID_DESTINATION } from './debug-raids.ts';

export interface RaidResidents {
  status(id: string): { position: Point; moving: boolean };
  command(point: Point, id: string, prepared?:readonly Point[]): boolean;
  movementInput?(id:string,point:Point):NavigationInput|undefined;
  release(id: string): void;
  resting(id: string, value: boolean): void;
  neighbours(): Neighbour[];
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const home = RAID_DESTINATION;
const circle = (p: Point, radius: number) => Array.from({ length: 8 }, (_, i) => ({ x: p.x + Math.cos(i * Math.PI / 4) * radius, z: p.z + Math.sin(i * Math.PI / 4) * radius }));

const spawnSpots = (origin: Point, count: number) => count <= 8 ? circle(origin, 2.5).slice(0, count)
  : Array.from({ length: count }, (_, i) => ({ x: origin.x + Math.cos(i * Math.PI * 2 / count) * 3.2,
    z: origin.z + Math.sin(i * Math.PI * 2 / count) * 3.2 }));

/** Dynamic threats share the combat hit pipeline and the swept route follower.
 * Only this controller owns wolf decisions, theft and wave settlement. */
export class Raids {
  private economy: Economy;
  private combat: Combat;
  private people: RaidResidents;
  private solids: () => readonly Obstacle[];
  private visible: (point: Point) => boolean;
  private decisions = 0;
  private areaAt = -Infinity;
  private areaSolids: Obstacle[] = [];
  private planning = new Map<string,{intent:string;start:Point;points:Point[]}>();
  private escapePlans = new Map<string,NavigationInput>();
  private warningCandidate?:{origin:Point;count:number};
  private debug: DebugRaids;
  constructor(economy: Economy, combat: Combat, people: RaidResidents, solids: () => readonly Obstacle[], visible: (point: Point) => boolean) {
    this.economy = economy; this.combat = combat; this.people = people; this.solids = solids; this.visible = visible;
    this.debug = new DebugRaids(economy,combat,solids);
    combat.setResidentPositions(id => people.status(id).position);
    this.syncThreats();
  }
  get state() { return this.economy.state.raids; }
  get wolves() { return allWolves(this.state); }
  private syncThreats() { this.combat.setThreats(this.wolves.filter(w => w.mode !== 'gone')); }
  private position(id: string) { return this.combat.target(id)?.position ?? this.people.status(id).position; }
  private fireClear(a: Point, b: Point) { return segmentIsClear(a, b, .05, WORLD_BOUNDS, this.solids().filter(o => !(o.kind === 'circle' && distance(o, b) < .01))); }
  private clear(a: Point, b: Point) { return segmentIsClear(a, b, .05, WORLD_BOUNDS, this.solids()); }
  neighbours(): Neighbour[] {
    return this.wolves.filter(w => w.life === 'active' && w.mode !== 'gone').map(w => ({ id: w.id, position: w.position,
      radius: fighterRadius(w), moving: w.speed > .08, purposeful: !!w.route.length, waiting: w.navigation.waiting }));
  }
  occupancy() { return this.neighbours().map(n => ({ kind: 'circle' as const, ...n.position, radius: n.radius })); }
  private updateAreas() {
    const now=this.economy.state.seconds;
    if(now<this.areaAt)return;
    this.areaAt=now+DANGER_CONFIG.interval;
    const units=this.combat.state.units.filter(u=>u.team==='enemy'&&u.life==='active'&&!u.departed);
    const threats:AreaThreat[]=[];
    for(const u of [...units,...this.wolves.filter(w=>w.life==='active'&&w.mode!=='gone')]) {
      threats.push({id:u.id,x:u.position.x,z:u.position.z,radius:u.role==='wolf'?C.acquire:COMBAT_CONFIG.acquire});
    }
    // Do not add another protection polling interval after an area clears.
    if (updateDangerZones(this.economy.state.dangerZones,threats,now)) this.decisions = 0;
    this.areaSolids=dangerObstacles(this.economy.state.dangerZones);
  }
  unsafePath(points:readonly Point[]){
    this.updateAreas();
    return pathInDanger(this.economy.state.dangerZones,points);
  }
  workObstacles(){this.updateAreas();return this.areaSolids;}
  canWork(id: string,manual=false) { const escape=this.state.evading[id];return (!escape||manual&&!escape.attacker) && health(this.economy.state, id) > 0; }
  manual(id: string) { delete this.state.evading[id];this.escapePlans.delete(id);this.economy.state.vitals[id].lastAttack=undefined; }
  private neighboursFor(w: Wolf) {
    return [...this.people.neighbours().map(n=>({...n,yield:undefined})), ...this.combat.state.units.filter(u => u.life !== 'defeated').map(u => ({ id: u.id, position: u.position,
      radius: fighterRadius(u),heading:u.facing, moving: u.speed > .08, purposeful: !!u.route.length, waiting: u.navigation.waiting })), ...this.neighbours().filter(n => n.id !== w.id)];
  }
  private plan(w: Wolf, points: Point[]) {
    const intent=`${w.mode}/${w.target??''}/${w.foodTarget??''}`;
    let pending=this.planning.get(w.id);
    if(!pending||pending.intent!==intent)pending={intent,start:{...w.position},points};
    const reservations = this.neighboursFor(w).map(n => ({ ...n, destination: fighterDestination(this.combat.unit(n.id)) }));
    const solids=this.solids(),radius=fighterRadius(w),path=planWorkApproach(pending.start,pending.points,radius,WORLD_BOUNDS,solids,reservations);
    if(path===null){this.planning.set(w.id,pending);w.planIn=.05;return;}
    this.planning.delete(w.id);w.planIn=.9;
    w.route=path?validateNavigation({start:w.position,goal:path.at(-1)!,radius,bounds:WORLD_BOUNDS,solids,neighbours:reservations},path)??[]:[];
  }
  private travel(w: Wolf, dt: number) {
    const result = stepRoute(w.id, w.position, w.route, w.navigation, dt, COMBAT_CONFIG.wolf.speed, fighterRadius(w), WORLD_BOUNDS, this.solids(), this.neighboursFor(w));
    w.position = result.position;
    const moved = result.distance; w.speed = moved / dt; w.gait = (w.gait + moved / 1.26) % 1;
    if (result.facing !== undefined) w.facing = result.facing;
    if (result.unreachable) { w.route = []; w.planIn = 1.5; }
  }
  private flee(w: Wolf) {
    if (w.mode === 'flee' || w.mode === 'gone') return;
    w.mode = 'flee'; w.provoked = undefined; w.target = undefined; w.foodTarget = undefined; w.attack = undefined; w.feeding = 0; w.route = []; w.planIn = 0;
    resetRouteState(w.navigation);
  }
  private spawnClear(origin: Point, spots: readonly Point[]) {
    const solids = this.solids();
    return spots.every(p => !isBlocked(p,.72,solids)
      && !this.combat.state.units.some(u=>u.life==='active'&&!u.departed&&distance(p,u.position)<fighterRadius(u)+.92)
      && !this.wolves.some(w=>w.life==='active'&&w.mode!=='gone'&&distance(p,w.position)<1.64)
      && !homeResidents(this.economy.state).some(r=>health(this.economy.state,r.id)>0&&distance(p,this.position(r.id))<16)
      && ![...BUILDINGS,...this.economy.state.sites].some(b=>distance(p,b)<12)
      && segmentIsClear(p,origin,.72,WORLD_BOUNDS,solids));
  }
  private warn() {
    const state=this.state,now=this.economy.state.seconds;
    const announce=(origin:Point,count:number)=>{
      this.warningCandidate=undefined;
      state.pendingOrigin=origin;state.pendingCount=count;state.warningAt=now;state.nextAt=Math.max(state.nextAt,now+C.warning);
      const direction=Math.abs(origin.x)>Math.abs(origin.z)?origin.x>0?'东侧':'西侧':origin.z>0?'北侧':'南侧';
      state.notice=`${direction}发现${state.wave%2?'敌兵':'狼群'} · 即将来袭`;state.noticeUntil=state.nextAt;
      this.economy.revision++;
    };
    if(this.warningCandidate){
      const {origin,count}=this.warningCandidate,route=planMoveDestination(origin,home,.72,WORLD_BOUNDS,this.solids(),[]);
      if(route===null)return;
      this.warningCandidate=undefined;
      if(route&&this.spawnClear(origin,spawnSpots(origin,count))){announce(origin,count);return;}
    }
    const defenders=this.combat.state.units.filter(u=>u.team==='home'&&u.life==='active'&&u.hp>COMBAT_CONFIG[u.role].hp*.35).length;
    const base=defenders<2?1:state.wave===0?2:Math.min(C.maxWolves,2+Math.floor(defenders/3)+this.economy.state.upgrades.arms);
    const count=state.wave%2 ? Math.min(C.maxSoldiers,base*2) : base;
    const candidates=LANDSCAPE.regions.filter(r=>r.id!=='home'&&!('camp' in r)&&distance(r,home)>32);
    const start=Math.floor(raidRandom(state)*candidates.length);
    // Prefer off-screen entrances. An overview of the entire map must not
    // indefinitely disable raids: distant announced entrances remain usable.
    for(const visible of [false,true])for(let i=0;i<candidates.length*3;i++) {
      const r=candidates[(start+i)%candidates.length],origin={x:r.x+(raidRandom(state)-.5)*16,z:r.z+(raidRandom(state)-.5)*16};
      const spots=spawnSpots(origin,count);
      if (!this.spawnClear(origin, spots) || !visible && spots.some(p => this.visible(p))) continue;
      const route=planMoveDestination(origin,home,.72,WORLD_BOUNDS,this.solids(),[]);
      if(route===null){this.warningCandidate={origin,count};return;}
      if(!route)continue;
      announce(origin,count);return;
    }
    state.nextAt=now+5+C.warning;
  }
  private spawn() {
    const state=this.state,now=this.economy.state.seconds,origin=state.pendingOrigin;
    if(!origin)return;
    const count=state.pendingCount,spots=spawnSpots(origin,count);
    const route=planMoveDestination(origin,home,.72,WORLD_BOUNDS,this.solids(),[]);
    if(route===null)return;
    if(!route||!this.spawnClear(origin, spots)) {
      state.pendingOrigin=undefined;state.pendingCount=0;state.nextAt=now+5+C.warning;return;
    }
    const old=new Set(state.soldiers);
    this.combat.state.units=this.combat.state.units.filter(u=>!old.has(u.id));
    this.combat.state.projectiles=this.combat.state.projectiles.filter(p=>!old.has(p.source)&&!old.has(p.target));
    for(const id of old){delete this.economy.state.vitals[id];delete this.economy.state.residents[id];}
    state.soldiers=[];state.wolves=[];state.wave++;state.phase='raid';state.startedAt=now;state.origin={...origin};state.pendingOrigin=undefined;state.pendingCount=0;
    if(state.wave%2)state.wolves=spots.map((p,n)=>{
      const wolf=newWolf(`wolf-${state.wave}-${n}`,p);wolf.route=[{...origin},...route.map(p=>({...p}))];return wolf;
    });
    else for(const [n,p] of spots.entries()) {
      const role=state.wave>=4&&n===0?'cavalry':n%3===2?'archer':'infantry',id=`enemy-raid-${role}-${state.wave}-${n}`;
      const unit=createFighter(newResident(role,id,p));unit.goal={...home};unit.route=[{...origin},...route.map(p=>({...p}))];
      this.combat.state.units.push(unit);this.economy.state.vitals[id]=initialVital(id);state.soldiers.push(id);
    }
    state.notice=`${state.wave%2?'灰狼':'敌兵'}来袭 · ${count}${state.wave%2?'只':'人'}正在接近`;state.noticeUntil=now+18;
    this.syncThreats();this.economy.revision++;
  }
  private protect() {
    const now = this.economy.state.seconds;
    const threats = this.combat.targets().filter(t => t.team === 'enemy' && t.life === 'active'
      && !this.wolves.some(w => w.id === t.id && ['gone', 'flee'].includes(w.mode)));
    for(const task of this.economy.state.tasks)if(task.threat&&task.status==='waiting'){
      const foe=threats.find(t=>t.id===task.threat!.source),point=this.economy.taskPoint(task);
      const range=foe&&this.combat.unit(foe.id)?.role==='wolf'?C.acquire:COMBAT_CONFIG.acquire;
      if(foe&&(distance(foe.position,task.threat.point)<=range+1||point&&distance(foe.position,point)<=range+1))task.threat.safeSince=undefined;
      else if(task.threat.safeSince===undefined)task.threat.safeSince=now;
      else if(now-task.threat.safeSince>=3){task.threat=undefined;task.retryAt=0;task.reason='';this.economy.revision++;}
    }
    for (const r of homeResidents(this.economy.state)) {
      if (health(this.economy.state, r.id) <= 0) { delete this.state.evading[r.id];this.escapePlans.delete(r.id); continue; }
      const position = this.position(r.id), vital = this.economy.state.vitals[r.id];
      const nearby = threats.filter(w => distance(position, w.position) < (this.combat.unit(w.id)?.role==='wolf'?C.acquire:COMBAT_CONFIG.acquire));
      if (this.combat.unit(r.id)) {
        for (const w of threats) if (distance(position, w.position) <= C.aidRadius
          && homeResidents(this.economy.state).some(n => health(this.economy.state, n.id) > 0 && distance(this.position(n.id), w.position) < 8) && this.clear(position, w.position)) {
          if (this.combat.assist(r.id, w.id)) break;
        }
        continue;
      }
      const evasion = this.state.evading[r.id],hit=vital.lastAttack;
      const source=threats.find(t=>t.id===(hit?.source??evasion?.attacker));
      const attacked=!!source&&!!hit&&now-hit.at<=3;
      const reacting=attacked||!!evasion?.attacker;
      const active=this.economy.active(r.id);
      // Task origin, not a short grace timer, owns the entire player order:
      // approach, work and its follow-up delivery, including after reload.
      if (active?.origin==='manual'&&!reacting) { delete this.state.evading[r.id];this.escapePlans.delete(r.id); continue; }
      // Leave enough room for the same body-sized clearance used when planning
      // safe work/wander routes, rather than stopping with feet on the border.
      const zone=this.economy.state.dangerZones.find(z=>distance(position,z)<=z.radius+r.bodyRadius+.05);
      const attacking=nearby.filter(t=>{const u=this.combat.unit(t.id);return u?.target===r.id||u?.attack?.target===r.id;});
      const threatsNow=reacting?attacking:nearby;
      const hazard=reacting&&source&&(attacked&&!evasion||distance(position,source.position)<C.acquire+2)?source.position
        :threatsNow.length?threatsNow.reduce((a,b)=>distance(position,a.position)<distance(position,b.position)?a:b).position:reacting?undefined:zone;
      if (!hazard) {
        // Shared areas own the ten-second clearance wait. Once outside every
        // hazard, safe work may resume without a second personal countdown.
        if (evasion) { this.people.release(r.id); delete this.state.evading[r.id];this.escapePlans.delete(r.id);vital.lastAttack=undefined; }
        continue;
      }
      // An accepted player movement stays in charge, even beyond its grace time.
      if (!reacting&&(vital.manualUntil > now || !evasion && this.people.status(r.id).moving && !active && !vital.rest)) continue;
      const e = evasion ?? (this.state.evading[r.id] = { planAt: 0 });
      if(attacked&&source){if(!e.attacker)e.planAt=0;e.attacker=source.id;}
      if((!evasion||reacting&&active)&&active){
        if(reacting&&source)this.economy.pauseUnderAttack(active,source.id,position);
        else{active.watchPath??=[{...position}];this.economy.holdDanger(active,position);}
        this.people.release(r.id);
      }
      if(!evasion){this.people.release(r.id);vital.rest=undefined;this.people.resting(r.id,false);}
      vital.hurtUntil = Math.max(vital.hurtUntil, now + 1);
      if (e.planAt > now&&!this.escapePlans.has(r.id)) continue;
      e.planAt = now + 2;
      const dx = position.x - hazard.x || .01, dz = position.z - hazard.z, length = Math.hypot(dx, dz) || 1;
      const escapeDistance = C.acquire+DANGER_CONFIG.buffer+4;
      const points = [{ x: position.x + dx / length * escapeDistance, z: position.z + dz / length * escapeDistance },
        ...(zone ? circle(zone, zone.radius+2) : []),
        ...this.economy.state.campfires.filter(fireIsLit).flatMap(f => circle(this.economy.state.sites.find(s => s.id === f.id)!, 3)),
        ...this.economy.warehouseDoors()]
        .filter(p => distance(p, hazard) > distance(position, hazard) + 2 && (reacting?!nearby.some(t=>distance(p,t.position)<COMBAT_CONFIG.acquire):!this.unsafePath([p])))
        .sort((a, b) => distance(position, a) - distance(position, b));
      const pending=this.escapePlans.get(r.id);
      for (const point of pending?[pending.goal,...points]:points) {
        if(!this.people.movementInput){if(this.people.command(point,r.id))break;continue;}
        const live=this.people.movementInput(r.id,point);if(!live)break;
        // Keep an outstanding worker query stable while surrounding bodies move.
        // Once it replies, validate the route against live geometry/reservations.
        const input=pending?.goal===point?pending:live,path=planNavigation(input);
        if(path===null){this.escapePlans.set(r.id,input);e.planAt=now+.35;break;}
        this.escapePlans.delete(r.id);
        if(!path)continue;
        const route=validateNavigation(live,path),end=route?.at(-1);
        if(end&&distance(end,hazard)>distance(position,hazard)+2
          &&(reacting?!nearby.some(t=>distance(end,t.position)<COMBAT_CONFIG.acquire):!this.unsafePath([end]))
          &&this.people.command(end,r.id,route))break;
      }
    }
  }
  update(seconds: number) {
    if(MAP_DEVELOPMENT&&!this.economy.state.debug)return;
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const dt = Math.min(seconds, .25), now = this.economy.state.seconds;
    if(this.economy.state.debug)this.debug.update();
    this.updateAreas();
    if(!this.economy.state.debug&&this.state.phase==='peace'){
      if(!this.state.pendingOrigin&&now>=this.state.nextAt-C.warning)this.warn();
      if(this.state.pendingOrigin&&now>=this.state.nextAt)this.spawn();
    }
    if(!this.economy.state.debug)for(const id of this.state.soldiers){const u=this.combat.unit(id);if(!u||u.life!=='active'||u.departed)continue;
      if(now-this.state.startedAt<C.duration&&!u.target&&!u.attack&&!u.goal){u.order='guard';u.goal={...home};}
      if(now-this.state.startedAt>=C.duration){
        if(u.order!=='retreat'){u.route=[];u.attackApproach=undefined;u.planIn=0;resetRouteState(u.navigation);}
        u.provoked=undefined;u.order='retreat';u.goal={...u.home};u.target=undefined;u.attack=undefined;
        if(distance(u.position,u.home)<2&&!homeResidents(this.economy.state).some(r=>health(this.economy.state,r.id)>0&&distance(this.position(r.id),u.position)<16)){u.departed=true;u.route=[];}
      }
    }
    this.decisions -= dt;
    if (this.decisions <= 0) { this.decisions = .35; this.protect(); }
    let remaining = dt;
    while (remaining > 1e-8) { const step = Math.min(.05, remaining); for (const w of this.wolves) this.tick(w, step); remaining -= step; }
    if (!this.economy.state.debug && this.state.phase === 'raid' && this.state.wolves.every(w => w.life === 'defeated' || w.mode === 'gone')
      && this.state.soldiers.every(id=>{const u=this.combat.unit(id);return !u||u.life==='defeated'||u.departed;})) {
      this.state.phase = 'peace'; this.state.nextAt = now + C.intervalMin + raidRandom(this.state) * (C.intervalMax - C.intervalMin);
      const stolen = this.state.wolves.filter(w => w.mode === 'gone').reduce((n, w) => n + w.carried, 0);
      this.state.notice = stolen ? `狼群离开了 · 带走${stolen}份熟食` : this.state.soldiers.length?'敌袭已结束':'狼群已被赶走'; this.state.noticeUntil = now + 10;
    }
  }
  private tick(w: Wolf, dt: number) {
    w.speed = 0;
    if (w.life === 'defeated') {
      if (!w.settled) { w.settled = true; this.economy.dropReward(w.position, { food: C.loot + w.carried }, false); }
      return;
    }
    if (w.mode === 'gone') return;
    const now = this.economy.state.seconds, stats = COMBAT_CONFIG.wolf, wild = this.state.wildWolves.includes(w);
    w.cooldown = Math.max(0, w.cooldown - dt); w.planIn = Math.max(0, w.planIn - dt);
    if (w.targetSwitchIn) w.targetSwitchIn = Math.max(0, w.targetSwitchIn - dt);
    const fireNear = this.economy.state.campfires.some(f => fireIsLit(f) && this.economy.state.sites.some(s => s.id === f.id && distance(s, w.position) < C.fearRadius && this.fireClear(w.position, s)));
    w.fear = Math.max(0, Math.min(10, w.fear + (fireNear ? dt : -dt * .5)));
    const lost = this.state.wolves.filter(n => n.life === 'defeated').length;
    if (w.hp <= stats.hp * .25 || w.fear >= C.fearSeconds || w.carried || !wild && (lost >= Math.ceil(this.state.wolves.length / 2) || now - this.state.startedAt >= C.duration)) this.flee(w);
    if (w.mode === 'flee') {
      if (wild && distance(w.position, w.home) < .5 && w.fear < 1 && w.hp > stats.hp * .25) { w.mode = 'approach'; w.defendFrom = undefined; }
      if (!wild && distance(w.position, w.home) < 2 && !this.visible(w.position) && !homeResidents(this.economy.state).some(r => distance(this.position(r.id), w.position) < 16)) {
        w.mode = 'gone'; w.route = []; this.syncThreats(); return;
      }
      if (!w.route.length && w.planIn <= 0 && distance(w.position, w.home) >= .3) this.plan(w, wild?[w.home]:[w.home,...circle(w.home,1.5)]);
      this.travel(w, dt); return;
    }
    if (w.attack) {
      const attack = w.attack; attack.elapsed += dt;
      const victim=this.combat.target(attack.target);
      if(!victim||victim.life!=='active'||!this.combat.canTarget(w,victim)){w.attack=undefined;w.target=undefined;return;}
      const target = victim.position;
      w.facing = Math.atan2(target.x - w.position.x, target.z - w.position.z);
      if (!attack.released && attack.elapsed >= stats.windup) {
        attack.released = true;
        if (victim.hp>0 && distance(w.position,target)<=stats.range+.15+Math.max(0,(victim.contactRadius??victim.radius)-.4) && this.combat.visible(w.position,target,w.id,victim.id)) {
          this.combat.hurt(attack.target, stats.attack, w.id);
        }
      }
      if (attack.elapsed >= stats.windup + stats.recovery) w.attack = undefined;
      return;
    }
    const anchor = w.provoked?.from ?? (wild ? w.home : w.defendFrom ?? w.position), chase = w.provoked?.leash ?? C.chase;
    const nearby = this.combat.nearbyOpponent(w, w.target ? this.combat.target(w.target) : undefined);
    if (nearby && distance(anchor, nearby.position) <= chase) {
      w.target = nearby.id; w.targetSwitchIn = COMBAT_CONFIG.targetSwitchSeconds;
      w.mode = 'hunt'; w.foodTarget = undefined; w.feeding = 0; w.route = []; w.planIn = 0;
    }
    if (w.target && (!this.combat.target(w.target)||!this.combat.canTarget(w,this.combat.target(w.target)!)||this.combat.target(w.target)!.hp<=0 || distance(w.position, this.position(w.target)) > chase
      || distance(anchor, this.position(w.target)) > chase)) {
      w.target = undefined; w.route = []; w.defendFrom = undefined; w.provoked = undefined;
      if (wild) { w.mode = 'flee'; w.planIn = 0; return; }
    }
    if (!w.target && w.planIn <= 0) {
      const candidate = chooseTarget(w, this.combat.targets(), C.acquire,
        t => this.combat.canTarget(w,t)&&this.combat.visible(w.position,t.position,w.id,t.id) && distance(anchor, t.position) <= C.chase
          && !(t.kind==='building'&&!t.canAttack&&this.economy.state.campfires.some(f=>f.meals>0&&this.economy.state.sites.some(s=>s.id===f.id&&distance(s,w.position)<12))));
      if (candidate) {
        w.target = candidate.id; w.defendFrom ??= { ...anchor };
        w.mode = 'hunt'; w.foodTarget = undefined; w.feeding = 0; w.route = [];
      }
    }
    if (w.target) {
      const victim=this.combat.target(w.target)!;
      const target=victim.position,reach=stats.range+Math.max(0,(victim.contactRadius??victim.radius)-.4);
      if (distance(w.position, target) <= reach && this.combat.visible(w.position,target,w.id,w.target)) {
        w.route = []; w.facing = Math.atan2(target.x - w.position.x, target.z - w.position.z);
        if (!w.cooldown) { w.cooldown = stats.interval; w.attack = { id: this.combat.state.nextAttack++, target: w.target, elapsed: 0, released: false }; }
      } else {
        if (w.planIn <= 0) this.plan(w, circle(target, reach * .9).filter(p => this.combat.visible(p,target,w.id,w.target)));
        this.travel(w, dt);
      }
      return;
    }
    if (wild) {
      if (distance(w.position, w.home) > .5) { if (!w.route.length && w.planIn <= 0) this.plan(w, [w.home]); this.travel(w, dt); }
      else { w.route = []; w.mode = 'approach'; w.defendFrom = undefined; }
      return;
    }
    if (!w.foodTarget && w.planIn <= 0) {
      const fire = this.economy.state.campfires.find(f => f.meals > 0 && this.economy.state.sites.some(s => s.id === f.id && distance(s, w.position) < 12));
      if (fire) { w.foodTarget = fire.id; w.mode = 'feed'; w.route = []; }
    }
    if (w.foodTarget) {
      const fire = this.economy.campfire(w.foodTarget), site = this.economy.state.sites.find(s => s.id === w.foodTarget);
      if (!fire?.meals || !site) { w.foodTarget = undefined; w.feeding = 0; w.mode = 'approach'; w.route = []; }
      else {
        if (distance(w.position, site) <= 2.3 && this.fireClear(w.position, site)) {
          w.route = []; w.facing = Math.atan2(site.x - w.position.x, site.z - w.position.z); w.feeding += dt;
          if (w.feeding >= C.feedSeconds && fire.meals > 0) { fire.meals--; w.carried = 1; this.flee(w); }
        } else { if (w.planIn <= 0) this.plan(w, circle(site, 2.2)); this.travel(w, dt); }
        return;
      }
    }
    if (!w.route.length && w.planIn <= 0) this.plan(w, circle(home, 6));
    this.travel(w, dt);
  }
}
