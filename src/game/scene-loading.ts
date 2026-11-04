import type { Scene } from '@babylonjs/core/scene.js';
import { nextPaint } from '../launcher.ts';

/** Mesh.isReady(true) uses Babylon's real material, skinning, instancing and
 * shadow variants. Yield between batches instead of starting every shader in
 * one global Scene.isReady scan while the render/simulation loop also runs. */
export async function prepareScene(scene: Scene, progress: (ready: number, total: number) => void) {
  const meshes = scene.meshes.filter(mesh => mesh.subMeshes?.length);
  const textures = [...scene.textures];
  let pending = [...meshes.map(mesh => () => mesh.isDisposed() || mesh.isReady(true)),
    ...textures.map(texture => () => texture.isReadyOrNotBlocking())];
  const total = pending.length;
  scene.updateTransformMatrix(true);
  while (pending.length) {
    const waiting: typeof pending = [];
    let started = performance.now(), batch = 0, checked = 0;
    for (const ready of pending) {
      if (scene.isDisposed) throw new Error('加载中的场景已释放');
      if (!ready()) waiting.push(ready);
      checked++; batch++;
      if (performance.now() - started >= 8 || batch >= 64) {
        progress(total - pending.length + checked - waiting.length, total);
        await nextPaint(); started = performance.now(); batch = 0;
      }
    }
    pending = waiting;
    progress(total - pending.length, total);
    if (pending.length) await nextPaint();
  }
  // Retain the engine's complete readiness contract (render targets, pending
  // imports, cameras). Expensive per-mesh setup has already been spread out.
  await scene.whenReadyAsync();
}
