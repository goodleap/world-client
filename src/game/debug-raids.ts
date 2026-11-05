import { createFighter, fighterRadius, type Combat } from './combat.ts';
import type { Economy } from './economy.ts';
import { DEBUG_RAID_CONFIG as C, allWolves } from './raid-state.ts';
import { newResident } from './resident-data.ts';
import { initialVital } from './vitals.ts';
import { DEATH_END } from './death.ts';
import { GRID_SIZE, HOME_CENTER, WORLD_BOUNDS } from './world-data.ts';
import { isBlocked, type Obstacle, type Point } from './movement.ts';
import { inBounds, segmentIsClear } from './wander.ts';
import { planMoveDestination } from './work-navigation.ts';
import { resetRouteState } from './route-following.ts';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
// Land entrances near the island edge, not the water outside its silhouette.
export const DEBUG_RAID_ENTRANCES: readonly Point[] = [[-14,-32],[-8,43],[-42,-10],[37,-30]]
  .map(([x,z]) => ({x:x*GRID_SIZE,z:z*GRID_SIZE}));
export const RAID_DESTINATION: Point = {x:HOME_CENTER.x,z:HOME_CENTER.z-HOME_CENTER.depth/2-1.5};
const clearance = .72; // Also fits cavalry; travel still uses each unit's radius.
const nearby = (origin:Point) => [origin,...[1.7,3.4,5.1].flatMap(radius => Array.from({length:8},(_,i) => ({
  x:origin.x+Math.cos(i*Math.PI/4)*radius,z:origin.z+Math.sin(i*Math.PI/4)*radius,
})))];

/** A debug-only producer. Navigation, targeting, damage and models stay in the
 * normal systems; at most one actor is added per tick, with no catch-up burst. */
export class DebugRaids {
  private economy:Economy;
  private combat:Combat;
  private obstacles:()=>readonly Obstacle[];
  private candidate = 0;
  private cleanupAt = 0;
  private corridor?: {origin:Point;solids:readonly Obstacle[];route:Point[]};
  constructor(economy:Economy,combat:Combat,obstacles:()=>readonly Obstacle[]) {
    this.economy=economy;this.combat=combat;this.obstacles=obstacles;
  }

  private cleanup() {
    const {state}=this.economy, raid=state.raids, now=state.seconds;
    if(now<this.cleanupAt)return;
    this.cleanupAt=now+.5;
    const removed=new Set(raid.soldiers.filter(id=>{
      const u=this.combat.unit(id);
      return !u || (u.departed || u.life==='defeated'&&now-(u.diedAt??0)>=DEATH_END)
        && !this.combat.state.projectiles.some(p=>p.source===id||p.target===id);
    }));
    if(!removed.size)return;
    this.combat.state.units=this.combat.state.units.filter(u=>!removed.has(u.id));
    raid.soldiers=raid.soldiers.filter(id=>!removed.has(id));
    for(const id of removed){delete state.vitals[id];delete state.residents[id];}
    for(const u of this.combat.state.units)if(u.commandTarget&&removed.has(u.commandTarget))u.commandTarget=undefined;
    this.combat.setThreats(allWolves(raid).filter(w=>w.mode!=='gone'));
    if(!raid.soldiers.length&&!raid.pendingCount)raid.phase='peace';
    this.economy.revision++;
  }

  update() {
    if(!this.economy.state.debug)return;
    this.cleanup();
    const {state}=this.economy, raid=state.raids, now=state.seconds;
    for(const id of raid.soldiers){
      const u=this.combat.unit(id);
      if(!u||u.life!=='active'||u.departed||u.target||u.attack)continue;
      // After a local fight, resume the assault instead of returning to the
      // map edge. Never interrupt a committed strike or nearby retaliation.
      if(!u.goal||u.order==='hold'||u.order==='retreat'){
        u.order='guard';u.goal={...RAID_DESTINATION};u.provoked=undefined;u.defendFrom=undefined;
        u.route=[];u.attackApproach=undefined;u.planIn=0;resetRouteState(u.navigation);
      }
    }
    if(raid.soldiers.length>=C.maxSoldiers||now<raid.warningAt||!raid.pendingCount&&now<raid.nextAt)return;
    const solids=this.obstacles();
    const origins=DEBUG_RAID_ENTRANCES.flatMap((_,i)=>nearby(DEBUG_RAID_ENTRANCES[(raid.wave+i)%DEBUG_RAID_ENTRANCES.length]));
    const origin=raid.pendingOrigin??origins[this.candidate%origins.length];
    if(!inBounds(origin,clearance,WORLD_BOUNDS)||isBlocked(origin,clearance,solids)){
      if(raid.pendingCount){raid.pendingCount=0;raid.pendingOrigin=undefined;raid.nextAt=now+1;if(!raid.soldiers.length)raid.phase='peace';}
      this.candidate++;return;
    }
    const path=this.corridor?.origin.x===origin.x&&this.corridor.origin.z===origin.z&&this.corridor.solids===solids?this.corridor.route
      :planMoveDestination(origin,RAID_DESTINATION,clearance,WORLD_BOUNDS,solids,[]);
    if(path===null)return; // Stable query retries while the existing Worker runs.
    // A nearby fallback on the wrong side of a player-built wall is not an entrance.
    if(!path||distance(path.at(-1)!,RAID_DESTINATION)>2){
      this.candidate++;raid.pendingCount=0;raid.pendingOrigin=undefined;raid.nextAt=now+1;
      if(!raid.soldiers.length)raid.phase='peace';return;
    }
    this.corridor={origin,solids,route:path};
    if(!raid.pendingCount){
      raid.wave++;raid.phase='raid';raid.origin={...origin};raid.pendingOrigin={...origin};
      raid.pendingCount=C.batch;raid.startedAt=now;raid.nextAt=now+C.interval;this.candidate=0;
      raid.notice='边缘敌军持续来袭';raid.noticeUntil=now+C.interval;
    }
    const occupants=this.combat.targets().filter(t=>t.life==='active');
    const point=nearby(origin).find(p=>inBounds(p,clearance,WORLD_BOUNDS)&&!isBlocked(p,clearance,solids)
      &&!occupants.some(t=>distance(p,t.position)<clearance+t.radius+.15)
      &&segmentIsClear(p,origin,clearance,WORLD_BOUNDS,solids));
    raid.warningAt=now+C.spawnInterval;
    if(!point)return;
    const index=C.batch-raid.pendingCount,role=index%6===5?'cavalry':index%3===2?'archer':'infantry';
    const id=`enemy-raid-${role}-${raid.wave}-${index}`,u=createFighter(newResident(role,id,point));
    u.goal={...RAID_DESTINATION};u.route=[{...origin},...path.map(p=>({...p}))];
    // Aim into the route at spawn; no visible idle turn before advancing.
    const next=u.route.find(p=>distance(point,p)>fighterRadius(u));
    if(next)u.facing=Math.atan2(next.x-point.x,next.z-point.z);
    this.combat.state.units.push(u);state.vitals[id]=initialVital(id);raid.soldiers.push(id);
    if(!--raid.pendingCount)raid.pendingOrigin=undefined;
    this.combat.syncUnits();this.economy.revision++;
  }
}
