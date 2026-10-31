import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Plane } from '@babylonjs/core/Maths/math.plane.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';

/** Babylon's explicit shadow renderList skips view-frustum tests. Keep a static
 * caster if either its body OR its sun-projected volume can affect the view.
 * Animated meshes retain the native path: bind-pose bounds cannot prove culling. */
export function createShadowCasterFilter(direction: Vector3) {
  const cache = new WeakMap<AbstractMesh, { matrixVersion: number; bounds: BoundingInfo }>();
  return (meshes: readonly AbstractMesh[], length: number, planes: Plane[]) => {
    const visible: AbstractMesh[] = [];
    for (let i = 0; i < length; i++) {
      const mesh = meshes[i];
      if (!mesh || mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible) continue;
      if (mesh.skeleton || mesh.morphTargetManager || direction.y >= -.01) { visible.push(mesh); continue; }
      const matrixVersion = mesh.computeWorldMatrix().updateFlag;
      let entry = cache.get(mesh);
      if (!entry || entry.matrixVersion !== matrixVersion) {
        const box = mesh.getBoundingInfo().boundingBox;
        // All current receiving surfaces are above -0.2; extend to that plane
        // and include a margin for bias / PCF. This overestimates occlusion.
        const height = Math.max(0, box.maximumWorld.y + .2);
        const dx = direction.x * height / -direction.y, dz = direction.z * height / -direction.y;
        entry = { matrixVersion, bounds: new BoundingInfo(
          new Vector3(box.minimumWorld.x + Math.min(0, dx) - .2, Math.min(-.2, box.minimumWorld.y), box.minimumWorld.z + Math.min(0, dz) - .2),
          new Vector3(box.maximumWorld.x + Math.max(0, dx) + .2, box.maximumWorld.y + .2, box.maximumWorld.z + Math.max(0, dz) + .2)) };
        cache.set(mesh, entry);
      }
      if (entry.bounds.isInFrustum(planes)) visible.push(mesh);
    }
    return visible;
  };
}
