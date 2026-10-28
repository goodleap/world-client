import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createPalette } from './models.ts';
import { buildWorld } from './world.ts';
import { createCharacter } from './character.ts';
import { MovementInput } from './input.ts';
import { moveCharacter } from './movement.ts';
import { LANDMARKS, OBSTACLES, PLAYER_RADIUS, SPAWN, WALK_SPEED, WORLD_BOUNDS } from './world-data.ts';
import type { GameUI } from '../ui.ts';

export async function createGame(ui: GameUI) {
  const engine = new Engine(ui.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#dce8dfff');
  scene.ambientColor = Color3.Black();
  scene.skipPointerMovePicking = true;
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, 0.76, 36, new Vector3(0, 0.6, -2), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1; camera.maxZ = 120;
  const hemisphere = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  hemisphere.intensity = 0.72;
  hemisphere.diffuse = Color3.FromHexString('#fff4df');
  hemisphere.groundColor = Color3.FromHexString('#8a9b7c');
  const sun = new DirectionalLight('sun', new Vector3(-0.65, -1.6, 0.8), scene);
  sun.position.set(12, 24, -12); sun.intensity = 0.37;
  sun.diffuse = Color3.FromHexString('#fff0d2');
  sun.autoCalcShadowZBounds = true;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.003; shadows.normalBias = 0.04;
  shadows.setDarkness(0.28);
  const palette = createPalette(scene);
  const world = buildWorld(scene, palette, shadows);
  const player = createCharacter(scene, palette, shadows);
  player.root.position.set(SPAWN.x, 0, SPAWN.z);
  player.update(0, 0, 0);
  let zoom = 10.7;
  let overview = false;
  let currentZoom = zoom;
  let renderedFrames = 0;
  let disposed = false;
  const target = new Vector3();
  const zoomBy = (delta: number) => { zoom = Math.max(6, Math.min(18, zoom + delta)); };
  const input = new MovementInput(ui.canvas, ui.joystick, ui.knob, zoomBy);
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
  ui.bind('overview', () => { overview = !overview; ui.setOverview(overview); });
  ui.bind('reset', () => {
    player.root.position.set(SPAWN.x, 0, SPAWN.z);
    overview = false; zoom = 10.7; ui.setOverview(false); ui.toast('回到小路的起点');
  });
  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    const direction = ui.paused ? { x: 0, z: 0 } : input.read();
    const before = player.root.position;
    const next = moveCharacter(before, direction, dt, WALK_SPEED, WORLD_BOUNDS, OBSTACLES, PLAYER_RADIUS);
    const vx = dt > 0 ? (next.x - before.x) / dt : 0;
    const vz = dt > 0 ? (next.z - before.z) / dt : 0;
    player.root.position.x = next.x; player.root.position.z = next.z;
    player.update(dt, vx, vz);
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const desiredZoom = overview ? Math.max(16.5, 14.6 / aspect) * zoom / 10.7 : zoom;
    currentZoom += (desiredZoom - currentZoom) * (1 - Math.exp(-dt * 7));
    applyProjection();
    if (overview) target.set(0, 0, 0);
    else target.set(next.x * 0.75, 0.5, next.z * 0.7 + 1.7);
    Vector3.LerpToRef(camera.target, target, 1 - Math.exp(-dt * 5), camera.target);
    ui.setNearby(LANDMARKS.find((landmark) => Math.hypot(next.x - landmark.x, next.z - landmark.z) <= landmark.range));
    scene.render(); renderedFrames++;
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
      player: { x: player.root.position.x, z: player.root.position.z },
      camera: { alpha: camera.alpha, beta: camera.beta, zoom: currentZoom, overview },
      landmarks: ui.discoveredCount, frames: renderedFrames,
      bones: player.skeleton.bones.length, meshes: scene.meshes.length,
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
