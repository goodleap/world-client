import {planPath} from './path-planner.ts';
import {combineObstacles} from './navigation-geometry.ts';
import {economyObstacles} from './economy-config.ts';
import {WORLD_BOUNDS} from './world-data.ts';
import { Economy } from './economy.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import type { createResidentSimulation } from './resident-simulation.ts';
import type { createEconomyWorld } from './economy-world.ts';
import type { CropKind, WorkKind, WorkTask } from './economy.ts';
import type { Obstacle, Point } from './movement.ts';
import { createSteward, stewardStatus } from './steward.ts';

export type UnitCommand = { kind: 'move'; point: Point; path?:readonly Point[] } | { kind: 'work'; work: WorkKind; target: string; crop?: CropKind };
type Residents = Pick<ReturnType<typeof createResidentSimulation>, 'command' | 'canWork' | 'hasMoveCommand' | 'farmerWorkState' |
  'releaseFarmerWork' | 'beginFarmerWork' | 'planFarmerWork' | 'startFarmerWork' | 'farmerIds'> & { farmerPosition: (id?: string) => Point };
type World = Pick<ReturnType<typeof createEconomyWorld>, 'sync' | 'workPoints'>;

export function createEconomyController(economy: Economy, world: World, residents: Residents, automatic = true, onDispatch: (worker: string, task: WorkTask) => void = () => {}, onStorageUse: (from?: Point) => void = () => {}, canTakeWork: (id: string, task?: WorkTask) => boolean = () => true, unsafePath?:(points:readonly Point[])=>boolean, workObstacles:()=>readonly Obstacle[]=()=>[], isEvading:(id:string)=>boolean=()=>false) {
  const steward = createSteward(economy,p=>!unsafePath?.([p]));
  let safetyAt=0;
  function safeTask(task:WorkTask,from:Point,path:Point[], hold = true){
    const pause = () => { if (hold) economy.holdDanger(task,from); return false; };
    if(task.origin==='manual'||!unsafePath)return true;
    const zones=workObstacles(),target=economy.taskPoint(task),end=path.at(-1)??from;
    const solids=economyObstacles(economy.state.depleted,economy.state.sites,economy.state.buildings);
    task.watchPath=[{x:from.x,z:from.z},...path].map(p=>({x:p.x,z:p.z}));
    if(target&&unsafePath([target])) {
      task.watchPath=[{x:target.x,z:target.z}];return pause();
    }
    if(unsafePath(task.watchPath)) {
      const detour=zones.length?planPath(from,end,.29,WORLD_BOUNDS,combineObstacles(solids,zones)):undefined;
      if(detour===null)return null;
      if(!detour||unsafePath([from,...detour])){return pause();}
      path.splice(0,path.length,...detour);
    }
    const doors=economy.warehouseDoors().sort((a,b)=>Math.hypot(a.x-end.x,a.z-end.z)-Math.hypot(b.x-end.x,b.z-end.z));
    let back:Point[]|undefined,blockedBack:Point[]|undefined,pending=false;
    for(const door of doors){
      const candidate=planPath(end,door,.29,WORLD_BOUNDS,solids);
      if(candidate===null){pending=true;continue;}
      if(!candidate)continue;
      if(!unsafePath([end,...candidate])){back=candidate;break;}
      blockedBack??=candidate;
      const detour=zones.length?planPath(end,door,.29,WORLD_BOUNDS,combineObstacles(solids,zones)):undefined;
      if(detour===null)pending=true;
      if(detour&&!unsafePath([end,...detour])){back=detour;break;}
    }
    if(!back&&pending)return null;
    task.watchPath=[{x:from.x,z:from.z},...path,...back??blockedBack??[]].map(p=>({x:p.x,z:p.z}));
    if(task.danger||unsafePath(task.watchPath)){return pause();}
    return true;
  }
  const rejectedUntil = new Map<string, number>();
  const approachRetry = new Map<string, number>();
  function storageChange(action: () => void, from?: Point) {
    const before = { ...economy.state.inventory }; action();
    if (before.wood !== economy.state.inventory.wood || before.stone !== economy.state.inventory.stone || before.food !== economy.state.inventory.food || before.iron !== economy.state.inventory.iron) onStorageUse(from);
  }
  function destination(task: WorkTask, from?: Point) {
    const target = task.kind === 'supply' ? task.status === 'delivering' ? task.target : task.cargo ?? 'warehouse'
      : task.status === 'delivering' ? 'warehouse' : task.target;
    return world.workPoints(target, from,task.kind==='repair');
  }
  function command(id: string, instruction: UnitCommand): { ok: boolean; message: string } {
    if (instruction.kind === 'move') {
      if (!residents.command(instruction.point, id,false,instruction.path)) return { ok: false, message: '无法到达该位置' };
      if (residents.canWork(id)) economy.interrupt(residents.farmerPosition(id), id);
      return { ok: true, message: '前往目标位置' };
    }
    if (!residents.canWork(id)) return { ok: false, message: '此作业需要农民' };
    let task = economy.taskFor(instruction.target);
    if (task && (task.kind !== instruction.work || task.crop !== instruction.crop)) return { ok: false, message: '该目标已有其他任务' };
    if (!task) {
      const result = economy.request(instruction.work, instruction.target, instruction.crop);
      if (!result.ok) return result;
      task = result.task!;
    }
    if (residents.farmerWorkState(id)?.id === task.id && economy.active(id)?.id === task.id) {
      const result=economy.assign(task.id,id);
      return result.ok?{ok:true,message:'正在执行该作业'}:result;
    }
    if (task.status === 'storage') return { ok: false, message: '作业已完成，正在等待入库' };
    if (task.worker && task.worker !== id && task.status !== 'waiting') return { ok: false, message: '其他农民正在执行该任务' };
    const place = destination(task, residents.farmerPosition(id));
    const path = place && residents.planFarmerWork(place.points, id);
    if(path===null){
      economy.updateCargo(residents.farmerPosition(id),id);
      const result=economy.assign(task.id,id);
      if(result.ok)residents.releaseFarmerWork(id);
      return result;
    }
    if (!place || !path) {
      if (!task.worker) economy.defer(task.id, '暂时无法到达，稍后重试');
      return { ok: false, message: '暂时无法到达，作业已保留' };
    }
    economy.updateCargo(residents.farmerPosition(id), id);
    const result = economy.assign(task.id, id);
    if (result.ok) residents.startFarmerWork(task.id, path, place.target, id);
    return result;
  }
  function update(seconds: number) {
    if (seconds <= 0) return;
    if(economy.state.seconds>=safetyAt){
      safetyAt=economy.state.seconds+.5;
      unsafePath?.([]); // Refresh shared regions once, before creating new work.
      economy.arrangeRepairs();
      if(unsafePath){
        economy.checkDanger(unsafePath);
        for(const task of economy.state.tasks)if(task.origin!=='manual'&&task.worker&&task.watchPath?.length&&!task.danger&&['travelling','working','delivering'].includes(task.status)&&unsafePath(task.watchPath)){
          const worker=task.worker,from=residents.farmerPosition(worker),assigned=residents.farmerWorkState(worker);
          const place=destination(task,from),path=assigned?.path?[...assigned.path]:place&&residents.planFarmerWork(place.points,worker);
          if(path&&place&&safeTask(task,from,path)){
            if(assigned?.status==='travelling')residents.startFarmerWork(task.id,path,place.target,worker);
          }else{
            economy.holdDanger(task,from);residents.releaseFarmerWork(worker);
          }
        }
      }
    }
    for (const id of residents.farmerIds()) economy.updateCargo(residents.farmerPosition(id), id);
    const workshop = economy.state.tasks.find(t => t.status === 'working' && (t.kind === 'tools' || t.kind === 'arms'));
    storageChange(() => economy.advance(seconds), workshop?.worker ? residents.farmerPosition(workshop.worker) : undefined);
    const canDispatch = automatic && economy.state.steward.enabled && economy.state.seconds >= economy.state.steward.nextDecision;
    if (canDispatch) economy.state.steward.nextDecision = economy.state.seconds + .5;
    world.sync();
    for (const id of residents.farmerIds()) {
      // Personal meals own their delivery route; normal work resumes afterwards.
      if (economy.state.vitals[id].rest) continue;
      let assigned = residents.farmerWorkState(id);
      const active = economy.active(id);
      if (assigned && assigned.id !== active?.id) { residents.releaseFarmerWork(id); assigned = undefined; }
      // A completed gathering job can already own its delivery. Restore the
      // matching route before considering any other work for this farmer.
      if (!assigned && active && !residents.hasMoveCommand(id)) {
        const place = destination(active, residents.farmerPosition(id));
        const path = place && residents.planFarmerWork(place.points, id);
        const safe=path&&safeTask(active,residents.farmerPosition(id),path);
        if(path===null||safe===null)continue;
        if (path && place && safe) residents.startFarmerWork(active.id, path, place.target, id);
        else economy.defer(active.id, '暂时无法到达，稍后重试', residents.farmerPosition(id));
        assigned = residents.farmerWorkState(id);
      }
      if (assigned?.status === 'travelling' && active && (assigned.waitingFor ?? 0) > 1 && assigned.approachOccupied
        && economy.state.seconds >= (approachRetry.get(id) ?? 0)) {
        approachRetry.set(id, economy.state.seconds + 2);
        const place = destination(active, residents.farmerPosition(id));
        const path = place && residents.planFarmerWork(place.points, id);
        const safe=path&&safeTask(active,residents.farmerPosition(id),path);
        if(path===null||safe===null){approachRetry.set(id,economy.state.seconds+.05);continue;}
        if (path && place) { if(safe){residents.startFarmerWork(active.id,path,place.target,id);active.reason='';}else residents.releaseFarmerWork(id); }
        else active.reason = '作业点被占用，等待空位';
      }
      if (assigned && assigned.id !== active?.id) residents.releaseFarmerWork(id);
      else if (assigned?.status === 'blocked') {
        economy.defer(assigned.id, '暂时无法到达，稍后重试', residents.farmerPosition(id)); residents.releaseFarmerWork(id);
      } else if (assigned?.status === 'arrived') {
        // A warehouse can be destroyed while cargo is en route. Recheck its
        // current delivery doors before crediting inventory at the old door.
        if(active?.status==='delivering'&&active.kind==='haul'){
          const place=destination(active,residents.farmerPosition(id));
          if(!place?.points.some(p=>Math.hypot(p.x-residents.farmerPosition(id).x,p.z-residents.farmerPosition(id).z)<.45)){
            const path=place&&residents.planFarmerWork(place.points,id);
            const safe=path&&safeTask(active,residents.farmerPosition(id),path);
            if(path===null||safe===null)continue;
            if(path&&place&&safe)residents.startFarmerWork(active.id,path,place.target,id);
            else {economy.defer(active.id,'仓库暂时无法到达',residents.farmerPosition(id));residents.releaseFarmerWork(id);}
            continue;
          }
        }
        storageChange(() => economy.arrive(assigned!.id), residents.farmerPosition(id));
        economy.updateCargo(residents.farmerPosition(id), id);
        if (economy.active(id)?.status === 'delivering') {
          const place = destination(economy.active(id)!, residents.farmerPosition(id));
          const path = place&&residents.planFarmerWork(place.points, id);
          const safe=path&&safeTask(economy.active(id)!,residents.farmerPosition(id),path);
          if(path===null||safe===null){residents.releaseFarmerWork(id);continue;}
          if (path&&place&&safe) residents.startFarmerWork(assigned.id, path, place.target, id);
          else { economy.defer(assigned.id, '仓库暂时无法到达', residents.farmerPosition(id)); residents.releaseFarmerWork(id); }
        } else if (economy.active(id)?.status === 'working') residents.beginFarmerWork(assigned.id, id);
        else residents.releaseFarmerWork(id);
      }
      world.sync();
      // An automatic escape route may yield to queued player work. A player
      // movement remains in charge; automatic work still needs a safe worker.
      if (residents.hasMoveCommand(id) && !isEvading(id)) continue;
      const eligible=(task:WorkTask)=>canTakeWork(id,task);
      let requested = false;
      let prepared: { target: string; place: NonNullable<ReturnType<typeof destination>>; path: Point[]; watchPath?: Point[] } | undefined;
      if (!economy.active(id)) for (let attempts = 0; attempts <= ECONOMY_CONFIG.queueLimit; attempts++) {
        let task = economy.claim(id, residents.farmerPosition(id),eligible);
        if (!task && canDispatch && !requested && canTakeWork(id)) {
          requested = true;
          const from = residents.farmerPosition(id);
          let searches = 0;
          const created = steward.requestWork(from, job => {
            const key = `${id}:${job.kind}:${job.target}`;
            if ((rejectedUntil.get(key) ?? 0) > economy.state.seconds || searches >= 2) return false;
            searches++;
            const probe: WorkTask = { ...job, id: -1, origin: 'steward', status: 'waiting', progress: 0, reserved: false, reason: '', retryAt: 0 };
            const place = destination(probe, from), path = place && residents.planFarmerWork(place.points, id);
            const safe=path&&safeTask(probe,from,path,false);
            if(path===null||safe===null)return false;
            if (!place || !path || !safe) {
              rejectedUntil.set(key, economy.state.seconds + 2);
              if (rejectedUntil.size > 512) rejectedUntil.delete(rejectedUntil.keys().next().value!);
              return false;
            }
            prepared = { target: job.target, place, path, watchPath: probe.watchPath };
            rejectedUntil.delete(key); return true;
          });
          if (created) task = economy.claim(id, from, eligible);
        }
        if (!task) break;
        const cached = prepared?.target === task.target ? prepared : undefined;
        const place = cached?.place ?? destination(task, residents.farmerPosition(id));
        const path = cached?.path ?? (place && residents.planFarmerWork(place.points, id));
        if (cached) task.watchPath = cached.watchPath;
        const safe=cached?true:path&&safeTask(task,residents.farmerPosition(id),path);
        if(path===null||safe===null)break;
        if (place && path) { if(!safe)continue; residents.startFarmerWork(task.id, path, place.target, id); if (economy.state.steward.enabled && task.origin === 'steward') onDispatch(id, task); break; }
        economy.defer(task.id, '暂时无法到达，稍后重试');
      }
    }
    economy.state.steward.reason = stewardStatus(economy, residents.farmerIds().filter(id => residents.hasMoveCommand(id)).length);
  }
  return { update, command };
}
