import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Plane } from '@babylonjs/core/Maths/math.plane.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { RigEnvelope } from './rig-envelope.ts';

/** Babylon's explicit shadow renderList skips view-frustum tests. Keep a static
 * caster if either its body OR its sun-projected volume can affect the view.
 * Animated meshes require an envelope containing all authored poses; unknown
 * rigs/morphs retain the native path instead of culling by their bind pose. */
export function createShadowCasterFilter(direction: Vector3) {
  const cache = new WeakMap<object, { matrixVersion: number; bounds: BoundingInfo }>();
  const visible: AbstractMesh[] = [];
  return (meshes: readonly AbstractMesh[], length: number, planes: Plane[]) => {
    visible.length = 0;
    for (let i = 0; i < length; i++) {
      const mesh = meshes[i];
      if (!mesh || mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible) continue;
      const envelope: RigEnvelope | undefined = mesh.metadata?.rigEnvelope;
      if (mesh.skeleton && !envelope || mesh.morphTargetManager || direction.y >= -.01) { visible.push(mesh); continue; }
      const matrix = (envelope?.root ?? mesh).computeWorldMatrix();
      const matrixVersion = matrix.updateFlag, key = envelope ?? mesh;
      let entry = cache.get(key);
      if (!entry || entry.matrixVersion !== matrixVersion) {
        let box = mesh.getBoundingInfo().boundingBox;
        if (envelope) {
          const center = envelope.root.getAbsolutePosition(), scale = envelope.root.absoluteScaling;
          const radius = envelope.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
          box = new BoundingInfo(center.subtractFromFloats(radius, radius, radius), center.add(new Vector3(radius, radius, radius))).boundingBox;
        }
        // All current receiving surfaces are above -0.2; extend to that plane
        // and include a margin for bias / PCF. This overestimates occlusion.
        const height = Math.max(0, box.maximumWorld.y + .2);
        const dx = direction.x * height / -direction.y, dz = direction.z * height / -direction.y;
        entry = { matrixVersion, bounds: new BoundingInfo(
          new Vector3(box.minimumWorld.x + Math.min(0, dx) - .2, Math.min(-.2, box.minimumWorld.y), box.minimumWorld.z + Math.min(0, dz) - .2),
          new Vector3(box.maximumWorld.x + Math.max(0, dx) + .2, box.maximumWorld.y + .2, box.maximumWorld.z + Math.max(0, dz) + .2)) };
        cache.set(key, entry);
      }
      if (entry.bounds.isInFrustum(planes)) visible.push(mesh);
    }
    return visible;
  };
}
