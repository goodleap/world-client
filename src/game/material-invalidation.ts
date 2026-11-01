import type { Scene } from '@babylonjs/core/scene.js';

/** Frozen materials skip shader readiness checks. Native light membership /
 * shadow toggles dirty defines but do not clear that shortcut in Babylon 9.32.
 * Revalidate only on these infrequent changes, never in the ordinary frame. */
export function refreshFrozenMaterials(scene: Scene) {
  for (const material of scene.materials) if (material.isFrozen) material.markDirty(true);
}
