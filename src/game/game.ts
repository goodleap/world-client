import { createSimulationClient } from './simulation-client.ts';
import { allWolves } from './raid-state.ts';
import type { SimulationEvent } from './simulation.ts';
import type { GamePlatform } from './game-platform.ts';
import { createBrowserPlatform } from './browser-platform.ts';
import { MAP_DEVELOPMENT } from './opening-profile.ts';
import { surfaceHeight, terrainRayDistance } from './terrain-height.ts';
import { towerHeight, assignedTower, garrisonAvailability, TOWER_CONFIG } from './towers.ts';
import { createTowerRange } from './tower-range.ts';
import { SimulationClock, RenderCadence } from './simulation-clock.ts';
import { setCharacterLODQuality } from './character-lod.ts';
import { homeResidents } from './recruitment.ts';
import { buildingDoor } from './construction.ts';
import { groupMembers, groupInfo } from './groups.ts';
import { CommandGuidance } from './command-guidance.ts';
import type { Point } from './movement.ts';
import { selectedUnitInfo, enemyUnitInfo } from './unit-info.ts';
import { createDamageNumbers } from './damage-numbers.ts';
import { createLevelFeedback } from './level-feedback.ts';
import { livingPopulation, formatGameTime } from './home-status.ts';
import { createWolfView } from './wolf-view.ts';
import { health, maxHealth } from './vitals.ts';
import { Combat, fighterStats, fighterRadius } from './combat.ts';
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
import { pinchMapCamera } from './pinch-zoom.ts';
import { WORLD_BOUNDS, GRID_SIZE, MAP_SIZE, HOME_CENTER } from './world-data.ts';
import { createSelectionFeedback } from './selection-feedback.ts';
import '@babylonjs/core/Culling/ray';
import type { GameUI } from '../ui.ts';
import { nextPaint } from '../launcher.ts';
import { FrameMetrics } from './frame-metrics.ts';
import { objectAtFace, isWorldPickable } from './world-selection.ts';
import type { WorldObject } from './world-selection.ts';
import { ENEMIES, newResident, roleLeader } from './resident-data.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import { Economy } from './economy.ts';
import { buildingSelection, economySelection, updateEconomyUI } from './economy-ui.ts';
import { buildingOperational } from './building-state.ts';
import type { UnitCommand } from './economy-controller.ts';
import { releaseModelDownloads } from './asset-cache.ts';
import { createMoveFeedback } from './move-feedback.ts';
import { createPathGuidance } from './path-guidance.ts';
import { createPerformanceDiagnostics } from './performance-diagnostics.ts';
import { readJSHeapMB } from './heap-memory.ts';
import { prepareScene } from './scene-loading.ts';
import { packGeometry } from './geometry-memory.ts';
import { createMinimap } from './minimap.ts';
import { compactPerformanceLog, roundLog } from '../performance-log.ts';
import { compactLoadingLog } from '../loading-log.ts';
import { createSceneCandidates } from './scene-candidates.ts';
import { Autosave } from './autosave.ts';
import { createBuildingPlacement } from './building-placement.ts';
import { PERFORMANCE_MODES, readPerformanceMode, savePerformanceMode, readLighting, saveLighting, readShadowsEnabled, saveShadowsEnabled } from './graphics-settings.ts';
export { preloadGameAssets } from './model-assets.ts';

export async function createGame(ui: GameUI, economy = new Economy(), platform:GamePlatform=createBrowserPlatform(ui)) {
  const engine = new Engine(platform.canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
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
  const homeCenter = new Vector3(HOME_CENTER.x, surfaceHeight(HOME_CENTER.x, HOME_CENTER.z) + HOME_CENTER.height / 2, HOME_CENTER.z);
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, 0.76, 200, homeCenter.clone(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1; camera.maxZ = 500;
  const mobile = platform.state.mobile;
  let lighting = readLighting();
  const shadows = createDaylight(scene, mobile, lighting);
  const configureShadowLOD = createMapShadowLOD(scene, shadows, camera);
  configureShadowLOD?.();
  const applyPerformance = () => {
    const config=PERFORMANCE_MODES[performanceMode];
    engine.setHardwareScalingLevel(1/(Math.min(platform.state.dpr||1,1.5)*config.scale));
    scene.shadowsEnabled=userShadows&&config.shadows;
    shadows.mapSize=performanceMode==='saving'?(mobile?512:1024):(mobile?1024:2048);
    configureShadowLOD?.();setCharacterLODQuality(scene,config.lodArea);refreshFrozenMaterials(scene);
  };
  applyPerformance();
  const palette = createPalette(scene);
  const definitions = () => [...homeResidents(economy.state), ...ENEMIES, ...economy.state.combat.units
    .filter(u=>u.id.startsWith('enemy-raid-')).map(u=>({...newResident(u.role as 'infantry'|'archer'|'cavalry',u.id,u.home),name:u.role==='archer'?'来袭弓兵':u.role==='cavalry'?'来袭骑兵':'来袭步兵'}))];
  let definitionKey=definitions().map(r=>r.id).join(',');
  let saveWarning = false;
  let canSave = false;
  let renderReady = false;
  const autosave = new Autosave();
  const frameWork = { logicMs: 0, worldMs: 0, saveMs: 0, sceneMs: 0 };
  const saves = { count: 0, failures: 0, lastMs: 0, maxMs: 0, totalMs: 0, roundTripMs:0, chars: 0 };
  let saveRequested=false,saveInFlight:Promise<boolean>|undefined;
  const save = ():Promise<boolean> => {
    if (!canSave) return Promise.resolve(false);
    saveRequested=true;if(saveInFlight)return saveInFlight;
    saveInFlight=(async()=>{
      let ok=true;
      while(saveRequested){
        saveRequested=false;const start=performance.now();autosave.attempted();
        try{
          const result=await simulation.save();
          if(!await platform.persist(result.text))throw new Error('Storage write failed');
          saves.chars=result.text.length;saves.count++;saves.lastMs=result.encodeMs;saves.maxMs=Math.max(saves.maxMs,result.encodeMs);saves.totalMs+=result.encodeMs;
        }catch{ok=false;saves.failures++;if(!saveWarning){ui.toast('浏览器未能保存进度，本次仍可继续游玩');saveWarning=true;}}
        finally{saves.roundTripMs=performance.now()-start;}
      }
      return ok;
    })().finally(()=>{saveInFlight=undefined;});
    return saveInFlight;
  };
  const simulation=await loadingProgress.run('simulation','导航网格与模拟线程就绪',()=>createSimulationClient(economy,platform.checkpoint,message=>{console.error(message);ui.toast('模拟线程异常，请保存诊断后刷新');}));
  let world: Awaited<ReturnType<typeof buildWorld>>;
  let residents: ReturnType<typeof createResidents>;
  let wolves: Awaited<ReturnType<typeof createWolfView>> | undefined;
  try {

    await nextPaint();
    world = await loadingProgress.run('map', '地图与基础材质构建', async () => {
      const world = await buildWorld(scene, palette, shadows, economy);
      // Release oversized procedural arrays before cloning the actor library.
      // Work in small batches so the loading screen continues to paint.
      let started = performance.now();
      for (const geometry of scene.getGeometries()) {
        packGeometry(geometry);
        if (performance.now() - started >= 8) { await nextPaint(); started = performance.now(); }
      }
      return world;
    });
    // The picking box is built at the model bounds' center. Its transform is
    // ready before the first render, unlike the lazily updated world bounds.
    const centerHit=scene.getMeshByName('home-center-building-hit');
    if(centerHit)homeCenter.copyFrom(centerHit.position);
    residents = createResidents(scene, palette, shadows, ui, world.obstacles, economy.state.vitals, definitions(),id=>towerHeight(economy.state,id),
      id=>economy.state.combat.units.find(u=>u.id===id)?.position??economy.state.residents[id]?.position);

    await residents.loadFarmerModel();

    await residents.loadSoldierModels();

    await residents.loadRolePlaceholders();
    await residents.loadDogModel();
    if(!MAP_DEVELOPMENT)wolves = await createWolfView(scene, shadows, ui);
    releaseModelDownloads();

    await nextPaint();
  } catch (error) {
    await simulation.dispose(); scene.dispose(); engine.dispose(); throw error;
  }
  residents.applySimulation(Object.values(simulation.view.residents),0);
  const combat = new Combat(economy.state.combat, economy, () => world.obstacles(true), () => residents.combatNeighbours());
  const damageHost=platform.overlay();
  const damageNumbers=createDamageNumbers(damageHost),damagePoint=new Vector3(),damageScreen=new Vector3(),damageIdentity=Matrix.Identity();
  const projectDamage=(p:{x:number;y:number;z:number})=>{
    damagePoint.set(p.x,p.y,p.z);Vector3.ProjectToRef(damagePoint,damageIdentity,scene.getTransformMatrix(),camera.viewport.toGlobal(ui.canvas.clientWidth,ui.canvas.clientHeight),damageScreen);
    return {x:damageScreen.x,y:damageScreen.y,visible:damageScreen.z>=0&&damageScreen.z<=1&&damageScreen.x>=0&&damageScreen.x<=ui.canvas.clientWidth&&damageScreen.y>=0&&damageScreen.y<=ui.canvas.clientHeight};
  };
  const showDamage=(hit:Extract<SimulationEvent,{type:"damage"}>["hit"])=>{
    const object=world.objects.get(hit.target),anchor=object?.labelAnchor??object?.anchor;
    if(anchor)hit={...hit,point:{...anchor}};
    damageNumbers.add(hit,economy.state.seconds,projectDamage(hit.point).visible);
  };
  const levelFeedback=createLevelFeedback(scene,damageHost);
  const levelPosition=(id:string)=>{
    const u=combat.unit(id),p=residents.displayPosition(id)??u?.position;
    return u?.life==='active'&&p?{x:p.x,z:p.z,y:surfaceHeight(p.x,p.z)+towerHeight(economy.state,id)}:undefined;
  };
  const showLevel=(id:string,level:number)=>{const p=levelPosition(id);if(p&&projectDamage({...p,y:p.y+1}).visible)levelFeedback.show(id,level,economy.state.seconds,p);};
  residents.syncCombat(combat.state.units);
  const raids={get state(){return economy.state.raids;},get wolves(){return allWolves(economy.state.raids);}};
  combat.setThreats(raids.wolves);combat.setResidentPositions(id=>residents.needsStatus(id).position);
  const occupancy=()=>[...residents.occupancy(),...raids.wolves.filter(w=>w.life==='active'&&w.mode!=='gone').map(w=>({kind:'circle' as const,...w.position,radius:fighterRadius(w)}))];
  const combatView = createCombatView(scene);
  combatView.update(combat.state);
  const farmerLeader = roleLeader('farmer');
  const moveFeedback = createMoveFeedback(scene);
  const attackFeedback = createMoveFeedback(scene, { name: 'attack-target', color: '#f05b4b', arrows:false, diameter:1.4 });
  let attackPulse: { attacker: string; target: string } | undefined;
  const pathGuidance = createPathGuidance(scene);
  const rallyGuidance = createPathGuidance(scene, surfaceHeight, 'rally-connection');
  let shownRally: Point | undefined;
  const commandGuidance = new CommandGuidance();
  let selectedGroup:number|undefined, rallyAttempt=0;
  const selectionFeedback = createSelectionFeedback(scene, shadows);
  const towerRange=createTowerRange(scene);
  let selectedWorld: WorldObject | undefined;
  let selectedEnemy: string | undefined;
  const clearEnemy = () => { if(selectedEnemy)ui.setResident();selectedEnemy = undefined; ui.setInspectedUnits([]); selectionFeedback.inspectEnemy(); };
  const clearWorld = () => { rallyAttempt++; clearEnemy(); selectedWorld = undefined; ui.setSelection(); ui.clearTargetHint(); };
  const combatIds = () => residents.selectedIds().filter(id=>combat.unit(id)?.team==='home');
  const clearResident = () => { clearEnemy(); selectedGroup=undefined; residents.select(); ui.setResident(); ui.setCombatHint(false); attackFeedback.hide(); attackPulse = undefined; };
  const clearSelection = () => { clearWorld(); clearResident(); };
  const showObjectActions = (object: WorldObject) => {
    const tower=economy.state.towers.find(t=>t.id===object.id&&t.hp>0);
    if(tower){
      const availability=garrisonAvailability(economy,combat,tower.id,residents.selectedIds()),candidate=availability.candidate,id=tower.unit??candidate?.id,name=homeResidents(economy.state).find(r=>r.id===id)?.name??'弓兵';
      ui.setSelection(buildingSelection(economy,object.id,{name:'哨塔',kind:'建筑',showHint:true,hint:`${tower.unit?`${name}·${tower.phase==='occupied'?'驻守':tower.phase==='meal'?'休整':'前往中'}`:'空位'} · 射程 ${TOWER_CONFIG.range}`,
        actions:tower.unit?[{id:'tower-select',label:'选中弓兵'},{id:'tower-evict',label:'撤出'}]:[{id:'tower-garrison',label:candidate?`入驻·${name}`:availability.reason,disabled:!candidate}]}),object.id);return;
    }
    if(object.id==='home-center'){ui.setSelection(buildingSelection(economy,object.id,{name:'家园中心',kind:'建筑',hint:'点击空地设置集合点',actions:[{id:'recruit',label:'招募',disabled:!buildingOperational(economy.state,object.id)}]}),object.id);return;}
    const details = buildingSelection(economy,object.id,economySelection(economy, object)), unit = selectedGroup===undefined?residents.selectedId():residents.selectedIds().find(id=>residents.canWork(id))??residents.selectedId();
    const task = economy.taskFor(object.id);
    if (!economy.campfire(object.id) && unit && residents.canWork(unit) && task?.status === 'waiting') details.actions?.unshift({ id: 'assign', label: '优先执行' });
    if (!economy.campfire(object.id) && unit && !residents.canWork(unit)
      && (details.actions?.some(action => action.id !== 'cancel' && action.id !== 'demolish') || task && task.status !== 'storage')) {
      details.hint = '此作业需要农民'; details.showHint = true;
      details.actions = (details.actions ?? []).map(action => ({ ...action, disabled: action.id !== 'cancel' && action.id !== 'demolish' }));
    }
    ui.setSelection(details,object.id);
  };
  const selectWorld = (object: WorldObject) => {
    clearWorld();
    if (object.id === 'home-center') clearResident();
    selectedWorld = object;
    showObjectActions(object);
  };
  const refreshSelected = () => {

    if(selectedEnemy){
      const u=combat.unit(selectedEnemy),info=u&&enemyUnitInfo(u);
      if(!u||!info){clearEnemy();return;}
      const name=ENEMIES.find(r=>r.id===u.id)?.name??({infantry:'来袭步兵',archer:'来袭弓兵',cavalry:'来袭骑兵',wolf:'灰狼'})[u.role];
      ui.setResident(name);ui.setResidentInfo(info);return;
    }
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
      ui.setUnitHealth(id, health(economy.state, id), maxHealth(id, economy.state), economy.state.seconds, id === 'horse' ? 'cavalry' : id.startsWith('horse:') ? id.slice(6) : id);
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
    ui.confirmDemolition(quote.name,`农民到场敲打 ${ECONOMY_CONFIG.workSeconds.demolish} 秒后完成拆除，可中途取消。原有作业会取消${quote.built?`，完成后返还木材 ${quote.refund.wood}、石材 ${quote.refund.stone}，等待搬运`:'，释放预留材料'}。${economy.plot(id)?'土地和作物将一起移除。':''}`,async()=>{
      const result=await simulation.command({type:'demolish',id});
      if(result.ok)world.sync();
      ui.toast(result.message);refreshEconomy();save();
    });
  };
  const performAction = async (action: string) => {
    if (!selectedWorld || ui.paused || suspended) return;
    const target = selectedWorld.id;
    if(action==='demolish'){requestDemolition(target);return;}
    if(target==='home-center'&&action==='recruit'){management.open();return;}
    if(action.startsWith('tower-')){
      const tower=economy.state.towers.find(t=>t.id===target&&t.hp>0);if(!tower)return;
      if(action==='tower-garrison'){
        const result=await simulation.command({type:'garrison',tower:target,selected:residents.selectedIds()});
        if(result.ok&&result.id){commandGuidance.request(result.id,`tower:${target}`);clearResident();}
        ui.targetHint(result.message,selectedWorld.anchor);
      }else if(action==='tower-evict'){
        if(!(await simulation.command({type:'evict',tower:target})).ok)ui.targetHint('入口被占用，暂时无法撤出',selectedWorld.anchor);
      }else if(action==='tower-select'&&tower.unit){
        const id=tower.unit;clearWorld();selectedGroup=undefined;const name=residents.select(id);ui.setResident(name);refreshSelected();
      }
      refreshEconomy();save();return;
    }
    const fire = economy.campfire(target);
    if (fire && (action === 'fire-toggle' || action === 'cook-toggle')) {
      await simulation.command({type:'fire',id:target,action});
    } else if (action === 'cancel') {
      const task = economy.taskFor(target); if (task) await simulation.command({type:'cancel',id:task.id});
    } else {
      let instruction: Extract<UnitCommand, { kind: 'work' }> | undefined;
      if (action === 'assign') {
        const task = economy.taskFor(target);
        if (task) instruction = { kind: 'work', work: task.kind, target, crop: task.crop };
      } else if (action === 'sow-carrot' || action === 'sow-wheat') instruction = { kind: 'work', work: 'sow', target, crop: action === 'sow-carrot' ? 'carrot' : 'wheat' };
      else if (action === 'till' || action === 'harvest' || action === 'chop' || action === 'mine' || action === 'build' || action === 'repair' || action === 'haul' || action === 'gather' || action === 'tools' || action === 'arms') instruction = { kind: 'work', work: action, target };
      if (instruction) {
        const id = selectedGroup===undefined ? residents.selectedId() : residents.selectedIds().find(id=>residents.canWork(id));
        if (id && !residents.canWork(id) || selectedGroup !== undefined && !id) {
          ui.clearTargetHint(); showObjectActions(selectedWorld); return;
        }
        const result=await simulation.command({type:'work',id,instruction});
        if (result.ok && id) { const task=economy.active(id); if(task)commandGuidance.request(id,task.id); setPreview(); clearResident(); }
        ui.targetHint(result.message, selectedWorld.anchor);
      }
    }
    world.sync(); refreshEconomy(); save();
  };
  ui.bindEconomy(performAction, async id => {
    if (ui.paused || suspended) return;
    if ((await simulation.command({type:'cancel',id})).ok) { world.sync(); refreshEconomy(); save(); }
  });
  const setLeadership=async(enabled:boolean)=>{
    await simulation.command({type:'leadership',enabled});
    ui.setLeadership(enabled);
    if (!enabled && farmerLeader) ui.clearResidentSpeech(farmerLeader.id);
    refreshEconomy(); save();
  };
  const management=platform.management(economy,ui,{
    action:async action=>(await simulation.command({type:'home',action})).message,
    leadership:setLeadership,
    save:()=>{refreshEconomy();return save();},demolish:requestDemolition,
    select:index=>{
      if(ui.paused||suspended)return;
      const members=groupMembers(economy.state,index);if(!members.length)return;
      if(selectedGroup===index){const positions=members.map(id=>combat.unit(id)?.position??residents.needsStatus(id).position);
        setPreview();overview=false;mapCenter.set(positions.reduce((v,p)=>v+p.x,0)/positions.length,.5,positions.reduce((v,p)=>v+p.z,0)/positions.length);clampCenter();}
      clearWorld();selectedGroup=index;residents.select(members[0],members);refreshEconomy();
    },
  });
  refreshEconomy();
  const projectionIdentity = Matrix.Identity();
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
  let suspended = platform.state.background;
  let freshFrame = true;
  let simulationSeconds = 0;
  const metrics = new FrameMetrics();
  const performanceDiagnostics = createPerformanceDiagnostics(engine, scene, shadows);
  const minimap = createMinimap(ui.minimapCanvas);
  const sceneCandidates = createSceneCandidates(scene);
  const cleanup:(()=>void)[]=[];
  const lifecycle={abort(){cleanup.splice(0).forEach(dispose=>dispose());}};
  const target = new Vector3();
  const mapCenter = homeCenter.clone();
  let mapDestination:Point|undefined;
  camera.target.copyFrom(homeCenter);
  const zoomBy = (delta: number) => {
    if (suspended || ui.paused) return;
    if (previewRole) previewZoom = Math.max(0.8, Math.min(1.8, previewZoom + delta * 0.15));
    else zoom = Math.max(4, Math.min(MAP_SIZE, zoom + delta));
    currentZoom = zoom; applyProjection();
  };
  const clampCenter = () => { mapCenter.x = Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, mapCenter.x)); mapCenter.z = Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, mapCenter.z)); };
  ui.bindMap((x,y)=>{
    mapDestination={x:WORLD_BOUNDS.minX+x*(WORLD_BOUNDS.maxX-WORLD_BOUNDS.minX),z:WORLD_BOUNDS.maxZ-y*(WORLD_BOUNDS.maxZ-WORLD_BOUNDS.minZ)};requestRender();
  },()=>{
    if(mapDestination&&!suspended&&!disposed){setPreview();overview=false;mapCenter.set(mapDestination.x,.5,mapDestination.z);clampCenter();camera.target.copyFrom(mapCenter);requestRender();}
    mapDestination=undefined;
  });
  const placement = createBuildingPlacement(scene, camera, ui, economy, occupancy, () => ui.paused || suspended,
    () => { clearWorld(); setPreview(); }, id => { world.sync(); refreshEconomy(); const object = world.objects.get(id); if (object) selectWorld(object); save(); },platform.placement(ui),async(kind,point)=>simulation.command({type:'place',kind,point}));
  const input = platform.input(ui.canvas, zoomBy, (dx, dy, started) => {
    if (ui.paused || suspended || placement.active) return;
    // Take over from the currently visible center, including an unfinished
    // preview/reset transition. Pointer motion is direct manipulation.
    if (started) mapCenter.copyFrom(camera.target);
    setPreview(); overview = false;
    const units = 2 * currentZoom / Math.max(1, ui.canvas.clientHeight);
    mapCenter.x -= dx * units; mapCenter.z += dy * units / Math.max(0.2, Math.cos(camera.beta)); clampCenter();
    camera.target.copyFrom(mapCenter);
  }, async (clientX, clientY) => {
    if (ui.paused || suspended) return;
    if (placement.active) { placement.place(clientX, clientY); return; }
    const rect = ui.canvas.getBoundingClientRect(); const x = clientX - rect.left, y = clientY - rect.top;
    const hit = scene.pick(x, y, isWorldPickable);
    if (hit?.pickedMesh?.metadata?.selectionKind === 'resident') {
      const id = hit.pickedMesh.metadata.id;
      const fighter = combat.unit(id);
      if (fighter?.team === 'enemy') {
        if (!combatIds().length) {
          const toggleOff = selectedEnemy === id;
          clearSelection();
          if (!toggleOff && fighter.life === 'active' && fighter.hp > 0 && !fighter.departed) {
            selectedEnemy = id; ui.setInspectedUnits([id]);refreshSelected();
          }
          return;
        }
        const attackers=combatIds();const count=(await simulation.command({type:'attack',ids:attackers,target:id})).count??0;
        ui.targetHint(count ? '攻击' : '先选择一名士兵', { ...fighter.position, y: surfaceHeight(fighter.position.x,fighter.position.z)+(fighter.role === 'wolf' ? 1.9 : 2.6) });
        if (count) {
          ui.flashAttackTarget(id, economy.state.seconds);
          attackPulse = { attacker: combatIds()[0], target: id };
          moveFeedback.hide(); attackFeedback.show(fighter.position);
          clearWorld(); setPreview(); save();
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
          // Inspecting scenery or a growing crop switches the selection. Work
          // choices keep the unit until an instruction is accepted.
          else if (!actions.length) clearResident();
        }
        return;
      }
    }
    const ray = scene.createPickingRay(x, y, null, camera);
    const distance = terrainRayDistance(ray);
    if (distance === null) return;
    const point = ray.origin.add(ray.direction.scale(distance));
    if (selectedWorld?.id === 'home-center') {
      const attempt = ++rallyAttempt;
      const result = await simulation.command({type:'rally',point:{x:point.x,z:point.z}});
      if (selectedWorld?.id !== 'home-center' || attempt !== rallyAttempt) return;
      if (result.ok && result.point) { moveFeedback.show(result.point); save(); ui.toast(result.message); }
      else ui.targetHint(result.message,{x:point.x,y:surfaceHeight(point.x,point.z)+.2,z:point.z});
      return;
    }
    if (residents.selectedCanMove()) {
      const ids=residents.selectedIds(),group=selectedGroup;
      commandGuidance.clear();clearWorld();setPreview();moveFeedback.show(point);
      const result=await simulation.command({type:'move',ids,point:{x:point.x,z:point.z},group});
      if(result.ok&&result.point){moveFeedback.show(result.point);refreshEconomy();save();}
      else moveFeedback.hide();
      if(result.message)ui.targetHint(result.message,{x:point.x,y:surfaceHeight(point.x,point.z)+.2,z:point.z});

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
    engine.setHardwareScalingLevel(1 / (Math.min(platform.state.dpr || 1, 1.5)*PERFORMANCE_MODES[performanceMode].scale));
    engine.setSize(Math.max(1,Math.round(platform.state.width/engine.getHardwareScalingLevel())),Math.max(1,Math.round(platform.state.height/engine.getHardwareScalingLevel()))); applyProjection();
    requestRender();
  };
  const resizeObserver={disconnect:platform.subscribe('resize',resize)};
  resize();
  ui.bind('clear-selection',()=>{commandGuidance.clear();clearSelection();refreshEconomy();});
  cleanup.push(platform.subscribe('escape',()=>{if(!ui.paused&&!suspended){placement.cancel();clearSelection();}}));
  ui.bindPause(async () => {
    if (disposed) return;
    await simulation.pause(ui.paused||suspended);
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
    setLeadership(enabled);
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
  const renderCadence=new RenderCadence();
  const simulationClock={get alpha(){return simulation.alpha;},get pendingSeconds(){return simulation.backlogMs/1000;}};
  let renderElapsed=0,cpuSinceFrame=0,fixedSteps=0,lastViewKey='';
  residents.resetPresentation();
  // Babylon owns scheduling. A paused panel needs one final frame (for example
  // to clear a building preview), then no animation, culling or GPU submissions.
  // Resizes/context restoration invalidate that retained image once.
  function requestRender() {
    if (renderReady && !disposed && !suspended) engine.runRenderLoop(render);
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
    if(uiElapsed>=.25){refreshEconomy();uiElapsed%=.25;}
    if(autosave.due()) void save();
    if(!renderCadence.ready(elapsed,PERFORMANCE_MODES[performanceMode].fps,resuming||ui.paused)){cpuSinceFrame+=performance.now()-cpuStart;return;}
    const cameraRenderDt=ui.paused?0:Math.min(renderElapsed,.25);
    const dt=ui.paused||resuming?0:renderElapsed;
    // Locomotion/work clips run on every rendered frame; fixed-step logic owns
    // outcomes, while position and sampled attacks interpolate completed steps.
    scene.animationTimeScale=ui.paused||resuming?0:1;
    scene.animationsEnabled=!ui.paused&&!resuming;
    if(!scene.animationsEnabled)scene.resetLastAnimationTimeFrame();
    simulation.present();
    const motion = residents.present(simulationClock.alpha, economy.state.seconds,simulation.duration);
    // These are visual-only tracks; transactions and fuel stay in fixed steps.
    world.doors.update(dt);
    world.fires.update(economy.state.campfires, dt, mapCenter);
    combatView.update(combat.state, (1 - simulationClock.alpha) * simulation.duration);
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
    wolves?.update(raids.wolves, economy.state.seconds, camera, simulationClock.alpha,simulation.duration);
    if (selectedEnemy) {
      const enemy = combat.unit(selectedEnemy);
      if (!enemy || enemy.life !== 'active' || enemy.hp <= 0 || enemy.departed) clearEnemy();
      else selectionFeedback.inspectEnemy(residents.displayPosition(enemy.id) ?? wolves?.displayPosition(enemy.id) ?? enemy.position, fighterRadius(enemy) + .25);
    }
    const selectedId = residents.selectedId(), selectedFighter = combatIds().map(id=>combat.unit(id)).find(u=>u?.target)??(selectedId ? combat.unit(selectedId) : undefined);
    const pulse=commandGuidance.sample(economy.state.seconds-(1-simulationClock.alpha)*SimulationClock.step,id=>({token:economy.active(id)?.id??(assignedTower(economy.state,id)?.phase==='approach'?`tower:${assignedTower(economy.state,id)!.id}`:undefined),alive:health(economy.state,id)>0,route:(combat.unit(id)?.route??residents.routeFor(id)).length>0}),selectedId);
    let routeId=selectedId??pulse?.id;
    const order=selectedGroup===undefined?undefined:economy.state.groupMoves[selectedGroup];
    if(order)routeId=order.members.find(id=>health(economy.state,id)>0&&(combat.unit(id)?.route??residents.routeFor(id)).length>0);
    const routeFighter=routeId?combat.unit(routeId):undefined;
    let guideRoute=routeId?routeFighter?.route??residents.routeFor(routeId):[];
    if(order&&routeId&&guideRoute.length)guideRoute=order.route;
    pathGuidance.update(routeId,routeId?residents.displayPosition(routeId)??routeFighter?.position??residents.needsStatus(routeId).position:undefined,
      guideRoute,selectedId?1:pulse?.alpha??1);
    if (selectedWorld?.id === 'home-center') {
      const rally = economy.state.recruitment.rally;
      if (!shownRally || shownRally.x !== rally.x || shownRally.z !== rally.z) {
        shownRally = { ...rally };
        rallyGuidance.update('home-center', buildingDoor(HOME_CENTER), [rally]);
      }
    } else if (shownRally) { shownRally = undefined; rallyGuidance.update(undefined); }
    const attackTarget = selectedFighter?.target;
    ui.setAttackTarget(attackTarget && combat.target(attackTarget)?.life === 'active' ? attackTarget : undefined, economy.state.seconds-(1-simulationClock.alpha)*SimulationClock.step);
    if (attackPulse) {
      const target = combat.target(attackPulse.target);
      if (residents.selectedIds().includes(attackPulse.attacker) && attackTarget === attackPulse.target && target?.life === 'active' && attackFeedback.snapshot().visible) attackFeedback.follow(residents.displayPosition(target.id)??wolves?.displayPosition(target.id)??target.position);
      else { attackFeedback.hide(); attackPulse = undefined; }
    }
    levelFeedback.update(economy.state.seconds-(1-simulationClock.alpha)*SimulationClock.step,levelPosition,projectDamage);
    const sceneStart = performance.now(); scene.render(); frameWork.sceneMs += performance.now() - sceneStart;
    residents.updateLabels(camera); wolves?.updateLabels(camera);
    ui.setInspectedUnits([...residents.selectedIds(),...(selectedEnemy?[selectedEnemy]:[])]);
    damageNumbers.update(economy.state.seconds-(1-simulationClock.alpha)*SimulationClock.step,projectDamage);
    renderElapsed=0;
    if (selectedWorld) {
      const anchor=selectedWorld.labelAnchor??selectedWorld.anchor;
      const projected = Vector3.Project(new Vector3(anchor.x, anchor.y, anchor.z), projectionIdentity,
        scene.getTransformMatrix(), camera.viewport.toGlobal(ui.canvas.clientWidth, ui.canvas.clientHeight));
      ui.positionSelection(projected.x, projected.y, projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= ui.canvas.clientWidth && projected.y >= 0 && projected.y <= ui.canvas.clientHeight,selectedWorld.id);
      const action=projectDamage(selectedWorld.anchor);ui.positionObjectActions(action.x,action.y,action.visible,selectedWorld.id);
    }
    if (ui.hintAnchor) {
      const anchor = ui.hintAnchor;
      const projected = Vector3.Project(new Vector3(anchor.x, anchor.y, anchor.z), projectionIdentity,
        scene.getTransformMatrix(), camera.viewport.toGlobal(ui.canvas.clientWidth, ui.canvas.clientHeight));
      ui.positionHint(projected.x, projected.y, projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= ui.canvas.clientWidth && projected.y >= 0 && projected.y <= ui.canvas.clientHeight,anchor.revision);
    }
    platform.flush();
    renderedFrames++;
      // Babylon unprojects the actual orthographic viewport; no guessed zoom box.
      const width = engine.getRenderWidth() * engine.getHardwareScalingLevel(), height = engine.getRenderHeight() * engine.getHardwareScalingLevel();
      const view = [[0, 0], [width, 0], [width, height], [0, height]].flatMap(([x, y]) => {
        const ray = scene.createPickingRay(x, y, projectionIdentity, camera), distance = terrainRayDistance(ray);
        if (distance === null) return [];
        const p = ray.origin.add(ray.direction.scale(distance)); return [{ x: p.x, z: p.z }];
      });
      const viewKey=view.map(p=>`${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';');
      if(view.length&&viewKey!==lastViewKey){lastViewKey=viewKey;simulation.setView({minX:Math.min(...view.map(p=>p.x)),maxX:Math.max(...view.map(p=>p.x)),minZ:Math.min(...view.map(p=>p.z)),maxZ:Math.max(...view.map(p=>p.z))});}
    minimap.update(cpuStart, ui.minimapOpen, () => {
      const selected = new Set(residents.selectedIds());
      if (selectedEnemy) selected.add(selectedEnemy);
      const units = combat.state.units.filter(u => u.life === 'active' && !u.departed).map(u => ({
        id: u.id, ...(residents.displayPosition(u.id) ?? u.position), enemy: u.team === 'enemy', selected: selected.has(u.id),
      }));
      for (const d of homeResidents(economy.state)) if ((d.role === 'farmer' || d.role === 'dog') && (economy.state.vitals[d.id]?.hp ?? 0) > 0) {
        const p = residents.displayPosition(d.id); if (p) units.push({ id: d.id, x: p.x, z: p.z, enemy: false, selected: selected.has(d.id) });
      }
      for (const w of raids.wolves) if (w.life === 'active' && w.mode !== 'gone') {
        const p = wolves?.displayPosition(w.id) ?? w.position; units.push({ id: w.id, x: p.x, z: p.z, enemy: true, selected: selected.has(w.id) });
      }
      return { units, plots: economy.state.plots,
        buildings: [...world.objects.values()].filter(o => o.kind === 'building' || o.kind === 'site').map(o => ({ x:o.x,z:o.z,width:o.width,depth:o.depth,radius:o.radius,site:o.kind==='site' })) };
    }, () => {
      return mapDestination?view.map(p=>({x:p.x+mapDestination!.x-camera.target.x,z:p.z+mapDestination!.z-camera.target.z})):view;
    },ui.fullMapOpen);
    const sample = !ui.paused && !resuming ? metrics.record(cpuStart-cpuSinceFrame, performance.now()) : undefined;
    cpuSinceFrame=0;
    const context = { mode: performanceMode, fpsLimit: PERFORMANCE_MODES[performanceMode].fps,
      selected: residents.selectedIds().length, selectionKind: selectedWorld?.kind,
      candidates: sceneCandidates.snapshot().candidates, camera: { x: camera.target.x, y: camera.target.y, z: camera.target.z }, shadows: scene.shadowsEnabled,
      motion: { stepMs: SimulationClock.step * 1000, alpha: simulationClock.alpha, steps: fixedSteps, backlogMs:Math.round(simulationClock.pendingSeconds*1000), ...motion, interpolation: true, animationClock: 'render' } };
    fixedSteps = 0;
    if (ui.paused || resuming) performanceDiagnostics.resetFrameClock();
    else performanceDiagnostics.frame(cpuStart, metrics.lastFrameCpuMs, frameWork, context);
    frameWork.logicMs = frameWork.worldMs = frameWork.saveMs = frameWork.sceneMs = 0;
    if (sample) {
      ui.setPerformance(sample, scene.getActiveIndices() / 3, readJSHeapMB());
      performanceDiagnostics.record(sample, metrics.cadence, currentZoom, ui.paused, residents.lodSummary(), context);
    }
    if (canSave && ui.paused) engine.stopRenderLoop(render);
  }
  let presentedSeconds=economy.state.seconds;
  simulation.subscribe((packet,view)=>{
    const dt=Math.max(0,packet.seconds-presentedSeconds);presentedSeconds=packet.seconds;
    if(dt>0){residents.beginStep();wolves?.beginStep(raids.wolves,packet.paths,packet.resetMotion);fixedSteps++;ui.advanceSpeech(dt);}
    combat.syncUnits();combat.setThreats(raids.wolves);
    residents.applySimulation(Object.values(view.residents),dt);residents.syncCombat(combat.state.units);
    if(dt>0)residents.endStep(packet.paths);else residents.reconcilePresentation();
    if(packet.resetMotion)residents.resetPresentation();
    simulationSeconds=packet.seconds;uiElapsed+=dt;autosave.advance(dt);
    const next=definitions(),key=next.map(r=>r.id).join(',');
    if(key!==definitionKey){definitionKey=key;void residents.syncDefinitions(next).then(()=>{
      residents.applySimulation(Object.values(simulation.view.residents),0);residents.syncCombat(combat.state.units);requestRender();
    }).catch(error=>{console.error(error);ui.toast('单位模型加载失败，请保存并刷新重试');});}
    for(const event of packet.events){
      if(event.type==='damage')showDamage(event.hit);
      else if(event.type==='level')showLevel(event.id,event.level);
      else if(event.type==='speech')ui.sayResident(event.id,event.text);
      else if(event.type==='warehouse')world.doors.useWarehouse(event.point);
      else world.doors.use(event.id);
    }
  });
  const contextRestored = engine.onContextRestoredObservable.add(requestRender);
  const reconcileVisibility = () => {
    const next = platform.state.background;
    if (disposed || next === suspended) return;
    suspended = next;
    void simulation.pause(suspended||ui.paused);
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
  cleanup.push(platform.subscribe('visibility',reconcileVisibility));
  if (suspended) ui.pauseForBackground();
  try {
    await loadingProgress.run('shaders', '材质、纹理与着色器就绪', () =>
      prepareScene(scene, (ready, total) => loadingProgress.work('shaders', ready, total)));
    const failed = loadingProgress.snapshot().find(item => item.state === 'failed' && item.kind === 'download');
    if (failed) throw new Error(`${failed.name}：${failed.error}`);
    loadingProgress.begin('first-frame', '首帧显示');
    renderReady = true; requestRender();
    if (!renderedFrames) await new Promise<void>(resolve => scene.onAfterRenderObservable.addOnce(() => resolve()));
  } catch (error) {
    levelFeedback.dispose();damageNumbers.dispose();damageHost.remove();await simulation.dispose();minimap.dispose(); performanceDiagnostics.dispose(); lifecycle.abort(); input.dispose(); resizeObserver.disconnect(); engine.dispose(); throw error;
  }
  await nextPaint();
  loadingProgress.done('first-frame');
  canSave = true;
  await simulation.pause(ui.paused||suspended);
  freshFrame = true;
  const cameraState = () => ({ alpha: camera.alpha, beta: camera.beta, zoom: currentZoom, overview, previewRole, x: mapCenter.x, z: mapCenter.z,
    target: { x: camera.target.x, y: camera.target.y, z: camera.target.z } });
  return {
    save,
    diagnosticReport: () => roundLog({
      schema: 4, threads:{simulation:'simulation-worker',render:platform.thread,shadows:platform.thread}, simulation:simulation.diagnostics(), actors:residents.resourceCounts(), loading: compactLoadingLog(loadingProgress.snapshot()),
      lighting: { ...lighting },
      graphics: { mode: performanceMode, ...PERFORMANCE_MODES[performanceMode], userShadows },
      selection: { units: residents.selectedIds(), object: selectedWorld?.id, ...selectionFeedback.snapshot() },
      saves: { ...saves, intervalSeconds: autosave.interval }, candidates: sceneCandidates.snapshot(), navigation:{...simulation.diagnostics().navigation,pending:simulation.pending},
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
    // Per-frame checks must not clone the entire simulation or sample every
    // skeleton; keep camera/minimap timing observable without skewing it.
    frameSnapshot:()=>({frames:renderedFrames,camera:cameraState(),minimap:minimap.snapshot(),damage:damageNumbers.snapshot(),levels:levelFeedback.snapshot()}),
    /** Read-only diagnostics are exposed only in development or an explicit E2E build. */
    snapshot: () => ({
      lighting: { ...lighting },
      graphics: {mode:performanceMode,...PERFORMANCE_MODES[performanceMode],width:engine.getRenderWidth(),height:engine.getRenderHeight()},
      camera: cameraState(),
      input: { dragging: input.isDragging },
      moveFeedback: moveFeedback.snapshot(),
      attackFeedback: { ...attackFeedback.snapshot(), target: attackPulse?.target },
      pathGuidance: pathGuidance.snapshot(),
      rallyGuidance: rallyGuidance.snapshot(),
      selectionFeedback: selectionFeedback.snapshot(),
      placement: placement.snapshot(),
      suspended, manualPaused: ui.paused, simulationSeconds,
      combat: structuredClone(combat.state),
      wolves: wolves?.snapshot()??[],
      doors: world.doors.snapshot(), fires: world.fires.snapshot(),
      economy: structuredClone(economy.state), farmerWork: residents.farmerWorkState(),
      selection: { resident: residents.selectedId(), enemy: selectedEnemy, group: selectedGroup, members:residents.selectedIds(), building: selectedWorld?.kind === 'building' ? selectedWorld.id : undefined,
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
      minimap: minimap.snapshot(),
      cells: world.land.length, fps: metrics.sample?.fps??engine.getFps(),
      performance: { ...metrics.sample, lastFrameCpuMs: metrics.lastFrameCpuMs },
      diagnostics: performanceDiagnostics.snapshot(),
      saves: { ...saves }, candidates: sceneCandidates.snapshot(), navigation:{...simulation.diagnostics().navigation,pending:simulation.pending},
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
    async dispose() {
      if(disposed)return;
      if(saveInFlight)await saveInFlight;
      disposed = true; lifecycle.abort(); input.dispose(); resizeObserver.disconnect(); engine.stopRenderLoop(render);
      engine.onContextRestoredObservable.remove(contextRestored);
      levelFeedback.dispose();damageNumbers.dispose();damageHost.remove();await simulation.dispose();management.dispose(); placement.dispose(); selectionFeedback.dispose(); sceneCandidates.dispose(); minimap.dispose(); performanceDiagnostics.dispose(); scene.dispose(); engine.dispose();
    },
  };
}

export type Game = Awaited<ReturnType<typeof createGame>>;
