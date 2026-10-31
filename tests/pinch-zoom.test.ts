import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { pinchMapCamera } from '../src/game/pinch-zoom.ts';

const limits = { min: 4, max: 169 };
type Pixel = { x: number; y: number };
function cameraFixture(width = 393, height = 754, scale = 1) {
  const engine = new NullEngine({ renderWidth: Math.floor(width / scale), renderHeight: Math.floor(height / scale),
    textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  // NullEngine hardcodes 1; expose the actual browser scaling level to the
  // native picking-ray API so this also checks CSS pixels vs render pixels.
  engine.getHardwareScalingLevel = () => scale;
  const scene = new Scene(engine), canvas = { left: 17, top: 23 };
  const camera = new ArcRotateCamera('map', -Math.PI / 2, .76, 200, new Vector3(3.5, .5, -4), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.minZ = .1; camera.maxZ = 500;
  const setZoom = (zoom: number) => {
    camera.orthoTop = zoom; camera.orthoBottom = -zoom;
    camera.orthoRight = zoom * engine.getRenderWidth() / engine.getRenderHeight(); camera.orthoLeft = -camera.orthoRight;
  };
  const groundAt = (p: Pixel) => {
    const ray = scene.createPickingRay(p.x - canvas.left, p.y - canvas.top, null, camera);
    return ray.origin.add(ray.direction.scale(ray.intersectsPlane(new Plane(0, 1, 0, 0))!));
  };
  const project = (p: Vector3) => {
    const screen = Vector3.Project(p, Matrix.IdentityReadOnly, camera.getViewMatrix().multiply(camera.getProjectionMatrix()),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    return { x: screen.x * scale + canvas.left, y: screen.y * scale + canvas.top };
  };
  return { scene, camera, canvas, setZoom, groundAt, project, dispose: () => { scene.dispose(); engine.dispose(); } };
}

test('ground stays under both fingers as their spacing changes across view sizes, DPI and zoom levels', () => {
  for (const [width, height, resolutionScale] of [[393, 754, 1], [393, 754, 2 / 3], [844, 390, 1], [1280, 900, 1]]) {
    const f = cameraFixture(width, height, resolutionScale);
    try {
      for (const zoom of [8, 16.2, 60]) for (const steps of [1, 24]) {
        f.setZoom(zoom); f.camera.target.set(3.5, .5, -4);
        const start = { x: width * .42, y: height * .64 }, end = { x: start.x + 28, y: start.y - 35 };
        const offset = { x: width * .14, y: height * .03 };
        const points = [-1, 1].map(side => f.groundAt({ x: start.x + side * offset.x, y: start.y + side * offset.y }));
        let previousCenter = start, previousScale = 1, result = zoom;
        for (let step = 1; step <= steps; step++) {
          const t = step / steps, scale = 1 + t * .6, center = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
          result = pinchMapCamera(f.scene, f.camera, { scale: scale / previousScale, previousCenter, center }, f.canvas, limits);
          for (const [i, side] of [-1, 1].entries()) {
            const pixel = f.project(points[i]);
            assert.ok(Math.hypot(pixel.x - center.x - side * offset.x * scale, pixel.y - center.y - side * offset.y * scale) < .06,
              `ground must follow each finger: ${JSON.stringify({ width, height, resolutionScale, zoom, steps, step, pixel,
                expected: { x: center.x + side * offset.x * scale, y: center.y + side * offset.y * scale } })}`);
          }
          previousCenter = center; previousScale = scale;
        }
        assert.ok(Math.abs(zoom / result - 1.6) < 1e-10);
        const restored = pinchMapCamera(f.scene, f.camera, { scale: 1 / 1.6, previousCenter: end, center: start }, f.canvas, limits);
        assert.ok(Math.abs(restored - zoom) < 1e-10);
        assert.ok(Vector3.Distance(f.camera.target, new Vector3(3.5, .5, -4)) < .003);
        assert.equal(f.camera.radius, 200, 'orthographic scaling does not alter the perspective radius');
      }
    } finally { f.dispose(); }
  }
});

test('zoom limits stay anchored and reverse immediately without storing excess pinch motion', () => {
  const f = cameraFixture();
  try {
    const center = { x: 280, y: 500 };
    for (const [initial, outward, limit, reverse] of [[5, 2, 4, .8], [120, .5, 169, 1.2]]) {
      f.setZoom(initial);
      const anchor = f.groundAt(center);
      assert.equal(pinchMapCamera(f.scene, f.camera, { scale: outward, previousCenter: center, center }, f.canvas, limits), limit);
      assert.ok(Vector3.Distance(f.groundAt(center), anchor) < .003);
      const next = pinchMapCamera(f.scene, f.camera, { scale: reverse, previousCenter: center, center }, f.canvas, limits);
      assert.ok(Math.abs(next - limit / reverse) < 1e-10);
      assert.ok(Vector3.Distance(f.groundAt(center), anchor) < .003);
      for (const scale of [0, -1, NaN, Infinity]) {
        assert.equal(pinchMapCamera(f.scene, f.camera, { scale, previousCenter: center, center }, f.canvas, limits), next);
      }
    }
  } finally { f.dispose(); }
});
