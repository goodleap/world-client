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
import { objectAtFace } from './world-selection.ts';
import type { WorldObject } from './world-selection.ts';
import { RESIDENTS, roleLeader } from './resident-data.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import { Economy, encodeEconomy, WORK_NAMES } from './economy.ts';
import { ECONOMY_SAVE_KEY } from './economy-storage.ts';
import { economySelection, updateEconomyUI } from './economy-ui.ts';
import { createEconomyController } from './economy-controller.ts';
import type { UnitCommand } from './economy-controller.ts';
import { releaseModelDownloads } from './asset-cache.ts';
import { createMoveFeedback } from './move-feedback.ts';
import { createPerformanceDiagnostics } from './performance-diagnostics.ts';
import { compactPerformanceLog } from '../performance-log.ts';
import { createBuildingPlacement } from './building-placement.ts';
import { readLighting, saveLighting, readShadowsEnabled, saveShadowsEnabled } from './graphics-settings.ts';
export { preloadGameAssets } from './model-assets.ts';

export async function createGame(ui: GameUI, economy = new Economy()) {
  const engine = new Engine(ui.canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  const scene = new Scene(engine);
  installMatteMaterials(scene);
  scene.shadowsEnabled = readShadowsEnabled();
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
  const palette = createPalette(scene);
  let saveWarning = false;
  let canSave = false;
  const save = () => {
    if (!canSave) return false;
    try { economy.state.residents = residents.saveResidents(); localStorage.setItem(ECONOMY_SAVE_KEY, encodeEconomy(economy)); return true; }
    catch { if (!saveWarning) { ui.toast('浏览器未能保存进度，本次仍可继续游玩'); saveWarning = true; } return false; }
  };
  let world: ReturnType<typeof buildWorld>;
  let residents: ReturnType<typeof createResidents>;
  let wolves: Awaited<ReturnType<typeof createWolfView>>;
  try {

    await nextPaint();
    world = await loadingProgress.run('map', '地图与基础材质构建', () => buildWorld(scene, palette, shadows, economy));
    residents = createResidents(scene, palette, shadows, ui, world.obstacles, economy.state.vitals);

    await residents.loadFarmerModel();

    await residents.loadSoldierModels();

    await residents.loadRolePlaceholders();
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
    const name = RESIDENTS.find(r => r.id === worker)?.name ?? '农民';
    const index = economy.state.plots.findIndex(p => p.id === task.target);
    const target = index >= 0 ? `${index + 1}号地` : task.kind === 'haul' ? '这批资源，送到仓库' : task.kind === 'build' ? '建筑' : task.kind === 'chop' ? '这棵树' : '这处石材';
    const work = task.kind === 'sow' && task.crop ? `种${ECONOMY_CONFIG.crops[task.crop].name}` : WORK_NAMES[task.kind];
    ui.sayResident(farmerLeader.id, `${worker === farmerLeader.id ? '我去' : `${name}，去`}${work}${target}。`);
  }, point => world.doors.useWarehouse(point), id => needs.canTakeWork(id) && raids.canWork(id));
  const manual = (id: string) => { needs.manual(id); raids.manual(id); };
  const moveFeedback = createMoveFeedback(scene);
  const selectionFeedback = createSelectionFeedback(scene, shadows);
  let selectedWorld: WorldObject | undefined;
  const clearWorld = () => { selectedWorld = undefined; ui.setSelection(); ui.clearTargetHint(); };
  const combatIds = () => residents.selectedId() ? [residents.selectedId()!] : [];
  const clearResident = () => { residents.select(); ui.setResident(); ui.setCombatHint(false); };
  const clearSelection = () => { clearWorld(); clearResident(); };
  const showObjectActions = (object: WorldObject) => {
    const details = economySelection(economy, object), unit = residents.selectedId();
    const task = economy.taskFor(object.id);
    if (!economy.campfire(object.id) && unit && residents.canWork(unit) && task?.status === 'waiting') details.actions?.unshift({ id: 'assign', label: '优先执行' });
    if (!economy.campfire(object.id) && unit && !residents.canWork(unit) && details.actions?.some(action => action.id !== 'cancel')) {
      details.hint = '此作业需要农民';
      details.actions = details.actions.map(action => ({ ...action, disabled: action.id !== 'cancel' }));
    }
    ui.setSelection(details);
  };
  const selectWorld = (object: WorldObject) => {
    clearWorld(); selectedWorld = object;
    showObjectActions(object);
  };
  const refreshEconomy = () => {
    updateEconomyUI(ui, economy);
    ui.setHomeStatus(livingPopulation(economy.state), formatGameTime(economy.state.seconds));
    for (const id of Object.keys(economy.state.vitals)) {
      ui.setUnitHealth(id, health(economy.state, id), maxHealth(id), economy.state.seconds, id === 'horse' ? 'cavalry' : id);
    }
    for (const wolf of raids.state.wolves) ui.setUnitHealth(wolf.id, wolf.hp, fighterStats(wolf).hp, economy.state.seconds);
    ui.setRaidNotice(raids.state.noticeUntil > economy.state.seconds ? raids.state.notice + (raids.state.phase === 'raid' ? ' · 查看' : '') : '');
    if (selectedWorld) {
      const object = world.objects.get(selectedWorld.id);
      if (object) { selectedWorld = object; showObjectActions(object); }
      else clearWorld();
    }
  };
  const performAction = (action: string) => {
    if (!selectedWorld || ui.paused || suspended) return;
    const target = selectedWorld.id;
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
      else if (action === 'till' || action === 'harvest' || action === 'chop' || action === 'mine' || action === 'build' || action === 'haul' || action === 'gather' || action === 'tools' || action === 'arms') instruction = { kind: 'work', work: action, target };
      if (instruction) {
        const id = residents.selectedId();
        const result = id ? controller.command(id, instruction) : economy.request(instruction.work, target, instruction.crop);
        if (result.ok && id) { manual(id); setPreview(); clearResident(); }
        ui.targetHint(result.message, selectedWorld.anchor);
      }
    }
    world.sync(); refreshEconomy(); save();
  };
  ui.bindEconomy(performAction, id => {
    if (ui.paused || suspended) return;
    if (economy.cancel(id)) { world.sync(); refreshEconomy(); save(); }
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
    clearSelection, id => { world.sync(); refreshEconomy(); const object = world.objects.get(id); if (object) selectWorld(object); save(); });
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
    const hit = scene.pick(x, y, mesh => mesh.isVisible && (mesh.metadata?.selectionKind === 'resident' || !!mesh.metadata?.worldObjectId || !!mesh.metadata?.worldFaceRanges?.length));
    if (hit?.pickedMesh?.metadata?.selectionKind === 'resident') {
      const id = hit.pickedMesh.metadata.id;
      const fighter = combat.unit(id);
      if (fighter?.team === 'enemy') {
        const count = combat.attack(combatIds(), id);
        ui.targetHint(count ? '攻击' : '先选择一名士兵', { ...fighter.position, y: fighter.role === 'wolf' ? 1.9 : 2.6 });
        if (count) { manual(residents.selectedId()!); clearWorld(); setPreview(); save(); }
        return;
      }
      clearWorld();
      const name = residents.select(residents.selectedId() === id ? undefined : id);
      ui.setResident(name, !!residents.selectedId() && residents.canWork(residents.selectedId()!),
        residents.selectedId() === farmerLeader?.id ? economy.state.steward.enabled : undefined);
      ui.setCombatHint(!!combat.unit(residents.selectedId() ?? ''));
      return;
    }
    if (hit?.pickedMesh?.metadata?.worldFaceRanges || hit?.pickedMesh?.metadata?.worldObjectId) {
      const id = hit.pickedMesh.metadata.worldObjectId ?? objectAtFace(hit.pickedMesh.metadata.worldFaceRanges, hit.faceId);
      const object = id && world.objects.get(id);
      if (object) {
        selectWorld(object);
        if (residents.selectedId() && !economy.campfire(object.id)) {
          const task = economy.taskFor(object.id), actions = economySelection(economy, object).actions ?? [];
          const action = task && task.status !== 'storage' ? 'assign' : actions.length === 1 && actions[0].id !== 'cancel' ? actions[0].id : undefined;
          if (action) performAction(action);
          else if (actions.length && !residents.canWork(residents.selectedId()!)) ui.targetHint('此作业需要农民', object.anchor);
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
      const isCombat = combatIds().some(id => !!combat.unit(id));
      const result = isCombat ? { ok: combat.move(combatIds(), point) > 0, message: '无法到达该位置' }
        : controller.command(residents.selectedId()!, { kind: 'move', point: { x: point.x, z: point.z } });
      if (result.ok) { manual(residents.selectedId()!); clearWorld(); setPreview(); moveFeedback.show(point); refreshEconomy(); save(); }
      // The destination marker already confirms success. Only failures need
      // text, anchored to the attempted destination rather than the HUD.
      if (!result.ok) ui.targetHint(result.message, { x: point.x, y: .2, z: point.z });
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
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    engine.resize(); applyProjection();
    requestRender();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(ui.canvas);
  resize();
  ui.bind('clear-selection', clearSelection);
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && !ui.paused && !suspended) { placement.cancel(); clearSelection(); }
  }, { signal: lifecycle.signal });
  ui.bindPause(() => {
    if (disposed) return;
    if (ui.paused) placement.cancel();
    input.reset(); freshFrame = true;
    scene.resetLastAnimationTimeFrame();
    metrics.reset(); ui.setPerformance(); engine.performanceMonitor.reset();
    refreshEconomy(); requestRender();
  });
  ui.bindShadows(scene.shadowsEnabled, enabled => {
    scene.shadowsEnabled = enabled;
    refreshFrozenMaterials(scene);
    if (!saveShadowsEnabled(enabled)) ui.settingsNotice('阴影设置已生效，浏览器未能保存此偏好');
    freshFrame = true; requestRender();
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
    if (ui.paused || suspended || raids.state.phase !== 'raid') return;
    const wolf = raids.state.wolves.find(w => w.life === 'active' && w.mode !== 'gone');
    if (wolf) { setPreview(); overview = false; mapCenter.set(wolf.position.x, .5, wolf.position.z); clampCenter(); }
  });
  ui.bind('reset', () => {
    mapCenter.copyFrom(homeCenter); setPreview();
    overview = false; zoom = defaultZoom();
  });
  let uiElapsed = 0, saveElapsed = 0, savedRevision = economy.revision;
  let keyboardPanning = false;
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
    const cameraDt = ui.paused ? 0 : Math.min(elapsed, 0.25);
    const dt = Math.min(elapsed, 0.25);
    // Navigation clamps long frames. Keep the skeletal gait on the same clock
    // so a slow device does not run the feet faster than the character moves.
    // Babylon's animation clock also uses wall time between scene renders.
    // A zero-scale first frame refreshes that clock without advancing a clip.
    scene.animationTimeScale = resuming || ui.paused ? 0 : elapsed > 0 ? dt / elapsed : 1;
    // A zero delta alone still advances Babylon's transition blending once per
    // rendered frame. Disable animation evaluation as well, using the public
    // clock reset so resuming does not include the time spent away.
    scene.animationsEnabled = !resuming && !ui.paused;
    if (!scene.animationsEnabled) scene.resetLastAnimationTimeFrame();
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
    if (!resuming) {
      if (!ui.paused) {
        ui.advanceSpeech(dt);
        controller.update(dt);
        world.doors.update(dt);
        raids.update(dt);
        combat.update(dt); residents.syncCombat(combat.state.units); combatView.update(combat.state);
        residents.update(dt, previewRole, dt);
        needs.update(dt);
        world.fires.update(economy.state.campfires, dt, mapCenter);
        simulationSeconds += dt;
        uiElapsed += dt; saveElapsed += dt;
        if (uiElapsed >= .25) { refreshEconomy(); uiElapsed = 0; }
        if (savedRevision !== economy.revision || saveElapsed >= 5) {
          save(); savedRevision = economy.revision; saveElapsed = 0;
        }
      }
    }
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const desiredZoom = previewRole === 'leader' ? Math.max(1.55, 0.81 / aspect) * previewZoom : previewRole === 'farmer' ? 2.2 * previewZoom : overview ? Math.max(MAP_SIZE * .5, MAP_SIZE * .52 / aspect) : zoom;
    currentZoom = desiredZoom;
    camera.beta += ((previewRole === 'leader' ? 1.28 : previewRole === 'farmer' ? 1.14 : 0.76) - camera.beta) * (1 - Math.exp(-cameraDt * 7));
    applyProjection();
    if (previewRole) {
      const position = previewRole === 'leader' ? residents.leaderPosition() : residents.farmerPosition();
      target.set(position.x, 0.9, position.z);
    } else if (overview) target.set(0, 0, 0);
    else target.copyFrom(mapCenter);
    Vector3.LerpToRef(camera.target, target, 1 - Math.exp(-cameraDt * 5), camera.target);
    residents.updateAnimationVisibility(camera, ui.paused || resuming ? 0 : dt, !!previewRole);
    // Native instrumentation owns frame counters; track shadow-map replacement.
    performanceDiagnostics.beforeFrame();
    placement.update();
    const selectionKey = `${residents.selectedId() ?? ''}:${selectedWorld?.id ?? ''}:${meshRevision}`;
    if (selectionRevision !== selectionKey) {
      selectionFeedback.update([...residents.selectionMeshes(), ...(selectedWorld ? world.selectionMeshes(selectedWorld.id) : [])], selectedWorld);
      selectionRevision = selectionKey;
    }
    wolves.update(raids.state.wolves, economy.state.seconds, camera);
    scene.render(); residents.updateLabels(camera); wolves.updateLabels(camera);
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
    const sample = metrics.record(cpuStart, performance.now());
    if (sample) {
      ui.setPerformance(sample, scene.getActiveIndices() / 3);
      performanceDiagnostics.record(sample, metrics.cadence, currentZoom, ui.paused, residents.lodSummary());
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
    diagnosticReport: () => ({
      loading: loadingProgress.snapshot(),
      lighting: { ...lighting },
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
      camera: cameraState(),
      input: { dragging: input.isDragging },
      moveFeedback: moveFeedback.snapshot(),
      selectionFeedback: selectionFeedback.snapshot(),
      placement: placement.snapshot(),
      suspended, manualPaused: ui.paused, simulationSeconds,
      combat: structuredClone(combat.state),
      wolves: wolves.snapshot(),
      doors: world.doors.snapshot(), fires: world.fires.snapshot(),
      economy: structuredClone(economy.state), farmerWork: residents.farmerWorkState(),
      selection: { resident: residents.selectedId(), building: selectedWorld?.kind === 'building' ? selectedWorld.id : undefined,
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
      cells: world.land.length, fps: engine.getFps(),
      performance: { ...metrics.sample, lastFrameCpuMs: metrics.lastFrameCpuMs },
      diagnostics: performanceDiagnostics.snapshot(),
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
      placement.dispose(); selectionFeedback.dispose(); performanceDiagnostics.dispose(); scene.dispose(); engine.dispose();
    },
  };
}

export type Game = Awaited<ReturnType<typeof createGame>>;
