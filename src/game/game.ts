import { towerHeight, assignedTower, garrisonCandidate, updateTowers, requestGarrison, evictTower, TOWER_CONFIG } from './towers.ts';
import { createTowerRange } from './tower-range.ts';
import { SimulationClock, RenderCadence } from './simulation-clock.ts';
import { setCharacterLODQuality } from './character-lod.ts';
import { createHomeManagement } from './home-management.ts';
import { advanceRecruitment, homeResidents } from './recruitment.ts';
import { groupMembers, groupInfo, pruneGroups } from './groups.ts';
import { groupDestinations } from './group-orders.ts';
import { CommandGuidance } from './command-guidance.ts';
import { planMoveDestination } from './work-navigation.ts';
import { createNavigationQueue } from './navigation-queue.ts';
import { validateNavigation } from './navigation-plan.ts';
import type { Point } from './movement.ts';
import { selectedUnitInfo } from './unit-info.ts';
import { livingPopulation, formatGameTime } from './home-status.ts';
import { Raids } from './raids.ts';
import { createWolfView } from './wolf-view.ts';
import { createNeedsController } from './needs-controller.ts';
import { health, maxHealth } from './vitals.ts';
import { Combat, fighterStats } from './combat.ts';
import { createCombatView } from './combat-view.ts';
import { loadingProgress } from '../loading-progress.ts';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createPalette } from './models.ts';
import { installMatteMaterials } from './matte-material.ts';
import { refreshFrozenMaterials } from './material-invalidation.ts';
import { applyDaylight, createDaylight, createMapShadowLOD } from './lighting.ts';
import { buildWorld } from './world.ts';
import { createResidents } from './residents.ts';
import { MovementInput } from './input.ts';
import { pinchMapCamera } from './pinch-zoom.ts';
import { WORLD_BOUNDS, GRID_SIZE, MAP_SIZE } from './world-data.ts';
import { createSelectionFeedback } from './selection-feedback.ts';
import '@babylonjs/core/Culling/ray';
import type { GameUI } from '../ui.ts';
import { nextPaint } from '../launcher.ts';
import { FrameMetrics } from './frame-metrics.ts';
import { objectAtFace, isWorldPickable } from './world-selection.ts';
import type { WorldObject } from './world-selection.ts';
import { ENEMIES, newResident, roleLeader } from './resident-data.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import { Economy, encodeEconomy, WORK_NAMES } from './economy.ts';
import { ECONOMY_SAVE_KEY } from './economy-storage.ts';
import { buildingSelection, economySelection, updateEconomyUI } from './economy-ui.ts';
import { buildingOperational } from './building-state.ts';
import { createEconomyController } from './economy-controller.ts';
import type { UnitCommand } from './economy-controller.ts';
import { releaseModelDownloads } from './asset-cache.ts';
import { createMoveFeedback } from './move-feedback.ts';
import { createPathGuidance } from './path-guidance.ts';
import { createPerformanceDiagnostics } from './performance-diagnostics.ts';
import { compactPerformanceLog, roundLog } from '../performance-log.ts';
import { compactLoadingLog } from '../loading-log.ts';
import { createSceneCandidates } from './scene-candidates.ts';
import { Autosave } from './autosave.ts';
import { createBuildingPlacement } from './building-placement.ts';
import { PERFORMANCE_MODES, readPerformanceMode, savePerformanceMode, readLighting, saveLighting, readShadowsEnabled, saveShadowsEnabled } from './graphics-settings.ts';
export { preloadGameAssets } from './model-assets.ts';

export async function createGame(ui: GameUI, economy = new Economy()) {
  const engine = new Engine(ui.canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  const scene = new Scene(engine);
  installMatteMaterials(scene);
  let userShadows=readShadowsEnabled(),performanceMode=readPerformanceMode();
  scene.shadowsEnabled = userShadows;
  scene.clearColor = Color4.FromHexString('#7b8e5dff');
  scene.ambientColor = Color3.Black();
  scene.skipPointerMovePicking = true;
  let meshRevision = 0, selectionRevision = '';
  scene.onNewMeshAddedObservable.add(() => meshRevision++);
  scene.onMeshRemovedObservable.add(() => meshRevision++);
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, 0.76, 200, new Vector3(GRID_SIZE, 0.5, -2), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1; camera.maxZ = 500;
  const mobile = window.matchMedia('(pointer: coarse)').matches;
  let lighting = readLighting();
  const shadows = createDaylight(scene, mobile, lighting);
  const configureShadowLOD = createMapShadowLOD(scene, shadows, camera);
  configureShadowLOD?.();
  const applyPerformance = () => {
    const config=PERFORMANCE_MODES[performanceMode];
    engine.setHardwareScalingLevel(1/(Math.min(window.devicePixelRatio||1,1.5)*config.scale));
    scene.shadowsEnabled=userShadows&&config.shadows;
    shadows.mapSize=performanceMode==='saving'?(mobile?512:1024):(mobile?1024:2048);
    configureShadowLOD?.();setCharacterLODQuality(scene,config.lodArea);refreshFrozenMaterials(scene);
  };
  applyPerformance();
  const palette = createPalette(scene);
  const definitions = () => [...homeResidents(economy.state), ...ENEMIES, ...economy.state.combat.units
    .filter(u=>u.id.startsWith('enemy-raid-')).map(u=>({...newResident(u.role as 'infantry'|'archer',u.id,u.home),name:u.role==='archer'?'来袭弓兵':'来袭步兵'}))];
  let definitionKey=definitions().map(r=>r.id).join(',');
  let saveWarning = false;
  let canSave = false;
  const autosave = new Autosave();
  const frameWork = { logicMs: 0, worldMs: 0, saveMs: 0, sceneMs: 0 };
  const saves = { count: 0, failures: 0, lastMs: 0, maxMs: 0, totalMs: 0, chars: 0 };
  const save = () => {
    if (!canSave) return false;
    const start = performance.now(); autosave.attempted();
    try {
      economy.state.residents = residents.saveResidents(); const text = encodeEconomy(economy);
      localStorage.setItem(ECONOMY_SAVE_KEY, text); saves.chars = text.length; saves.count++; return true;
    } catch { saves.failures++; if (!saveWarning) { ui.toast('浏览器未能保存进度，本次仍可继续游玩'); saveWarning = true; } return false; }
    finally { saves.lastMs = performance.now() - start; saves.maxMs = Math.max(saves.maxMs, saves.lastMs); saves.totalMs += saves.lastMs; frameWork.saveMs += saves.lastMs; }
  };
  let world: ReturnType<typeof buildWorld>;
  let residents: ReturnType<typeof createResidents>;
  let wolves: Awaited<ReturnType<typeof createWolfView>>;
  try {

    await nextPaint();
    world = await loadingProgress.run('map', '地图与基础材质构建', () => buildWorld(scene, palette, shadows, economy));
    residents = createResidents(scene, palette, shadows, ui, world.obstacles, economy.state.vitals, definitions(),id=>towerHeight(economy.state,id));

    await residents.loadFarmerModel();

    await residents.loadSoldierModels();

    await residents.loadRolePlaceholders();
    await residents.loadDogModel();
    wolves = await createWolfView(scene, shadows, ui);
    releaseModelDownloads();

    await nextPaint();
  } catch (error) {
    scene.dispose(); engine.dispose(); throw error;
  }
  residents.restoreResidents(economy.state.residents);
  const combat = new Combat(economy.state.combat, economy, () => world.obstacles(true), () => residents.combatNeighbours());
  residents.syncCombat(combat.state.units);
  const visibilityPoint = new Vector3(), visibilityScreen = new Vector3(), visibilityIdentity = Matrix.Identity();
  residents.setCombatYield((id,from,toward)=>{const u=combat.unit(id);return !!u&&combat.yieldUnit(u,from,toward);});
  const raids = new Raids(economy, combat, {
    status: residents.needsStatus, command: (p, id) => residents.command(p, id), release: residents.releaseFarmerWork,
    resting: residents.setResting, neighbours: residents.combatNeighbours,
  }, () => world.obstacles(true), point => {
    visibilityPoint.set(point.x, 1, point.z);
    Vector3.ProjectToRef(visibilityPoint, visibilityIdentity, scene.getTransformMatrix(), camera.viewport.toGlobal(1, 1), visibilityScreen);
    return visibilityScreen.z >= 0 && visibilityScreen.z <= 1 && visibilityScreen.x >= -.08 && visibilityScreen.x <= 1.08 && visibilityScreen.y >= -.08 && visibilityScreen.y <= 1.08;
  });
  residents.setExtraNeighbours(() => raids.neighbours());
  const occupancy = () => [...residents.occupancy(), ...raids.occupancy()];
  economy.setOccupancy(occupancy);
  const needs = createNeedsController(economy, residents, combat, point => world.doors.useWarehouse(point));
  const combatView = createCombatView(scene);
  combatView.update(combat.state);
  const farmerLeader = roleLeader('farmer');
  const controller = createEconomyController(economy, world, residents, !!farmerLeader, (worker, task) => {
    if (!farmerLeader || !economy.state.steward.enabled) return;
    const name = homeResidents(economy.state).find(r => r.id === worker)?.name ?? '农民';
    const index = economy.state.plots.findIndex(p => p.id === task.target);
    const target = index >= 0 ? `${index + 1}号地` : task.kind === 'haul' ? '这批资源，送到仓库' : task.kind === 'build' ? '建筑' : task.kind === 'chop' ? '这棵树' : '这处石材';
    const work = task.kind === 'sow' && task.crop ? `种${ECONOMY_CONFIG.crops[task.crop].name}` : WORK_NAMES[task.kind];
    ui.sayResident(farmerLeader.id, `${worker === farmerLeader.id ? '我去' : `${name}，去`}${work}${target}。`);
  }, point => world.doors.useWarehouse(point), id => needs.canTakeWork(id) && raids.canWork(id),points=>raids.unsafePath(points));
  const navigation=createNavigationQueue(new Worker(new URL('./navigation.worker.ts',import.meta.url),{type:'module'}));
  const commandVersions=new Map<string,number>();
  const clearGroupMove=(id:string)=>{for(const [key,order]of Object.entries(economy.state.groupMoves))if(order.members.includes(id))delete economy.state.groupMoves[key];};
  const manual = (id: string,keepGroup=false) => { commandVersions.set(id,(commandVersions.get(id)??0)+1);navigation.cancel(id);if(!keepGroup)clearGroupMove(id);needs.manual(id); raids.manual(id); };
  const moveFeedback = createMoveFeedback(scene);
  const attackFeedback = createMoveFeedback(scene, { name: 'attack-target', color: '#f05b4b', arrows:false, diameter:1.4 });
  let attackPulse: { attacker: string; target: string } | undefined;
  const pathGuidance = createPathGuidance(scene);
  const commandGuidance = new CommandGuidance();
  let selectedGroup:number|undefined, settingRally=false;
  let groupGuide:{key:string;route:Point[];solids:unknown}|undefined;
  const selectionFeedback = createSelectionFeedback(scene, shadows);
  const towerRange=createTowerRange(scene);
  let selectedWorld: WorldObject | undefined;
  const clearWorld = () => { selectedWorld = undefined; ui.setSelection(); ui.clearTargetHint(); };
  const combatIds = () => residents.selectedIds().filter(id=>combat.unit(id)?.team==='home');
  const clearResident = () => { selectedGroup=undefined; residents.select(); ui.setResident(); ui.setCombatHint(false); attackFeedback.hide(); attackPulse = undefined; };
  const clearSelection = () => { clearWorld(); clearResident(); };
  const showObjectActions = (object: WorldObject) => {
    const tower=economy.state.towers.find(t=>t.id===object.id&&t.hp>0);
    if(tower){
      const candidate=garrisonCandidate(economy,combat,tower.id,residents.selectedIds()),id=tower.unit??candidate?.id,name=homeResidents(economy.state).find(r=>r.id===id)?.name??'弓兵';
      ui.setSelection(buildingSelection(economy,object.id,{name:'哨塔',kind:'建筑',showHint:true,hint:`${tower.unit?`${name}·${tower.phase==='occupied'?'驻守':tower.phase==='meal'?'休整':'前往中'}`:'空位'} · 射程 ${TOWER_CONFIG.range}`,
        actions:tower.unit?[{id:'tower-select',label:'选中弓兵'},{id:'tower-evict',label:'撤出'}]:[{id:'tower-garrison',label:candidate?`入驻·${name}`:'需要可用弓兵',disabled:!candidate}]}));return;
    }
    if(object.id==='home-center'){ui.setSelection(buildingSelection(economy,object.id,{name:'家园中心',kind:'建筑',hint:'招募居民与士兵',actions:[{id:'recruit',label:'招募',disabled:!buildingOperational(economy.state,object.id)}]}));return;}
    const details = buildingSelection(economy,object.id,economySelection(economy, object)), unit = selectedGroup===undefined?residents.selectedId():residents.selectedIds().find(id=>residents.canWork(id))??residents.selectedId();
    const task = economy.taskFor(object.id);
    if (!economy.campfire(object.id) && unit && residents.canWork(unit) && task?.status === 'waiting') details.actions?.unshift({ id: 'assign', label: '优先执行' });
    if (!economy.campfire(object.id) && unit && !residents.canWork(unit) && details.actions?.some(action => action.id !== 'cancel' && action.id !== 'demolish')) {
      details.hint = '此作业需要农民';
      details.actions = details.actions.map(action => ({ ...action, disabled: action.id !== 'cancel' && action.id !== 'demolish' }));
    }
    ui.setSelection(details);
  };
  const selectWorld = (object: WorldObject) => {
    clearWorld(); selectedWorld = object;
    showObjectActions(object);
  };
  const refreshSelected = () => {
    pruneGroups(economy);
    if(selectedGroup!==undefined){
      const members=groupMembers(economy.state,selectedGroup);
      if(!members.length){clearResident();return;}
      residents.select(members[0],members);
      ui.setResident(`${selectedGroup+1}队·${members.length}`);
      ui.setResidentInfo(groupInfo(economy,selectedGroup,residents.needsStatus));return;
    }
    const id = residents.selectedId();
    ui.setResidentInfo(selectedUnitInfo(economy, id, id ? residents.needsStatus(id) : undefined));
  };
  const refreshEconomy = () => {
    refreshSelected();
    management.refresh(selectedGroup);
    updateEconomyUI(ui, economy);
    ui.setHomeStatus(livingPopulation(economy.state), formatGameTime(economy.state.seconds));
    for (const id of Object.keys(economy.state.vitals)) {
      ui.setUnitHealth(id, health(economy.state, id), maxHealth(id), economy.state.seconds, id === 'horse' ? 'cavalry' : id.startsWith('horse:') ? id.slice(6) : id);
    }
    for (const wolf of raids.wolves) ui.setUnitHealth(wolf.id, wolf.hp, fighterStats(wolf).hp, economy.state.seconds);
    ui.setRaidNotice(raids.state.noticeUntil > economy.state.seconds ? raids.state.notice + (raids.state.phase === 'raid' || raids.state.pendingOrigin ? ' · 查看' : '') : '');
    if (selectedWorld) {
      const object = world.objects.get(selectedWorld.id);
      if (object) { selectedWorld = object; showObjectActions(object); }
      else clearWorld();
    }
  };
  const requestDemolition=(id:string)=>{
    const quote=economy.demolition(id);if(!quote)return;
    ui.confirmDemolition(quote.name,`拆除会取消相关作业${quote.built?`，返还木材 ${quote.refund.wood}、石材 ${quote.refund.stone}，放在地面等待搬运`:'，释放预留材料'}。${economy.plot(id)?'土地和作物将一起移除。':''}确定拆除？`,()=>{
      const resting=homeResidents(economy.state).filter(r=>economy.state.vitals[r.id]?.rest?.camp===id).map(r=>r.id);
      const result=economy.demolish(id,target=>evictTower(economy,combat,target));
      if(result.ok)for(const unit of resting){if(combat.unit(unit))combat.guard([unit]);else residents.releaseFarmerWork(unit);}
      if(result.ok){for(const worker of residents.farmerIds())if(!economy.active(worker))residents.releaseFarmerWork(worker);clearWorld();world.sync();}
      ui.toast(result.message);refreshEconomy();save();
    });
  };
  const performAction = (action: string) => {
    if (!selectedWorld || ui.paused || suspended) return;
    const target = selectedWorld.id;
    if(action==='demolish'){requestDemolition(target);return;}
    if(target==='home-center'&&action==='recruit'){management.open();return;}
    if(action.startsWith('tower-')){
      const tower=economy.state.towers.find(t=>t.id===target&&t.hp>0);if(!tower)return;
      if(action==='tower-garrison'){
        const candidate=garrisonCandidate(economy,combat,target,residents.selectedIds());if(!candidate)return;
        const result=requestGarrison(economy,combat,target,candidate.id);
        if(result.ok){manual(candidate.id);commandGuidance.request(candidate.id,`tower:${target}`);clearResident();}
        ui.targetHint(result.message,selectedWorld.anchor);
      }else if(action==='tower-evict'){
        if(!evictTower(economy,combat,target))ui.targetHint('入口被占用，暂时无法撤出',selectedWorld.anchor);
      }else if(action==='tower-select'&&tower.unit){
        const id=tower.unit;clearWorld();selectedGroup=undefined;const name=residents.select(id);ui.setResident(name);refreshSelected();
      }
      refreshEconomy();save();return;
    }
    const fire = economy.campfire(target);
    if (fire && (action === 'fire-toggle' || action === 'cook-toggle')) {
      if (action === 'fire-toggle') economy.setFire(target, !fire.enabled);
      if (action === 'cook-toggle') economy.setCooking(target, !fire.cooking);
    } else if (action === 'cancel') {
      const task = economy.taskFor(target); if (task) economy.cancel(task.id);
    } else {
      let instruction: Extract<UnitCommand, { kind: 'work' }> | undefined;
      if (action === 'assign') {
        const task = economy.taskFor(target);
        if (task) instruction = { kind: 'work', work: task.kind, target, crop: task.crop };
      } else if (action === 'sow-carrot' || action === 'sow-wheat') instruction = { kind: 'work', work: 'sow', target, crop: action === 'sow-carrot' ? 'carrot' : 'wheat' };
      else if (action === 'till' || action === 'harvest' || action === 'chop' || action === 'mine' || action === 'build' || action === 'repair' || action === 'haul' || action === 'gather' || action === 'tools' || action === 'arms') instruction = { kind: 'work', work: action, target };
      if (instruction) {
        const id = selectedGroup===undefined ? residents.selectedId() : residents.selectedIds().find(id=>residents.canWork(id));
        const result = id ? controller.command(id, instruction) : selectedGroup!==undefined?{ok:false,message:'此作业需要农民'}:economy.request(instruction.work, target, instruction.crop);
        if (result.ok && id) { manual(id); const task=economy.active(id); if(task)commandGuidance.request(id,task.id); setPreview(); clearResident(); }
        ui.targetHint(result.message, selectedWorld.anchor);
      }
    }
    world.sync(); refreshEconomy(); save();
  };
  ui.bindEconomy(performAction, id => {
    if (ui.paused || suspended) return;
    if (economy.cancel(id)) { world.sync(); refreshEconomy(); save(); }
  });
  const management=createHomeManagement(economy,ui,{
    save:()=>{refreshEconomy();return save();},demolish:requestDemolition,
    select:index=>{
      if(ui.paused||suspended)return;
      const members=groupMembers(economy.state,index);if(!members.length)return;
      if(selectedGroup===index){const positions=members.map(id=>combat.unit(id)?.position??residents.needsStatus(id).position);
        setPreview();overview=false;mapCenter.set(positions.reduce((v,p)=>v+p.x,0)/positions.length,.5,positions.reduce((v,p)=>v+p.z,0)/positions.length);clampCenter();}
      clearWorld();selectedGroup=index;residents.select(members[0],members);refreshEconomy();
    },
    rally:()=>{clearSelection();settingRally=true;ui.toast('点击空地设置集合点');},
  });
  refreshEconomy();
  const projectionIdentity = Matrix.Identity();
  const homeCenter = new Vector3(GRID_SIZE, .5, -2);
  const defaultZoom = () => 5 * GRID_SIZE / Math.min(1, engine.getRenderWidth() / engine.getRenderHeight());
  let zoom = defaultZoom();
  let overview = false;
  let previewRole: 'farmer' | 'leader' | undefined;
  let previewZoom = 1;
  const setPreview = (role?: 'farmer' | 'leader') => {
    previewRole = role;
    previewZoom = 1;
    // Keep close-up self-shadows at full detail; the touch map uses the smaller
    // target. Babylon retains the caster list when resizing.
    const shadowSize = role || !mobile ? 2048 : 1024;
    if (shadows.mapSize !== shadowSize) shadows.mapSize = shadowSize;
    configureShadowLOD?.(!!role);
    if (role) { overview = false;  }

  };
  let currentZoom = zoom;
  let renderedFrames = 0;
  let disposed = false;
  let focusLost = !document.hasFocus();
  let pageHidden = false;
  let suspended = document.hidden || focusLost;
  let freshFrame = true;
  let simulationSeconds = 0;
  const metrics = new FrameMetrics();
  const performanceDiagnostics = createPerformanceDiagnostics(engine, scene, shadows);
  const sceneCandidates = createSceneCandidates(scene);
  const lifecycle = new AbortController();
  const target = new Vector3();
  const mapCenter = homeCenter.clone();
  camera.target.copyFrom(homeCenter);
  const zoomBy = (delta: number) => {
    if (suspended || ui.paused) return;
    if (previewRole) previewZoom = Math.max(0.8, Math.min(1.8, previewZoom + delta * 0.15));
    else zoom = Math.max(4, Math.min(MAP_SIZE, zoom + delta));
    currentZoom = zoom; applyProjection();
  };
  const clampCenter = () => { mapCenter.x = Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, mapCenter.x)); mapCenter.z = Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, mapCenter.z)); };
  const placement = createBuildingPlacement(scene, camera, ui, economy, occupancy, () => ui.paused || suspended,
    () => { clearWorld(); setPreview(); }, id => { world.sync(); refreshEconomy(); const object = world.objects.get(id); if (object) selectWorld(object); save(); });
  const input = new MovementInput(ui.canvas, zoomBy, (dx, dy, started) => {
    if (ui.paused || suspended || placement.active) return;
    // Take over from the currently visible center, including an unfinished
    // preview/reset transition. Pointer motion is direct manipulation.
    if (started) mapCenter.copyFrom(camera.target);
    setPreview(); overview = false;
    const units = 2 * currentZoom / Math.max(1, ui.canvas.clientHeight);
    mapCenter.x -= dx * units; mapCenter.z += dy * units / Math.max(0.2, Math.cos(camera.beta)); clampCenter();
    camera.target.copyFrom(mapCenter);
  }, (clientX, clientY) => {
    if (ui.paused || suspended) return;
    if (placement.active) { placement.place(clientX, clientY); return; }
    const rect = ui.canvas.getBoundingClientRect(); const x = clientX - rect.left, y = clientY - rect.top;
    if(settingRally){
      const ray=scene.createPickingRay(x,y,null,camera),distance=-ray.origin.y/ray.direction.y;
      if(distance>0&&Number.isFinite(distance)){
        const point=ray.origin.add(ray.direction.scale(distance));
        const route=planMoveDestination(economy.state.recruitment.rally,point,.4,WORLD_BOUNDS,world.obstacles(true),[]);
        const end=route?.at(-1);if(end){economy.state.recruitment.rally={x:end.x,z:end.z};economy.revision++;settingRally=false;moveFeedback.show(end);save();ui.toast('集合点已更新');}
        else ui.targetHint('无法到达该位置',{x:point.x,y:.2,z:point.z});
      }return;
    }
    const hit = scene.pick(x, y, isWorldPickable);
    if (hit?.pickedMesh?.metadata?.selectionKind === 'resident') {
      const id = hit.pickedMesh.metadata.id;
      const fighter = combat.unit(id);
      if (fighter?.team === 'enemy') {
        const count = combat.attack(combatIds(), id);
        ui.targetHint(count ? '攻击' : '先选择一名士兵', { ...fighter.position, y: fighter.role === 'wolf' ? 1.9 : 2.6 });
        if (count) {
          ui.flashAttackTarget(id, economy.state.seconds);
          attackPulse = { attacker: combatIds()[0], target: id };
          moveFeedback.hide(); attackFeedback.show(fighter.position);
          combatIds().forEach(id=>manual(id)); clearWorld(); setPreview(); save();
        }
        return;
      }
      clearWorld();
      const wasGroup=selectedGroup!==undefined;selectedGroup=undefined;
      const name = residents.select(!wasGroup&&residents.selectedId() === id ? undefined : id);
      ui.setResident(name, !!residents.selectedId() && residents.canWork(residents.selectedId()!),
        residents.selectedId() === farmerLeader?.id ? economy.state.steward.enabled : undefined);
      ui.setCombatHint(!!combat.unit(residents.selectedId() ?? ''));
      refreshSelected();
      return;
    }
    if (hit?.pickedMesh?.metadata?.worldFaceRanges || hit?.pickedMesh?.metadata?.worldObjectId) {
      const id = hit.pickedMesh.metadata.worldObjectId ?? objectAtFace(hit.pickedMesh.metadata.worldFaceRanges, hit.faceId);
      const object = id && world.objects.get(id);
      if (object) {
        selectWorld(object);
        if(object.id==='home-center')return;
        if(economy.state.towers.some(t=>t.id===object.id&&t.hp>0))return;
        if (residents.selectedId() && !economy.campfire(object.id)) {
          const task = economy.taskFor(object.id), actions = buildingSelection(economy,object.id,economySelection(economy, object)).actions ?? [];
          const action = task && task.status !== 'storage' ? 'assign' : actions.length === 1 && actions[0].id !== 'cancel' ? actions[0].id : undefined;
          if (action) performAction(action);
          else if (actions.length && !residents.selectedIds().some(id=>residents.canWork(id))) ui.targetHint('此作业需要农民', object.anchor);
          // Inspecting scenery or a growing crop switches the selection. Work
          // choices keep the unit until an instruction is accepted.
          else if (!actions.length) clearResident();
        }
        return;
      }
    }
    const ray = scene.createPickingRay(x, y, null, camera);
    const distance = -ray.origin.y / ray.direction.y;
    if (distance <= 0 || !Number.isFinite(distance)) return;
    const point = ray.origin.add(ray.direction.scale(distance));
    if (residents.selectedCanMove()) {
      const ids=residents.selectedIds(),defs=homeResidents(economy.state),group=selectedGroup;
      const versions=new Map(ids.map(id=>{navigation.cancel(id);clearGroupMove(id);const v=(commandVersions.get(id)??0)+1;commandVersions.set(id,v);return[id,v];}));
      const current=(id:string)=>commandVersions.get(id)===versions.get(id);
      commandGuidance.clear();clearWorld();setPreview();moveFeedback.show(point);
      const context=(id:string,goal:Point)=>combat.unit(id)?combat.movementInput(id,goal):residents.movementInput(id,goal);
      const launch=(center:Point,common?:Point[])=>{
        const members=ids.filter(current),slots=groupDestinations(members.map(id=>({id,position:combat.unit(id)?.position??residents.needsStatus(id).position,radius:defs.find(r=>r.id===id)!.bodyRadius})),center);
        let accepted=0,finished=0,sharedRoute:readonly Point[]|undefined=common;
        const order=group!==undefined&&common?{members,center:{x:center.x,z:center.z},route:common}:undefined;
        const dispatch=(slot:typeof slots[number],retry=0)=>navigation.request(slot.id,()=>{
          const p=current(slot.id)?context(slot.id,slot.point):undefined;return p?{...p,routeHint:sharedRoute}:undefined;
        },path=>{
          if(!current(slot.id))return;
          const ok=!!path&&(combat.unit(slot.id)?combat.move([slot.id],slot.point,false,false,false,false,path)>0:controller.command(slot.id,{kind:'move',point:slot.point,path}).ok);
          if(path&&!ok&&retry===0){dispatch(slot,1);return;}finished++;
          if(ok){accepted++;sharedRoute=combat.unit(slot.id)?.route??residents.routeFor(slot.id);manual(slot.id,true);
            if(order)economy.state.groupMoves[group!]=order;
            else{const end=path!.at(-1);if(end)moveFeedback.show(end);}
            refreshEconomy();save();
          }
          if(finished===slots.length&&accepted<slots.length){if(!accepted)moveFeedback.hide();ui.targetHint(accepted?`${accepted}/${slots.length} 名已接受指令`:'无法到达该位置',{x:center.x,y:.2,z:center.z});}
        });
        slots.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id)).forEach(slot=>dispatch(slot));
      };
      if(group!==undefined&&ids.length>1){
        // Plan the common destination first. Individual offsets never redefine
        // the guide endpoint; a nearby fallback updates both marker and guide.
        navigation.request(`formation-${group}`,()=>{const id=ids.find(current);return id?context(id,point):undefined;},path=>{
          if(!ids.some(current))return;
          if(!path?.length){moveFeedback.hide();ui.targetHint('无法到达该位置',{x:point.x,y:.2,z:point.z});return;}
          const center=path.at(-1)!;moveFeedback.show(center);launch(center,path);
        });
      }else launch(point);

    }
    else clearSelection();
  }, gesture => {
    if (ui.paused || suspended) return;
    if (previewRole) {
      const previous = previewZoom;
      previewZoom = Math.max(.8, Math.min(1.8, previewZoom / gesture.scale));
      currentZoom *= previewZoom / previous; applyProjection();
      return;
    }
    zoom = currentZoom = pinchMapCamera(scene, camera, gesture, ui.canvas.getBoundingClientRect(), { min: 4, max: MAP_SIZE });
    overview = false;
    // Commit direct manipulation immediately, including any in-flight reset
    // transition; the render loop must not ease back toward the old center.
    mapCenter.copyFrom(camera.target); clampCenter(); camera.target.copyFrom(mapCenter);
  });
  const applyProjection = () => {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    camera.orthoTop = currentZoom; camera.orthoBottom = -currentZoom;
    camera.orthoLeft = -currentZoom * aspect; camera.orthoRight = currentZoom * aspect;
  };
  const resize = () => {
    engine.setHardwareScalingLevel(1 / (Math.min(window.devicePixelRatio || 1, 1.5)*PERFORMANCE_MODES[performanceMode].scale));
    engine.resize(); applyProjection();
    requestRender();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(ui.canvas);
  resize();
  ui.bind('clear-selection',()=>{settingRally=false;commandGuidance.clear();clearSelection();refreshEconomy();});
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && !ui.paused && !suspended) { placement.cancel(); clearSelection(); }
  }, { signal: lifecycle.signal });
  ui.bindPause(() => {
    if (disposed) return;
    if (ui.paused) { placement.cancel(); save(); }
    input.reset(); freshFrame = true;
    scene.resetLastAnimationTimeFrame();
    metrics.reset(); ui.setPerformance(); engine.performanceMonitor.reset();
    refreshEconomy(); requestRender();
  });
  ui.bindShadows(userShadows, enabled => {
    userShadows=enabled;applyPerformance();
    if (!saveShadowsEnabled(enabled)) ui.settingsNotice('阴影设置已生效，浏览器未能保存此偏好');
    freshFrame = true; requestRender();
  });
  ui.bindPerformanceMode(performanceMode,mode=>{
    performanceMode=mode;applyPerformance();
    ui.settingsNotice(savePerformanceMode(mode)?`${PERFORMANCE_MODES[mode].name}已生效，游戏逻辑速度不变`:'性能模式已生效，浏览器未能保存偏好');
    freshFrame=true;requestRender();
  });
  ui.bindLeadership(enabled => {
    if (ui.paused || suspended || residents.selectedId() !== farmerLeader?.id) return;
    economy.setLeadership(enabled);
    if (!enabled && farmerLeader) ui.clearResidentSpeech(farmerLeader.id);
    refreshEconomy(); save();
  });
  ui.bindLighting(lighting, value => {
    lighting = value; applyDaylight(scene, lighting);
    if (!saveLighting(lighting)) ui.settingsNotice('光照已生效，浏览器未能保存此偏好');
    freshFrame = true; requestRender();
  });
  ui.bind('raid-notice', () => {
    if (ui.paused || suspended) return;
    const point=raids.state.pendingOrigin??raids.wolves.find(w=>w.life==='active'&&w.mode!=='gone')?.position
      ??combat.state.units.find(u=>raids.state.soldiers.includes(u.id)&&u.life==='active'&&!u.departed)?.position;
    if(point){setPreview();overview=false;mapCenter.set(point.x,.5,point.z);clampCenter();}
  });
  ui.bind('reset', () => {
    mapCenter.copyFrom(homeCenter); setPreview();
    overview = false; zoom = defaultZoom();
  });
  let uiElapsed = 0;
  let keyboardPanning = false;
  const simulationClock=new SimulationClock(),renderCadence=new RenderCadence();
  let renderElapsed=0,cpuSinceFrame=0,fixedSteps=0;
  residents.resetPresentation();
  // Babylon owns scheduling. A paused panel needs one final frame (for example
  // to clear a building preview), then no animation, culling or GPU submissions.
  // Resizes/context restoration invalidate that retained image once.
  function requestRender() {
    if (!disposed && !suspended) engine.runRenderLoop(render);
  }
  function render() {
    if (disposed || suspended) return;
    const cpuStart = performance.now();
    const resuming = freshFrame;
    freshFrame = false;
    const elapsed = resuming ? 0 : engine.getDeltaTime() / 1000;
    renderElapsed+=elapsed;
    const cameraDt = ui.paused ? 0 : Math.min(elapsed, 0.25);
    const direction = ui.paused ? { x: 0, z: 0 } : input.read();
    if (direction.x || direction.z) {
      // Keyboard pan takes over at the visible position, just like dragging.
      // Keep the camera and destination together so keyup leaves no follow tail.
      if (!keyboardPanning) mapCenter.copyFrom(camera.target);
      setPreview(); overview = false;
      // Fixed world speed, twice the former 7 units/s, independent of zoom.
      mapCenter.x += direction.x * cameraDt * 14; mapCenter.z += direction.z * cameraDt * 14; clampCenter();
      camera.target.copyFrom(mapCenter);
    }
    keyboardPanning = !!(direction.x || direction.z);
    // Do not send update(0) on resume: that would reset an interrupted Run to
    // idle for one frame. Keep the exact frozen pose until normal time resumes.
    const logicStart = performance.now();
    if(!resuming&&!ui.paused)navigation.flush();
    if(!resuming&&!ui.paused) simulationClock.advance(elapsed,dt=>{
        residents.beginStep(); wolves.beginStep(raids.wolves); fixedSteps++;
        ui.advanceSpeech(dt);
        controller.update(dt);
        raids.update(dt);
        const recruited=advanceRecruitment(economy,dt,occupancy());
        const nextKey=definitions().map(r=>r.id).join(',');
        if(nextKey!==definitionKey){definitionKey=nextKey;void residents.syncDefinitions(definitions()).then(()=>requestRender()).catch(error=>{console.error(error);ui.toast('单位模型加载失败，请保存并刷新重试');});}
        if(recruited){
          combat.syncUnits();world.doors.use('home-center');
          const point=economy.state.recruitment.rally;
          if(combat.unit(recruited.id))combat.move([recruited.id],point);else controller.command(recruited.id,{kind:'move',point});
        }
        updateTowers(economy,combat);
        combat.update(dt); residents.syncCombat(combat.state.units);
        residents.update(dt, previewRole, dt);
        needs.update(dt);
        residents.endStep();
        simulationSeconds += dt;
        uiElapsed += dt; autosave.advance(dt);
    });
    frameWork.logicMs += performance.now() - logicStart;
    if(uiElapsed>=.25){refreshEconomy();uiElapsed%=.25;}
    if(autosave.due()) save();
    if(!renderCadence.ready(elapsed,PERFORMANCE_MODES[performanceMode].fps,resuming||ui.paused)){cpuSinceFrame+=performance.now()-cpuStart;return;}
    const cameraRenderDt=ui.paused?0:Math.min(renderElapsed,.25);
    const dt=ui.paused||resuming?0:renderElapsed;
    // Locomotion/work clips run on every rendered frame; fixed-step logic owns
    // outcomes, while position and sampled attacks interpolate completed steps.
    scene.animationTimeScale=ui.paused||resuming?0:1;
    scene.animationsEnabled=!ui.paused&&!resuming;
    if(!scene.animationsEnabled)scene.resetLastAnimationTimeFrame();
    const motion = residents.present(simulationClock.alpha, economy.state.seconds);
    // These are visual-only tracks; transactions and fuel stay in fixed steps.
    world.doors.update(dt);
    world.fires.update(economy.state.campfires, dt, mapCenter);
    combatView.update(combat.state, (1 - simulationClock.alpha) * SimulationClock.step);
    const worldStart = performance.now(); world.sync(); frameWork.worldMs += performance.now() - worldStart;
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const desiredZoom = previewRole === 'leader' ? Math.max(1.55, 0.81 / aspect) * previewZoom : previewRole === 'farmer' ? 2.2 * previewZoom : overview ? Math.max(MAP_SIZE * .5, MAP_SIZE * .52 / aspect) : zoom;
    currentZoom = desiredZoom;
    camera.beta += ((previewRole === 'leader' ? 1.28 : previewRole === 'farmer' ? 1.14 : 0.76) - camera.beta) * (1 - Math.exp(-cameraRenderDt * 7));
    applyProjection();
    if (previewRole) {
      const position = previewRole === 'leader' ? residents.leaderPosition() : residents.farmerPosition();
      target.set(position.x, 0.9, position.z);
    } else if (overview) target.set(0, 0, 0);
    else target.copyFrom(mapCenter);
    Vector3.LerpToRef(camera.target, target, 1 - Math.exp(-cameraRenderDt * 5), camera.target);
    residents.updateAnimationVisibility(camera, ui.paused || resuming ? 0 : dt, !!previewRole);
    // Native instrumentation owns frame counters; track shadow-map replacement.
    performanceDiagnostics.beforeFrame();
    placement.update();
    const selectionKey = `${residents.selectedIds().join(',')}:${selectedWorld?.id ?? ''}:${meshRevision}`;
    if (selectionRevision !== selectionKey) {
      selectionFeedback.update([...residents.selectionMeshes(), ...(selectedWorld ? world.selectionMeshes(selectedWorld.id) : [])], selectedWorld);
      selectionRevision = selectionKey;
    }
    towerRange.update(economy.state.towers.find(t=>t.id===selectedWorld?.id&&t.hp>0));
    wolves.update(raids.wolves, economy.state.seconds, camera, simulationClock.alpha);
    const selectedId = residents.selectedId(), selectedFighter = combatIds().map(id=>combat.unit(id)).find(u=>u?.target)??(selectedId ? combat.unit(selectedId) : undefined);
    const pulse=commandGuidance.sample(economy.state.seconds-(1-simulationClock.alpha)*SimulationClock.step,id=>({token:economy.active(id)?.id??(assignedTower(economy.state,id)?.phase==='approach'?`tower:${assignedTower(economy.state,id)!.id}`:undefined),alive:health(economy.state,id)>0,route:(combat.unit(id)?.route??residents.routeFor(id)).length>0}),selectedId);
    let routeId=selectedId??pulse?.id;
    const order=selectedGroup===undefined?undefined:economy.state.groupMoves[selectedGroup];
    if(order)routeId=order.members.find(id=>health(economy.state,id)>0&&(combat.unit(id)?.route??residents.routeFor(id)).length>0);
    const routeFighter=routeId?combat.unit(routeId):undefined;
    let guideRoute=routeId&&!navigation.pending(routeId)?routeFighter?.route??residents.routeFor(routeId):[];
    if(order&&routeId&&guideRoute.length){
      const p=routeFighter?combat.movementInput(routeId,order.center):residents.movementInput(routeId,order.center);
      if(p){const key=`${routeId}/${order.center.x}/${order.center.z}/${guideRoute.map(v=>`${v.x},${v.z}`).join(';')}`;
        if(!groupGuide||key!==groupGuide.key||p.solids!==groupGuide.solids){
          const live={...p,neighbours:[]};
          groupGuide={key,solids:p.solids,route:validateNavigation(live,[...guideRoute.slice(0,-1),order.center])??validateNavigation(live,order.route)??[]};
        }
        guideRoute=groupGuide.route;
      }
    }else groupGuide=undefined;
    pathGuidance.update(routeId,routeId?residents.displayPosition(routeId)??routeFighter?.position??residents.needsStatus(routeId).position:undefined,
      guideRoute,selectedId?1:pulse?.alpha??1);
    const attackTarget = selectedFighter?.target;
    ui.setAttackTarget(attackTarget && combat.target(attackTarget)?.life === 'active' ? attackTarget : undefined, economy.state.seconds-(1-simulationClock.alpha)*SimulationClock.step);
    if (attackPulse) {
      const target = combat.target(attackPulse.target);
      if (residents.selectedIds().includes(attackPulse.attacker) && attackTarget === attackPulse.target && target?.life === 'active' && attackFeedback.snapshot().visible) attackFeedback.follow(residents.displayPosition(target.id)??wolves.displayPosition(target.id)??target.position);
      else { attackFeedback.hide(); attackPulse = undefined; }
    }
    const sceneStart = performance.now(); scene.render(); frameWork.sceneMs += performance.now() - sceneStart;
    residents.updateLabels(camera); wolves.updateLabels(camera);
    renderElapsed=0;
    if (selectedWorld) {
      const { anchor } = selectedWorld;
      const projected = Vector3.Project(new Vector3(anchor.x, anchor.y, anchor.z), projectionIdentity,
        scene.getTransformMatrix(), camera.viewport.toGlobal(ui.canvas.clientWidth, ui.canvas.clientHeight));
      ui.positionSelection(projected.x, projected.y, projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= ui.canvas.clientWidth && projected.y >= 0 && projected.y <= ui.canvas.clientHeight);
    }
    if (ui.hintAnchor) {
      const anchor = ui.hintAnchor;
      const projected = Vector3.Project(new Vector3(anchor.x, anchor.y, anchor.z), projectionIdentity,
        scene.getTransformMatrix(), camera.viewport.toGlobal(ui.canvas.clientWidth, ui.canvas.clientHeight));
      ui.positionHint(projected.x, projected.y, projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= ui.canvas.clientWidth && projected.y >= 0 && projected.y <= ui.canvas.clientHeight);
    }
    renderedFrames++;
    const sample = !ui.paused && !resuming ? metrics.record(cpuStart-cpuSinceFrame, performance.now()) : undefined;
    cpuSinceFrame=0;
    const context = { mode: performanceMode, fpsLimit: PERFORMANCE_MODES[performanceMode].fps,
      selected: residents.selectedIds().length, selectionKind: selectedWorld?.kind,
      candidates: sceneCandidates.snapshot().candidates, camera: { x: camera.target.x, y: camera.target.y, z: camera.target.z }, shadows: scene.shadowsEnabled,
      motion: { stepMs: SimulationClock.step * 1000, alpha: simulationClock.alpha, steps: fixedSteps, ...motion, interpolation: true, animationClock: 'render' } };
    fixedSteps = 0;
    if (ui.paused || resuming) performanceDiagnostics.resetFrameClock();
    else performanceDiagnostics.frame(cpuStart, metrics.lastFrameCpuMs, frameWork, context);
    frameWork.logicMs = frameWork.worldMs = frameWork.saveMs = frameWork.sceneMs = 0;
    if (sample) {
      ui.setPerformance(sample, scene.getActiveIndices() / 3);
      performanceDiagnostics.record(sample, metrics.cadence, currentZoom, ui.paused, residents.lodSummary(), context);
    }
    if (canSave && ui.paused) engine.stopRenderLoop(render);
  }
  const contextRestored = engine.onContextRestoredObservable.add(requestRender);
  const reconcileVisibility = () => {
    const next = document.hidden || pageHidden || focusLost;
    if (disposed || next === suspended) return;
    suspended = next;
    input.reset();
    if (suspended) {
      engine.stopRenderLoop(render);
      ui.pauseForBackground();
      save();
      if (!previewRole && !overview) mapCenter.copyFrom(camera.target);
    } else {
      freshFrame = true;
      metrics.reset(); ui.setPerformance();
      engine.performanceMonitor.reset();
      requestRender();
    }
  };
  const lifecycleOptions = { signal: lifecycle.signal };
  document.addEventListener('visibilitychange', reconcileVisibility, lifecycleOptions);
  window.addEventListener('blur', () => { focusLost = true; reconcileVisibility(); }, lifecycleOptions);
  window.addEventListener('focus', () => { focusLost = false; reconcileVisibility(); }, lifecycleOptions);
  window.addEventListener('pagehide', () => { pageHidden = true; reconcileVisibility(); }, lifecycleOptions);
  window.addEventListener('pageshow', () => {
    pageHidden = false; focusLost = !document.hasFocus(); reconcileVisibility();
  }, lifecycleOptions);
  document.addEventListener('freeze', () => { pageHidden = true; reconcileVisibility(); }, lifecycleOptions);
  document.addEventListener('resume', () => { pageHidden = false; reconcileVisibility(); }, lifecycleOptions);
  if (suspended) ui.pauseForBackground();
  else engine.runRenderLoop(render);
  try {
    await loadingProgress.run('shaders', '材质、纹理与着色器就绪', async () => {
      const meshes = scene.meshes.filter(m => m.isEnabled() && m.getTotalVertices()), textures = scene.textures;
      while (!scene.isReady()) {
        const ready = meshes.filter(m => m.isReady(true)).length + textures.filter(t => t.isReady()).length;
        loadingProgress.work('shaders', ready, meshes.length + textures.length);
        await nextPaint();
      }
      await scene.whenReadyAsync();
    });
    const failed = loadingProgress.snapshot().find(item => item.state === 'failed' && item.kind === 'download');
    if (failed) throw new Error(`${failed.name}：${failed.error}`);
    loadingProgress.begin('first-frame', '首帧显示');

    if (!renderedFrames) await new Promise<void>(resolve => scene.onAfterRenderObservable.addOnce(() => resolve()));
  } catch (error) {
    performanceDiagnostics.dispose(); lifecycle.abort(); input.dispose(); resizeObserver.disconnect(); engine.dispose(); throw error;
  }
  await nextPaint();
  loadingProgress.done('first-frame');
  canSave = true;
  const cameraState = () => ({ alpha: camera.alpha, beta: camera.beta, zoom: currentZoom, overview, previewRole, x: mapCenter.x, z: mapCenter.z,
    target: { x: camera.target.x, y: camera.target.y, z: camera.target.z } });
  return {
    save,
    diagnosticReport: () => roundLog({
      schema: 2, loading: compactLoadingLog(loadingProgress.snapshot()),
      lighting: { ...lighting },
      graphics: { mode: performanceMode, ...PERFORMANCE_MODES[performanceMode], userShadows },
      selection: { units: residents.selectedIds(), object: selectedWorld?.id, ...selectionFeedback.snapshot() },
      saves: { ...saves, intervalSeconds: autosave.interval }, candidates: sceneCandidates.snapshot(), navigation:navigation.snapshot(),
      performance: { ...compactPerformanceLog(performanceDiagnostics.snapshot()), paused: ui.paused, suspended, renderedFrames },
      camera: cameraState(),
      shadows: {
        enabled: scene.shadowsEnabled,
        lodCamera: shadows.getShadowMap()?.cameraForLOD?.name, filter: shadows.filter,
        mapSize: shadows.mapSize, quality: shadows.filteringQuality,
        casterCount: (shadows.getShadowMap()?.renderList ?? []).filter(mesh => mesh.isEnabled() && mesh.isVisible).length,
        groundReceives: scene.getMeshByName('world-meadow')?.receiveShadows ?? false,
      },
    }),
    markPerformance: performanceDiagnostics.mark,
    /** Read-only diagnostics are exposed only in development or an explicit E2E build. */
    snapshot: () => ({
      lighting: { ...lighting },
      graphics: {mode:performanceMode,...PERFORMANCE_MODES[performanceMode],width:engine.getRenderWidth(),height:engine.getRenderHeight()},
      camera: cameraState(),
      input: { dragging: input.isDragging },
      moveFeedback: moveFeedback.snapshot(),
      attackFeedback: { ...attackFeedback.snapshot(), target: attackPulse?.target },
      pathGuidance: pathGuidance.snapshot(),
      selectionFeedback: selectionFeedback.snapshot(),
      placement: placement.snapshot(),
      suspended, manualPaused: ui.paused, simulationSeconds,
      combat: structuredClone(combat.state),
      wolves: wolves.snapshot(),
      doors: world.doors.snapshot(), fires: world.fires.snapshot(),
      economy: structuredClone(economy.state), farmerWork: residents.farmerWorkState(),
      selection: { resident: residents.selectedId(), group: selectedGroup, members:residents.selectedIds(), building: selectedWorld?.kind === 'building' ? selectedWorld.id : undefined,
        object: selectedWorld && { id: selectedWorld.id, name: selectedWorld.name, kind: selectedWorld.kind } },
      objects: [...world.objects.values()].map(object => {
        const point = Vector3.Project(new Vector3(object.anchor.x, object.anchor.y, object.anchor.z), projectionIdentity,
          scene.getTransformMatrix(), camera.viewport.toGlobal(ui.canvas.clientWidth, ui.canvas.clientHeight));
        return { id: object.id, name: object.name, kind: object.kind, screen: { x: point.x, y: point.y } };
      }),
      landmarks: ui.discoveredCount, frames: renderedFrames,
      meshes: scene.meshes.length,
      farmerModelLoaded: residents.farmerModelLoaded(),
      leaderModelLoaded: residents.leaderModelLoaded(),
      leaderWalking: residents.leaderWalking(),
      leaderRunning: residents.leaderRunning(),
      leaderModel: residents.leaderModelInfo(),
      farmerWalking: residents.farmerWalking(),
      farmerRunning: residents.farmerRunning(),
      farmerModel: residents.farmerModelInfo(),
      farmerLegPose: residents.farmerLegPose(),
      residents: residents.snapshot(),
      characterLibrary: residents.sharedLibraryInfo(),
      cells: world.land.length, fps: metrics.sample?.fps??engine.getFps(),
      performance: { ...metrics.sample, lastFrameCpuMs: metrics.lastFrameCpuMs },
      diagnostics: performanceDiagnostics.snapshot(),
      saves: { ...saves }, candidates: sceneCandidates.snapshot(), navigation:navigation.snapshot(),
      rendering: {
        drawCalls: engine._drawCalls.current,
        activeTriangles: scene.getActiveIndices() / 3,
        visibleGeometryTriangles: scene.meshes.filter(mesh => !mesh.isBlocked && mesh.isEnabled() && mesh.isVisible && mesh.visibility > 0 && mesh.getTotalVertices())
          .reduce((count, mesh) => count + (mesh.getLOD(camera)?.getTotalIndices() ?? 0) / 3, 0),
        batchedParts: scene.meshes.reduce((count, mesh) => count + (mesh.metadata?.batchedParts?.length ?? 0), 0),
      },
      shadows: {
        enabled: scene.shadowsEnabled,
        lodCamera: shadows.getShadowMap()?.cameraForLOD?.name,
        filter: shadows.filter,
        mapSize: shadows.getShadowMap()?.getSize().width,
        mapId: shadows.getShadowMap()?.uniqueId,
        quality: shadows.filteringQuality,
        casters: (shadows.getShadowMap()?.renderList ?? []).filter(mesh => mesh.isEnabled() && mesh.isVisible)
          .map(mesh => ({ name: mesh.name, receive: mesh.receiveShadows })),
        groundReceives: scene.getMeshByName('world-meadow')?.receiveShadows ?? false,
      },
      size: { width: engine.getRenderWidth(), height: engine.getRenderHeight() },
    }),
    dispose() {
      save();
      disposed = true; lifecycle.abort(); input.dispose(); resizeObserver.disconnect(); engine.stopRenderLoop(render);
      engine.onContextRestoredObservable.remove(contextRestored);
      navigation.dispose();management.dispose(); placement.dispose(); selectionFeedback.dispose(); sceneCandidates.dispose(); performanceDiagnostics.dispose(); scene.dispose(); engine.dispose();
    },
  };
}

export type Game = Awaited<ReturnType<typeof createGame>>;
