import '@babylonjs/core/Culling/ray.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { PinchGesture } from './input.ts';

const ground = new Plane(0, 1, 0, 0);

/** Babylon's natural pinch changes camera.radius, which cannot magnify an
 * orthographic map. Apply its distance-ratio rule to the ortho extents instead,
 * using native picking rays to keep the ground attached to the finger midpoint. */
export function pinchMapCamera(scene: Scene, camera: ArcRotateCamera, gesture: PinchGesture,
  canvas: { left: number; top: number }, limits: { min: number; max: number }) {
  const oldZoom = (camera.orthoTop! - camera.orthoBottom!) / 2;
  if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return oldZoom;
  const pointAt = (point: { x: number; y: number }) => {
    const ray = scene.createPickingRay(point.x - canvas.left, point.y - canvas.top, null, camera);
    const distance = ray.intersectsPlane(ground);
    return distance === null ? undefined : ray.origin.add(ray.direction.scale(distance));
  };
  const anchor = pointAt(gesture.previousCenter);
  const zoom = Math.max(limits.min, Math.min(limits.max, oldZoom / gesture.scale));
  const aspect = (camera.orthoRight! - camera.orthoLeft!) / (2 * oldZoom);
  camera.orthoTop = zoom; camera.orthoBottom = -zoom;
  camera.orthoRight = zoom * aspect; camera.orthoLeft = -zoom * aspect;
  const underFingers = pointAt(gesture.center);
  if (anchor && underFingers) {
    camera.target.x += anchor.x - underFingers.x;
    camera.target.z += anchor.z - underFingers.z;
  }
  return zoom;
}
