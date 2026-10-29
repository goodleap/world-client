import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createPalette } from './models.ts';
import { createDaylight } from './lighting.ts';
import { buildWorld } from './world.ts';
import { createResidents } from './residents.ts';
import { MovementInput } from './input.ts';
import { BUILDINGS, WORLD_BOUNDS } from './world-data.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Culling/ray';
import type { GameUI } from '../ui.ts';

export async function createGame(ui: GameUI) {
  const engine = new Engine(ui.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#c4dd9fff');
  scene.ambientColor = Color3.Black();
  scene.skipPointerMovePicking = true;
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, 0.76, 36, new Vector3(0, 0.6, -2), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1; camera.maxZ = 120;
  const shadows = createDaylight(scene);
  const palette = createPalette(scene);
  const world = buildWorld(scene, palette, shadows);
  const residents = createResidents(scene, palette, shadows, ui);
  await residents.loadFarmerModel();
  await residents.loadBaseModel();
  await residents.loadRolePlaceholders();
  const buildingMarkers = new Map<string, ReturnType<typeof MeshBuilder.CreateLines>>();
  for (const building of BUILDINGS) {
    const hit = MeshBuilder.CreateBox(`select-${building.id}`, { width: building.width, depth: building.depth, height: building.height + 1.2 }, scene);
    hit.position.set(building.x, (building.height + 1.2) / 2, building.z); hit.visibility = 0;
    hit.metadata = { selectionKind: 'building', id: building.id };
    const x = building.width / 2 + 0.18, z = building.depth / 2 + 0.18;
    const marker = MeshBuilder.CreateLines(`mark-${building.id}`, { points: [new Vector3(-x, 0.14, -z), new Vector3(x, 0.14, -z), new Vector3(x, 0.14, z), new Vector3(-x, 0.14, z), new Vector3(-x, 0.14, -z)] }, scene);
    marker.position.set(building.x, 0, building.z); marker.color = Color3.FromHexString('#ffe7a1'); marker.isPickable = false; marker.setEnabled(false);
    buildingMarkers.set(building.id, marker);
  }
  let zoom = 10.7;
  let overview = false;
  let previewRole: 'farmer' | 'base' | undefined;
  let previewZoom = 1;
  const setPreview = (role?: 'farmer' | 'base') => {
    previewRole = role;
    previewZoom = 1;
    if (role) { overview = false; ui.setOverview(false); }
    ui.setFarmerPreview(role === 'farmer');
    ui.setBasePreview(role === 'base');
  };
  let currentZoom = zoom;
  let renderedFrames = 0;
  let disposed = false;
  const target = new Vector3();
  const mapCenter = new Vector3(0, 0.5, -2);
  let selectedBuilding: string | undefined;
  const zoomBy = (delta: number) => {
    if (previewRole) previewZoom = Math.max(0.8, Math.min(1.8, previewZoom + delta * 0.15));
    else zoom = Math.max(6, Math.min(18, zoom + delta));
  };
  const clampCenter = () => { mapCenter.x = Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, mapCenter.x)); mapCenter.z = Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, mapCenter.z)); };
  const input = new MovementInput(ui.canvas, zoomBy, (dx, dy) => {
    if (ui.paused) return;
    setPreview(); overview = false; ui.setOverview(false);
    const units = 2 * currentZoom / Math.max(1, ui.canvas.clientHeight);
    mapCenter.x -= dx * units; mapCenter.z += dy * units / Math.max(0.2, Math.cos(camera.beta)); clampCenter();
  }, (clientX, clientY) => {
    if (ui.paused) return;
    const rect = ui.canvas.getBoundingClientRect(); const x = clientX - rect.left, y = clientY - rect.top;
    const hit = scene.pick(x, y, (mesh) => !!mesh.metadata?.selectionKind);
    if (hit?.pickedMesh?.metadata?.selectionKind === 'resident') {
      if (selectedBuilding) buildingMarkers.get(selectedBuilding)?.setEnabled(false);
      const name = residents.select(hit.pickedMesh.metadata.id); selectedBuilding = undefined;
      if (name) ui.toast(`已选中${name}，点击空地移动`);
      return;
    }
    if (hit?.pickedMesh?.metadata?.selectionKind === 'building') {
      if (selectedBuilding) buildingMarkers.get(selectedBuilding)?.setEnabled(false);
      residents.select(); selectedBuilding = hit.pickedMesh.metadata.id;
      if (selectedBuilding) buildingMarkers.get(selectedBuilding)?.setEnabled(true);
      ui.toast('已选中建筑'); return;
    }
    const ray = scene.createPickingRay(x, y, null, camera);
    const distance = -ray.origin.y / ray.direction.y;
    if (distance <= 0 || !Number.isFinite(distance)) return;
    const point = ray.origin.add(ray.direction.scale(distance));
    if (residents.selectedId()) {
      const moving = residents.command({ x: point.x, z: point.z });
      if (moving) setPreview();
      ui.toast(moving ? '前往目标位置' : '无法到达该位置');
    }
    else { if (selectedBuilding) buildingMarkers.get(selectedBuilding)?.setEnabled(false); selectedBuilding = undefined; residents.select(); }
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
  engine.runRenderLoop(() => {
    const elapsed = engine.getDeltaTime() / 1000;
    const cameraDt = Math.min(elapsed, 0.25);
    const dt = Math.min(elapsed, 0.05);
    // Navigation clamps long frames. Keep the skeletal gait on the same clock
    // so a slow device does not run the feet faster than the character moves.
    scene.animationTimeScale = elapsed > 0 ? dt / elapsed : 1;
    const direction = ui.paused ? { x: 0, z: 0 } : input.read();
    if (direction.x || direction.z) {
      setPreview(); overview = false; ui.setOverview(false);
      mapCenter.x += direction.x * dt * 7; mapCenter.z += direction.z * dt * 7; clampCenter();
    }
    residents.update(ui.paused ? 0 : dt, previewRole);
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
    scene.render(); residents.updateLabels(camera); renderedFrames++;
  });
  try {
    await scene.whenReadyAsync();
    if (!disposed) ui.ready();
  } catch (error) {
    input.dispose(); resizeObserver.disconnect(); engine.dispose(); throw error;
  }
  return {
    /** Read-only diagnostics are exposed only in development or an explicit E2E build. */
    snapshot: () => ({
      camera: { alpha: camera.alpha, beta: camera.beta, zoom: currentZoom, overview, previewRole, x: mapCenter.x, z: mapCenter.z },
      selection: { resident: residents.selectedId(), building: selectedBuilding },
      landmarks: ui.discoveredCount, frames: renderedFrames,
      meshes: scene.meshes.length,
      farmerModelLoaded: residents.farmerModelLoaded(),
      baseModelLoaded: residents.baseModelLoaded(),
      baseWalking: residents.baseWalking(),
      baseRunning: residents.baseRunning(),
      baseModel: residents.baseModelInfo(),
      farmerWalking: residents.farmerWalking(),
      farmerLegPose: residents.farmerLegPose(),
      residents: residents.snapshot(),
      cells: world.land.length, fps: engine.getFps(),
      size: { width: engine.getRenderWidth(), height: engine.getRenderHeight() },
    }),
    dispose() {
      disposed = true; input.dispose(); resizeObserver.disconnect(); engine.stopRenderLoop();
      scene.dispose(); engine.dispose();
    },
  };
}

export type Game = Awaited<ReturnType<typeof createGame>>;
