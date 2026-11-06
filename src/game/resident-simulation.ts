import { combineObstacles } from './navigation-geometry.ts';
import { bodyObstacle,turnTowards } from './body-shape.ts';
import type { Neighbour } from './route-following.ts';
import type { Fighter } from './combat.ts';
import { fighterDestination } from './combat.ts';
import type { Vitals } from './vitals.ts';
import type { ResidentDefinition } from './resident-data.ts';
import type { SavedResident } from './economy.ts';
import { isBlocked } from './movement.ts';
import type { Obstacle,Point } from './movement.ts';
import { canResidentWork,wanderSettings } from './resident-data.ts';
import { destinationSpeed as commandedSpeed } from './locomotion.ts';
import { createWanderState,seededRandom,segmentIsClear,stepWander } from './wander.ts';
import { createRouteState,resetRouteState,stepRoute } from './route-following.ts';
import { occupiedApproach,planMoveDestination,planWorkApproach } from './work-navigation.ts';
import { validateNavigation } from './navigation-plan.ts';
import type { CrowdBody } from './native-motion.ts';

export type ResidentMotion='idle'|'walk'|'run'|'work'|'attack';
/** Authoritative resident jobs and locomotion; no scene, meshes or DOM. */
export function createResidentSimulation(definitions:readonly ResidentDefinition[],vitals:Vitals,
  worldObstacles:(avoidFields?:boolean)=>readonly Obstacle[],seed:number,
  restored:(id:string)=>Point|undefined=()=>undefined,unreachable:(point:Point)=>void=()=>{}){
  const resting=new Set<string>(),obstaclesFor=(role:string)=>worldObstacles(role!=='farmer');
  const createActor=(definition:ResidentDefinition,index:number)=>{
    const random=seededRandom(seed+(index+1)*1337),settings=wanderSettings(definition);
    const state=createWanderState(definition.spawn,settings,obstaclesFor(definition.role),random,restored(definition.id));
    return {definition,random,settings,state,facing:Math.PI,movementSpeed:0,motion:'idle' as ResidentMotion,playbackSpeed:0,
      stepPath:undefined as readonly Point[]|undefined,stepFacing:undefined as number|undefined,
      route:[] as Point[],navigation:createRouteState(),wanderRoute:[] as Point[],wanderNavigation:createRouteState()};
  };
  const actors=definitions.map(createActor),actorById=new Map(actors.map(a=>[a.definition.id,a]));
  const farmer=actors.find(a=>a.definition.role==='farmer')!;
  type Work={id:number;target:Point;status:'travelling'|'arrived'|'working'|'blocked'};
  const works=new Map<string,Work>(),combatPoses=new Map<string,Fighter>();
  const dead=(id:string)=>combatPoses.get(id)?.life==='defeated'||vitals[id]?.hp===0;
  const setMotion=(id:string,motion:ResidentMotion,speed=0)=>{const a=actorById.get(id);if(a){a.motion=motion;a.playbackSpeed=speed;}};
  let extraNeighbours: () => Neighbour[] = () => [];
  let wanderObstacles: () => readonly Obstacle[] = () => [];
  const groundRadius=(a:typeof actors[number])=>a.settings.bodyRadius;
  const destinationSpeed = (actor: typeof actors[number]) => commandedSpeed(actor.settings.speed, actor.definition.role!=='dog');
  const navigate = (actor: typeof actors[number], route: Point[], navigation: typeof actor.navigation, seconds: number, speed: number,
    solids: readonly Obstacle[] = obstaclesFor(actor.definition.role)) => {
    const result = stepRoute(actor.definition.id, actor.state.position, route, navigation, seconds,
      speed, actor.settings.bodyRadius, actor.settings.bounds, solids,
      []);
    actor.stepPath = result.path; actor.stepFacing = result.facing;
    return result;
  };
  const workNeighbours = (actor: typeof actors[number]) => [...extraNeighbours(), ...actors.filter(other => other !== actor && !dead(other.definition.id) && !combatPoses.get(other.definition.id)?.departed).map(other => ({
    position: other.state.position, radius: groundRadius(other), destination: fighterDestination(combatPoses.get(other.definition.id)) ?? other.route.at(-1),
  }))];
  const advanceRoute = (actor: typeof actors[number], seconds: number) => {
    const result = navigate(actor, actor.route, actor.navigation, seconds, destinationSpeed(actor));
    actor.state.distanceTravelled += result.distance;
    actor.state.position = result.position;
    return result;
  };
  const api={
    crowdBodies:():CrowdBody[]=>actors.filter(a=>!combatPoses.has(a.definition.id)&&!dead(a.definition.id)).map(a=>({
      id:a.definition.id,position:a.state.position,radius:groundRadius(a),speed:a.route.length?destinationSpeed(a):a.settings.speed,
      route:a.route.length?a.route:a.wanderRoute,solids:a.route.length?obstaclesFor(a.definition.role):combineObstacles(obstaclesFor(a.definition.role),wanderObstacles()),
      moveIdle:p=>{a.state.position=p;},
    })),
    syncDefinitions(next:readonly ResidentDefinition[]){
      const ids=new Set(next.map(d=>d.id));
      for(const a of [...actors])if(a.definition.id.startsWith('enemy-raid-')&&!ids.has(a.definition.id)){
        actors.splice(actors.indexOf(a),1);actorById.delete(a.definition.id);combatPoses.delete(a.definition.id);works.delete(a.definition.id);resting.delete(a.definition.id);
      }
      for(const d of next)if(!actorById.has(d.id)){const a=createActor(d,actors.length);actors.push(a);actorById.set(d.id,a);}
    },
    syncCombat(units:Fighter[]){
      for(const u of units){combatPoses.set(u.id,u);const a=actorById.get(u.id);if(!a)continue;
        a.state.position={...u.position};a.facing=u.facing;a.movementSpeed=u.speed;a.route=[];a.state.target=undefined;
        if(u.life==='defeated'||u.departed){resting.delete(u.id);works.delete(u.id);}
      }
      for(const a of actors)if(!combatPoses.has(a.definition.id)&&dead(a.definition.id)){a.route=[];a.wanderRoute=[];a.state.target=undefined;a.movementSpeed=0;resting.delete(a.definition.id);works.delete(a.definition.id);}
    },
    setExtraNeighbours(value:()=>Neighbour[]){extraNeighbours=value;},
    setWanderObstacles(value:()=>readonly Obstacle[]){wanderObstacles=value;},
    combatNeighbours:()=>actors.filter(a=>!combatPoses.has(a.definition.id)&&!dead(a.definition.id)).map(a=>({id:a.definition.id,position:a.state.position,radius:a.definition.bodyRadius,heading:a.facing,
      moving:a.movementSpeed>.08,purposeful:!!a.route.length||works.has(a.definition.id)||resting.has(a.definition.id),waiting:a.navigation.waiting,destination:a.route.at(-1)})),
    occupancy:()=>actors.filter(a=>!dead(a.definition.id)&&!combatPoses.get(a.definition.id)?.departed).map(a=>bodyObstacle(a.state.position,a.definition.bodyRadius)),
    frame:()=>actors.map(a=>({id:a.definition.id,position:{...a.state.position},facing:a.facing,speed:a.movementSpeed,motion:a.motion,playbackSpeed:a.playbackSpeed,
      route:a.route,path:a.stepPath,navigation:{...a.navigation},work:works.get(a.definition.id),working:works.get(a.definition.id)?.status==='working',feeding:!!vitals[a.definition.id]?.meal})),
    farmerIds: () => actors.filter(a => a.definition.role === 'farmer').map(a => a.definition.id),
    setResting(id: string, yes: boolean) { if (yes) resting.add(id); else resting.delete(id); },
    needsStatus: (id: string) => {
      const a = actors.find(a => a.definition.id === id)!;
      return { position: a.state.position, speed: a.movementSpeed, moving: a.route.length > 0, working: works.get(id)?.status === 'working', goal: a.route.at(-1) };
    },
    saveResidents: (): Record<string, SavedResident> => Object.fromEntries(actors.filter(a=>!a.definition.id.startsWith('enemy-')).map(actor => [actor.definition.id, {
      position: { ...actor.state.position }, manualGoal: !works.has(actor.definition.id) && actor.route.length ? { ...actor.route.at(-1)! } : undefined,
    }])),
    async restoreResidents(saved: Record<string, SavedResident>,resolve:(read:()=>import('./path-planner.ts').PlannedPath)=>Promise<import('./path-planner.ts').PlannedPath>=read=>Promise.resolve(read())) {
      for (const actor of actors) {
        const data = saved[actor.definition.id]; if (!data) continue;
        if (!isBlocked(data.position, actor.settings.bodyRadius, obstaclesFor(actor.definition.role))) {
          actor.state.position = { ...data.position }; 
          actor.state.target = undefined;
        }
      }
      // Resolve reservations after every saved position is restored, including
      // several units that share a destination.
      for (const actor of actors) {
        const goal = saved[actor.definition.id]?.manualGoal;
        if (goal){const start={...actor.state.position},neighbours=workNeighbours(actor);
          actor.route = await resolve(()=>planMoveDestination(start, goal, actor.settings.bodyRadius, actor.settings.bounds,
            obstaclesFor(actor.definition.role), neighbours)) ?? [];}
      }
    },
    farmerPosition: (id = farmer.definition.id) => actors.find(a => a.definition.id === id)!.state.position,
    routeFor: (id: string) => actorById.get(id)?.route ?? [],
    canWork: (id: string) => !dead(id) && canResidentWork(id),
    hasMoveCommand: (id: string) => !!actors.find(actor => actor.definition.id === id && actor.route.length && !works.has(actor.definition.id)),
    movementInput(id:string,point:Point){
      const actor=actorById.get(id);if(!actor||dead(id))return;
      return {start:{x:actor.state.position.x,z:actor.state.position.z},goal:{x:point.x,z:point.z},radius:actor.settings.bodyRadius,
        bounds:actor.settings.bounds,solids:obstaclesFor(actor.definition.role),neighbours:workNeighbours(actor).map(n=>({position:{x:n.position.x,z:n.position.z},radius:n.radius,
          destination:'destination' in n&&n.destination?{x:n.destination.x,z:n.destination.z}:undefined}))};
    },
    command(point: Point, id = farmer.definition.id, exact = false,prepared?:readonly Point[]) {
      const actor = actors.find(entry => entry.definition.id === id);
      if (!actor || dead(actor.definition.id)) return false;
      const path = prepared?validateNavigation({start:actor.state.position,goal:point,radius:actor.settings.bodyRadius,bounds:actor.settings.bounds,
        solids:obstaclesFor(actor.definition.role),neighbours:workNeighbours(actor)},prepared):exact ? planWorkApproach(actor.state.position, [point], actor.settings.bodyRadius, actor.settings.bounds,
        obstaclesFor(actor.definition.role), workNeighbours(actor)) : planMoveDestination(actor.state.position, point, actor.settings.bodyRadius, actor.settings.bounds,
        obstaclesFor(actor.definition.role), workNeighbours(actor));
      if (!path) return false;
      works.delete(actor.definition.id);
      actor.wanderRoute = []; resetRouteState(actor.wanderNavigation);
      actor.route = path; actor.state.target = undefined; actor.state.pause = 0; actor.state.blockedFor = 0;
      resetRouteState(actor.navigation);
      return true;
    },
    planFarmerWork(points: readonly Point[], unit = farmer.definition.id): Point[] | undefined | null {
      const farmer = actors.find(a => a.definition.id === unit)!;
      return planWorkApproach(farmer.state.position, points, farmer.settings.bodyRadius, farmer.settings.bounds, worldObstacles(), workNeighbours(farmer));
    },
    startFarmerWork(id: number, path: Point[], target: Point, unit = farmer.definition.id) {
      const farmer = actors.find(a => a.definition.id === unit)!;
      farmer.route = path; farmer.state.target = undefined;
      resetRouteState(farmer.navigation);
      works.set(unit, { id, target, status: 'travelling' });
    },
    farmerWorkState: (unit = farmer.definition.id): (Pick<Work, 'id' | 'status'> & { waitingFor?: number; approachOccupied?: boolean; path?: readonly Point[] }) | undefined => {
      const work = works.get(unit), actor = actors.find(a => a.definition.id === unit)!;
      const goal = actor.route.at(-1);
      return work && { id: work.id, status: work.status, path: actor.route, waitingFor: actor.navigation.waited,
        approachOccupied: !!goal && occupiedApproach(goal, actor.settings.bodyRadius, workNeighbours(actor)) };
    },
    beginFarmerWork(id: number, unit = farmer.definition.id) { const work = works.get(unit); if (work?.id === id && work.status === 'arrived') work.status = 'working'; },
    releaseFarmerWork(unit = farmer.definition.id) { works.delete(unit); const actor = actors.find(a => a.definition.id === unit)!; actor.route = []; resetRouteState(actor.navigation); setMotion(unit, 'idle'); },
    update(frameSeconds:number,frameElapsed=frameSeconds) {
      // Advance the whole crowd in short shared ticks. Previously one resident
      // could consume a half-second of movement against everybody else's old
      // position before the next resident got a turn on a slow frame.
      const ticks = Math.max(1, Math.ceil(Math.min(frameElapsed, .5) / .05));
      const seconds = frameSeconds / ticks, activeElapsed = Math.min(frameElapsed, .5) / ticks;
      for (let tick = 0; tick < ticks; tick++) for (const actor of actors) {
        actor.stepPath=undefined;actor.stepFacing=undefined;
        if (combatPoses.has(actor.definition.id) || dead(actor.definition.id)) continue;
        actor.movementSpeed = 0;
        if (seconds <= 0) continue;
        if (resting.has(actor.definition.id) && !actor.route.length) { setMotion(actor.definition.id, 'idle'); actor.movementSpeed = 0; continue; }
        const work = works.get(actor.definition.id);
        if (work) {
          let moved = 0;
          const workSeconds = Math.min(activeElapsed, .5);
          if (work.status === 'travelling') {
            let remaining = workSeconds;
            while (remaining > 1e-8 && actor.route.length) {
              const step = Math.min(remaining, .05);
              const result = advanceRoute(actor, step); moved += result.distance;
              if (result.unreachable) { work.status = 'blocked'; actor.route = []; break; }
              remaining -= step;
            }
            if (!actor.route.length && work.status !== 'blocked') work.status = 'arrived';
          }
          actor.movementSpeed = workSeconds > 0 ? moved / workSeconds : 0;
          if (moved > .001 && actor.stepFacing !== undefined) actor.facing = turnTowards(actor.facing, actor.stepFacing, seconds);
          else if (work.status === 'arrived' || work.status === 'working') actor.facing = Math.atan2(work.target.x - actor.state.position.x, work.target.z - actor.state.position.z) + .35;
          setMotion(actor.definition.id, work.status === 'working' ? 'work' : moved > .001 ? 'run' : 'idle',
            work.status === 'working' ? activeElapsed / seconds : moved / seconds);
          continue;
        }
        const crowd: Obstacle[] = [...extraNeighbours().map(n => bodyObstacle(n.position,n.radius)), ...actors.filter((other) => other !== actor && !dead(other.definition.id) && !combatPoses.get(other.definition.id)?.departed).map(other => bodyObstacle(other.state.position,groundRadius(other)))];
        const blockers = crowd.filter((other) => other.kind === 'circle'
          && Math.hypot(other.x - actor.state.position.x, other.z - actor.state.position.z) >= other.radius + actor.settings.bodyRadius - 0.001);
        let velocity: Point;
        let travelSpeed: number | undefined;
        const commanded = actor.route.length > 0;
        if (actor.route.length) {
          const before = { ...actor.state.position };
          let remaining = Math.min(activeElapsed, .5);
          let travelled = 0;
          while (remaining > 1e-8 && actor.route.length) {
            const step = Math.min(remaining, .05);
            const result = advanceRoute(actor, step); travelled += result.distance;
            if (result.unreachable) { actor.route = []; unreachable(actor.state.position); break; }
            remaining -= step;
          }
          velocity = { x: (actor.state.position.x - before.x) / seconds, z: (actor.state.position.z - before.z) / seconds };
          travelSpeed = travelled / seconds;
          if (!actor.route.length) actor.state.pause = 3;
        } else if (actor.definition.role === 'farmer') velocity = { x: 0, z: 0 };
        else {
          const areas = wanderObstacles(), solids = combineObstacles(obstaclesFor(actor.definition.role), areas);
          velocity = stepWander(actor.state, actor.settings, seconds, [...solids, ...blockers], actor.random, (goal, dt, speed) => {
            const last = actor.wanderRoute.at(-1);
            const safe = actor.wanderRoute.every((p,i) => segmentIsClear(i ? actor.wanderRoute[i-1] : actor.state.position,
              p, actor.settings.bodyRadius, actor.settings.bounds, areas));
            if (!last || Math.hypot(last.x - goal.x, last.z - goal.z) > .001 || !safe) {
              // One bounded target attempt per stroll/retry. The same shared
              // areas guard planning and the follower's later crowd detours.
              const planned=planWorkApproach(actor.state.position,[goal],actor.settings.bodyRadius,
                actor.settings.bounds,solids,workNeighbours(actor));
              if(planned===null)return {position:actor.state.position,unreachable:false};
              actor.wanderRoute = planned ?? [];
              resetRouteState(actor.wanderNavigation);
              if (!actor.wanderRoute.length) return { position: actor.state.position, unreachable: true };
            }
            return navigate(actor, actor.wanderRoute, actor.wanderNavigation, dt, speed, solids);
          });
        }
        const speed = travelSpeed ?? Math.hypot(velocity.x, velocity.z);
        actor.movementSpeed = speed;
        setMotion(actor.definition.id, speed > 0.08 ? commanded ? 'run' : 'walk' : 'idle', speed);
        if(speed>.08){const target=actor.stepFacing??Math.atan2(velocity.x,velocity.z);
          actor.facing=turnTowards(actor.facing,target,seconds,actor.definition.role==='cavalry'?7:14);}

      }
    },
  };return api;
}
export type ResidentFrame=ReturnType<ReturnType<typeof createResidentSimulation>['frame']>[number];
