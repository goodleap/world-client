import { loadingProgress } from '../loading-progress.ts';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createPalette } from './models.ts';
import { createDaylight, createMapShadowLOD } from './lighting.ts';
import { buildWorld } from './world.ts';
import { createResidents } from './residents.ts';
import { MovementInput } from './input.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Culling/ray';
import type { GameUI } from '../ui.ts';
import { nextPaint } from '../launcher.ts';
import type { ReportProgress } from '../launcher.ts';
import { FrameMetrics } from './frame-metrics.ts';
import { objectAtFace } from './world-selection.ts';
import type { WorldObject } from './world-selection.ts';
import { Economy, encodeEconomy } from './economy.ts';
import { ECONOMY_SAVE_KEY } from './economy-storage.ts';
import { economySelection, updateEconomyUI } from './economy-ui.ts';
import { createEconomyController } from './economy-controller.ts';
import type { UnitCommand } from './economy-controller.ts';
import { releaseModelDownloads } from './asset-cache.ts';
import { createMoveFeedback } from './move-feedback.ts';
import { createPerformanceDiagnostics } from './performance-diagnostics.ts';
export { preloadGameAssets } from './model-assets.ts';

export async function createGame(ui: GameUI, report: ReportProgress = () => {}, economy = new Economy()) {
  const engine = new Engine(ui.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#c4dd9fff');
  scene.ambientColor = Color3.Black();
  scene.skipPointerMovePicking = true;
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, 0.76, 36, new Vector3(0, 0.6, -2), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1; camera.maxZ = 120;
  const mobile = window.matchMedia('(pointer: coarse)').matches;
  const shadows = createDaylight(scene, mobile);
  const configureShadowLOD = mobile ? createMapShadowLOD(scene, shadows, camera) : undefined;
  configureShadowLOD?.();
  const palette = createPalette(scene);
  let saveWarning = false;
  let canSave = false;
  const save = () => {
    if (!canSave) return false;
    try { localStorage.setItem(ECONOMY_SAVE_KEY, encodeEconomy(economy)); return true; }
    catch { if (!saveWarning) { ui.toast('浏览器未能保存进度，本次仍可继续游玩'); saveWarning = true; } return false; }
  };
  let world: ReturnType<typeof buildWorld>;
  let residents: ReturnType<typeof createResidents>;
  try {
    report(10, '正在铺好小路、布置房屋与树木…');
    await nextPaint();
    world = await loadingProgress.run('map', '地图与基础材质构建', () => buildWorld(scene, palette, shadows, economy));
    residents = createResidents(scene, palette, shadows, ui, world.obstacles);
    report(20, '正在迎接农民…');
    await residents.loadFarmerModel(fraction => report(20 + 15 * fraction, '正在迎接农民…'));
    report(35, '正在准备家园居民…');
    await residents.loadBaseModel(fraction => report(35 + 12 * fraction, '正在准备家园居民…'));
    report(47, '正在迎接步兵、骑兵与弓兵…');
    await residents.loadSoldierModels(fraction => report(47 + 33 * fraction, '正在迎接步兵、骑兵与弓兵…'));
    report(80, '正在准备其他居民…');
    await residents.loadRolePlaceholders(fraction => report(80 + 8 * fraction, '正在准备其他居民…'));
    releaseModelDownloads();
    report(90, '正在准备光影与地图画面…');
    await nextPaint();
  } catch (error) {
    scene.dispose(); engine.dispose(); throw error;
  }
  const controller = createEconomyController(economy, world, residents);
  const moveFeedback = createMoveFeedback(scene);
  const roundMarker = MeshBuilder.CreateLines('selected-object-ring', { points: Array.from({ length: 65 }, (_, i) =>
    new Vector3(Math.cos(i * Math.PI / 32), 0, Math.sin(i * Math.PI / 32))) }, scene);
  const boxMarker = MeshBuilder.CreateLines('selected-object-outline', { points: [
    new Vector3(-.5, 0, -.5), new Vector3(.5, 0, -.5), new Vector3(.5, 0, .5), new Vector3(-.5, 0, .5), new Vector3(-.5, 0, -.5),
  ] }, scene);
  for (const marker of [roundMarker, boxMarker]) {
    marker.color = Color3.FromHexString('#fff0a6'); marker.isPickable = false; marker.setEnabled(false);
  }
  let selectedWorld: WorldObject | undefined;
  const clearWorld = () => { roundMarker.setEnabled(false); boxMarker.setEnabled(false); selectedWorld = undefined; ui.setSelection(); };
  const clearResident = () => { residents.select(); ui.setResident(); };
  const clearSelection = () => { clearWorld(); clearResident(); };
  const showObjectActions = (object: WorldObject) => {
    const details = economySelection(economy, object), unit = residents.selectedId();
    const task = economy.taskFor(object.id);
    if (unit && residents.canWork(unit) && task?.status === 'waiting') details.actions?.unshift({ id: 'assign', label: '优先执行' });
    if (unit && !residents.canWork(unit) && details.actions?.some(action => action.id !== 'cancel')) {
      details.hint = '此作业需要农民';
      details.actions = details.actions.map(action => ({ ...action, disabled: action.id !== 'cancel' }));
    }
    ui.setSelection(details);
  };
  const selectWorld = (object: WorldObject) => {
    clearWorld(); selectedWorld = object;
    const marker = object.width && object.depth ? boxMarker : roundMarker;
    marker.scaling.set(object.width ?? object.radius, 1, object.depth ?? object.radius);
    marker.position.set(object.x, object.markerY ?? .035, object.z); marker.setEnabled(true);
    showObjectActions(object);
  };
  const refreshEconomy = () => {
    updateEconomyUI(ui, economy);
    if (selectedWorld) {
      const object = world.objects.get(selectedWorld.id);
      if (object) { selectedWorld = object; showObjectActions(object); }
      else clearWorld();
    }
  };
  const performAction = (action: string) => {
    if (!selectedWorld || ui.paused || suspended) return;
    const target = selectedWorld.id;
    if (action === 'cancel') {
      const task = economy.taskFor(target); if (task) economy.cancel(task.id);
    } else {
      let instruction: Extract<UnitCommand, { kind: 'work' }> | undefined;
      if (action === 'assign') {
        const task = economy.taskFor(target);
        if (task) instruction = { kind: 'work', work: task.kind, target, crop: task.crop };
      } else if (action === 'sow-carrot' || action === 'sow-wheat') instruction = { kind: 'work', work: 'sow', target, crop: action === 'sow-carrot' ? 'carrot' : 'wheat' };
      else if (action === 'till' || action === 'harvest' || action === 'chop' || action === 'mine' || action === 'build') instruction = { kind: 'work', work: action, target };
      if (instruction) {
        const id = residents.selectedId();
        const result = id ? controller.command(id, instruction) : economy.request(instruction.work, target, instruction.crop);
        if (result.ok && id) { setPreview(); clearResident(); }
        ui.toast(result.message);
      }
    }
    world.sync(); refreshEconomy(); save();
  };
  ui.bindEconomy(performAction, id => {
    if (ui.paused || suspended) return;
    if (economy.cancel(id)) { ui.toast('已取消作业'); world.sync(); refreshEconomy(); save(); }
  });
  refreshEconomy();
  const projectionIdentity = Matrix.Identity();
  let zoom = 10.7;
  let overview = false;
  let previewRole: 'farmer' | 'base' | undefined;
  let previewZoom = 1;
  const setPreview = (role?: 'farmer' | 'base') => {
    previewRole = role;
    previewZoom = 1;
    // Keep close-up self-shadows at full detail; the ordinary touch map uses
    // the smaller target. Babylon retains the caster list when resizing.
    const shadowSize = role || !mobile ? 2048 : 1024;
    if (shadows.mapSize !== shadowSize) shadows.mapSize = shadowSize;
    configureShadowLOD?.(!!role);
    if (role) { overview = false; ui.setOverview(false); }
    ui.setFarmerPreview(role === 'farmer');
    ui.setBasePreview(role === 'base');
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
  const mapCenter = new Vector3(0, 0.5, -2);
  const zoomBy = (delta: number) => {
    if (suspended || ui.paused) return;
    if (previewRole) previewZoom = Math.max(0.8, Math.min(1.8, previewZoom + delta * 0.15));
    else zoom = Math.max(6, Math.min(18, zoom + delta));
  };
  const clampCenter = () => { mapCenter.x = Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, mapCenter.x)); mapCenter.z = Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, mapCenter.z)); };
  const input = new MovementInput(ui.canvas, zoomBy, (dx, dy, started) => {
    if (ui.paused || suspended) return;
    // Take over from the currently visible center, including an unfinished
    // preview/reset transition. Pointer motion is direct manipulation.
    if (started) mapCenter.copyFrom(camera.target);
    setPreview(); overview = false; ui.setOverview(false);
    const units = 2 * currentZoom / Math.max(1, ui.canvas.clientHeight);
    mapCenter.x -= dx * units; mapCenter.z += dy * units / Math.max(0.2, Math.cos(camera.beta)); clampCenter();
    camera.target.copyFrom(mapCenter);
  }, (clientX, clientY) => {
    if (ui.paused || suspended) return;
    const rect = ui.canvas.getBoundingClientRect(); const x = clientX - rect.left, y = clientY - rect.top;
    const hit = scene.pick(x, y, mesh => mesh.isVisible && (mesh.metadata?.selectionKind === 'resident' || !!mesh.metadata?.worldObjectId || !!mesh.metadata?.worldFaceRanges?.length));
    if (hit?.pickedMesh?.metadata?.selectionKind === 'resident') {
      clearWorld();
      const id = hit.pickedMesh.metadata.id;
      const name = residents.select(residents.selectedId() === id ? undefined : id);
      ui.setResident(name, !!residents.selectedId() && residents.canWork(residents.selectedId()!));
      return;
    }
    if (hit?.pickedMesh?.metadata?.worldFaceRanges || hit?.pickedMesh?.metadata?.worldObjectId) {
      const id = hit.pickedMesh.metadata.worldObjectId ?? objectAtFace(hit.pickedMesh.metadata.worldFaceRanges, hit.faceId);
      const object = id && world.objects.get(id);
      if (object) {
        selectWorld(object);
        if (residents.selectedId()) {
          const task = economy.taskFor(object.id), actions = economySelection(economy, object).actions ?? [];
          const action = task && task.status !== 'storage' ? 'assign' : actions.length === 1 && actions[0].id !== 'cancel' ? actions[0].id : undefined;
          if (action) performAction(action);
          else if (actions.length && !residents.canWork(residents.selectedId()!)) ui.toast('此作业需要农民');
        }
        const details = economySelection(economy, object);
        if (!details.actions?.length) ui.toast(details.hint === '暂无可用操作' ? object.name : details.hint);
        return;
      }
    }
    const ray = scene.createPickingRay(x, y, null, camera);
    const distance = -ray.origin.y / ray.direction.y;
    if (distance <= 0 || !Number.isFinite(distance)) return;
    const point = ray.origin.add(ray.direction.scale(distance));
    if (residents.selectedCanMove()) {
      const result = controller.command(residents.selectedId()!, { kind: 'move', point: { x: point.x, z: point.z } });
      if (result.ok) { clearSelection(); setPreview(); moveFeedback.show(point); refreshEconomy(); save(); }
      ui.toast(result.message);
    }
    else clearSelection();
  });
  const applyProjection = () => {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    camera.orthoTop = currentZoom; camera.orthoBottom = -currentZoom;
    camera.orthoLeft = -currentZoom * aspect; camera.orthoRight = currentZoom * aspect;
  };
  const resize = () => {
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    engine.resize(); applyProjection();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(ui.canvas);
  resize();
  ui.bind('clear-selection', clearSelection);
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && !ui.paused && !suspended) clearWorld();
  }, { signal: lifecycle.signal });
  ui.bindPause(() => {
    input.reset(); freshFrame = true;
    scene.resetLastAnimationTimeFrame();
    if (!disposed) refreshEconomy();
  });
  ui.bind('zoom-in', () => zoomBy(-1.2));
  ui.bind('zoom-out', () => zoomBy(1.2));
  ui.bind('overview', () => { setPreview(); overview = !overview; ui.setOverview(overview); });
  ui.bind('farmer-preview', () => {
    setPreview(previewRole === 'farmer' ? undefined : 'farmer');
  });
  ui.bind('base-preview', () => {
    setPreview(previewRole === 'base' ? undefined : 'base');
  });
  ui.bind('reset', () => {
    mapCenter.set(0, 0.5, -2); setPreview();
    overview = false; zoom = 10.7; ui.setOverview(false); ui.toast('回到初始视角');
  });
  let uiElapsed = 0, saveElapsed = 0, savedRevision = economy.revision;
  let keyboardPanning = false;
  const render = () => {
    if (disposed || suspended) return;
    const cpuStart = performance.now();
    const resuming = freshFrame;
    freshFrame = false;
    const elapsed = resuming ? 0 : engine.getDeltaTime() / 1000;
    const cameraDt = ui.paused ? 0 : Math.min(elapsed, 0.25);
    const dt = Math.min(elapsed, 0.05);
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
      setPreview(); overview = false; ui.setOverview(false);
      mapCenter.x += direction.x * dt * 7; mapCenter.z += direction.z * dt * 7; clampCenter();
      camera.target.copyFrom(mapCenter);
    }
    keyboardPanning = !!(direction.x || direction.z);
    // Do not send update(0) on resume: that would reset an interrupted Run to
    // idle for one frame. Keep the exact frozen pose until normal time resumes.
    if (!resuming) {
      if (!ui.paused) {
        controller.update(elapsed);
        residents.update(dt, previewRole, elapsed);
        simulationSeconds += elapsed;
        uiElapsed += elapsed; saveElapsed += elapsed;
        if (uiElapsed >= .25) { refreshEconomy(); uiElapsed = 0; }
        if (savedRevision !== economy.revision || saveElapsed >= 5) {
          save(); savedRevision = economy.revision; saveElapsed = 0;
        }
      }
    }
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const desiredZoom = previewRole === 'base' ? Math.max(1.55, 0.81 / aspect) * previewZoom : previewRole === 'farmer' ? 2.2 * previewZoom : overview ? Math.max(16.5, 14.6 / aspect) * zoom / 10.7 : zoom;
    currentZoom += (desiredZoom - currentZoom) * (1 - Math.exp(-cameraDt * 7));
    camera.beta += ((previewRole === 'base' ? 1.28 : previewRole === 'farmer' ? 1.14 : 0.76) - camera.beta) * (1 - Math.exp(-cameraDt * 7));
    applyProjection();
    if (previewRole) {
      const position = previewRole === 'base' ? residents.basePosition() : residents.farmerPosition();
      target.set(position.x, 0.9, position.z);
    } else if (overview) target.set(0, 0, 0);
    else target.copyFrom(mapCenter);
    Vector3.LerpToRef(camera.target, target, 1 - Math.exp(-cameraDt * 5), camera.target);
    // Native instrumentation owns frame counters; track shadow-map replacement.
    performanceDiagnostics.beforeFrame();
    scene.render(); residents.updateLabels(camera);
    if (selectedWorld) {
      const { anchor } = selectedWorld;
      const projected = Vector3.Project(new Vector3(anchor.x, anchor.y, anchor.z), projectionIdentity,
        scene.getTransformMatrix(), camera.viewport.toGlobal(ui.canvas.clientWidth, ui.canvas.clientHeight));
      ui.positionSelection(projected.x, projected.y, projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= ui.canvas.clientWidth && projected.y >= 0 && projected.y <= ui.canvas.clientHeight);
    }
    renderedFrames++;
    const sample = metrics.record(cpuStart, performance.now());
    if (sample) {
      ui.setPerformance(sample);
      performanceDiagnostics.record(sample, metrics.cadence, currentZoom, ui.paused, residents.lodSummary());
    }
  };
  const reconcileVisibility = () => {
    const next = document.hidden || pageHidden || focusLost;
    if (disposed || next === suspended) return;
    suspended = next;
    input.reset();
    if (suspended) {
      engine.stopRenderLoop(render);
      save();
      if (!previewRole && !overview) mapCenter.copyFrom(camera.target);
    } else {
      freshFrame = true;
      metrics.reset(); ui.setPerformance();
      engine.performanceMonitor.reset();
      engine.runRenderLoop(render);
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
  if (!suspended) engine.runRenderLoop(render);
  try {
    await loadingProgress.run('shaders', '材质、纹理与着色器就绪', () => scene.whenReadyAsync());
    const failed = loadingProgress.snapshot().find(item => item.state === 'failed' && item.kind === 'download');
    if (failed) throw new Error(`${failed.name}：${failed.error}`);
    loadingProgress.begin('first-frame', '首帧显示');
    report(98, '正在打开家园…');
    if (!renderedFrames) await new Promise<void>(resolve => scene.onAfterRenderObservable.addOnce(() => resolve()));
  } catch (error) {
    performanceDiagnostics.dispose(); lifecycle.abort(); input.dispose(); resizeObserver.disconnect(); engine.dispose(); throw error;
  }
  await nextPaint();
  loadingProgress.done('first-frame');
  canSave = true;
  return {
    save,
    performanceReport: performanceDiagnostics.snapshot,
    markPerformance: performanceDiagnostics.mark,
    /** Read-only diagnostics are exposed only in development or an explicit E2E build. */
    snapshot: () => ({
      camera: { alpha: camera.alpha, beta: camera.beta, zoom: currentZoom, overview, previewRole, x: mapCenter.x, z: mapCenter.z,
        target: { x: camera.target.x, y: camera.target.y, z: camera.target.z } },
      input: { dragging: input.isDragging },
      moveFeedback: moveFeedback.snapshot(),
      suspended, manualPaused: ui.paused, simulationSeconds,
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
      baseModelLoaded: residents.baseModelLoaded(),
      baseWalking: residents.baseWalking(),
      baseRunning: residents.baseRunning(),
      baseModel: residents.baseModelInfo(),
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
      performanceDiagnostics.dispose(); scene.dispose(); engine.dispose();
    },
  };
}

export type Game = Awaited<ReturnType<typeof createGame>>;
