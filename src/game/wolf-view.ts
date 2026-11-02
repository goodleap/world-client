import { DeathView } from './death-view.ts';
import { deathAge, DEATH_END } from './death.ts';
import { createCharacterMaterialSetup } from './character-materials.ts';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { modelAssets } from './model-assets.ts';
import { modelData, modelOptions } from './asset-cache.ts';
import { attachMeshLOD, selectCharacterLOD } from './character-lod.ts';
import type { Wolf } from './raid-state.ts';
import { RAID_CONFIG, WILD_WOLF_SPAWNS } from './raid-state.ts';
import type { GameUI } from '../ui.ts';
import { loadingProgress } from '../loading-progress.ts';

/** Shared geometry/material/immutable action tracks; independent native skeletons.
 * Pool is bounded by the wave cap plus fixed packs. No extra render pass. */
export async function createWolfView(scene: Scene, shadows: ShadowGenerator, ui: GameUI) {
  const url = modelAssets.wolf;
  const data = await modelData(url);
  const source = await loadingProgress.run(url + ':parse', '灰狼：共享模型与动作', () => LoadAssetContainerAsync(data, scene, modelOptions(url)));
  createCharacterMaterialSetup(scene)(source.materials);
  scene.onDisposeObservable.add(() => source.dispose());
  const level = (mesh: { metadata?: any }) => mesh.metadata?.gltf?.extras?.wolfLOD as number | undefined;
  const geometry = (n: number) => (source.meshes.find(m => level(m) === n) as Mesh | undefined)?.geometry;
  const medium = geometry(1), far = geometry(2);
  if (!medium || !far) throw new Error('灰狼缺少远景模型');
  loadingProgress.begin('wolves:attach', '灰狼：实例与动作挂接');
  const pool = Array.from({ length: RAID_CONFIG.maxWolves + WILD_WOLF_SPAWNS.length }, (_, index) => {
    const instance = source.instantiateModelsToScene(name => name, false, { doNotInstantiate: true, predicate: entity => level(entity) === undefined || level(entity) === 0 });
    const root = new TransformNode(`wolf-pool-${index}`, scene);
    for (const node of instance.rootNodes) node.parent = root;
    const mesh = root.getChildMeshes().find(m => m.getTotalVertices()) as Mesh;
    if (!mesh) throw new Error('灰狼网格缺失');
    mesh.receiveShadows = true; mesh.isPickable = false;
    // Skinning moves outside the neutral pose. A conservative local envelope
    // keeps native frustum, picking and shadow culling correct during the bite.
    const bounds = mesh.getBoundingInfo().boundingBox;
    mesh.setBoundingInfo(new BoundingInfo(bounds.minimum.subtract(new Vector3(.3, .45, .45)), bounds.maximum.add(new Vector3(.3, .45, .45))));
    const lod = attachMeshLOD(mesh, medium, far);
    shadows.addShadowCaster(mesh, false);
    for (const group of instance.animationGroups) { group.stop(); for (const t of group.targetedAnimations) t.animation.enableBlending = false; }
    mesh.material?.freeze(); root.setEnabled(false);
    return { root, mesh, lod, death: new DeathView(root), clips: new Map(instance.animationGroups.map(g => [g.name, g])), id: '', label: undefined as HTMLElement | undefined, clip: '', phase: -1, visible: false };
  });
  loadingProgress.done('wolves:attach');
  const point = new Vector3(), projected = new Vector3(), identity = Matrix.Identity();
  const planes = Frustum.GetPlanes(Matrix.Identity());
  return {
    update(wolves: readonly Wolf[], seconds: number, camera: Camera) {
      Frustum.GetPlanesToRef(scene.getTransformMatrix(), planes);
      // A wave-size change shifts the fixed wolves between slots. Remove old
      // labels first so a later old slot cannot delete a newly rebound label.
      for (let i = 0; i < pool.length; i++) if (pool[i].id && pool[i].id !== (wolves[i]?.id ?? '')) ui.removeResidentLabel(pool[i].id);
      for (let i = 0; i < pool.length; i++) {
        const actor = pool[i], wolf = wolves[i];
        if (actor.id !== (wolf?.id ?? '')) {
          actor.id = wolf?.id ?? ''; actor.label = wolf ? ui.addResidentLabel(wolf.id, '灰狼') : undefined;
          actor.clip = ''; actor.phase = -1; actor.death.reset();
          actor.mesh.metadata = { ...actor.mesh.metadata, selectionKind: 'resident', id: wolf?.id };
        }
        const active = !!wolf && wolf.mode !== 'gone' && (wolf.life === 'active' || deathAge(wolf.diedAt, seconds) < DEATH_END);
        if (actor.root.isEnabled() !== active) actor.root.setEnabled(active); actor.visible = false;
        if (!wolf || !active) {
          if (actor.label) actor.label.hidden = true;
          if (wolf?.life === 'defeated') actor.death.sample(deathAge(wolf.diedAt, seconds), wolf.facing, [actor.mesh], () => {});
          continue;
        }
        actor.root.position.x = wolf.position.x; actor.root.position.z = wolf.position.z;
        if (wolf.life === 'active') actor.root.position.y = 0;
        if (wolf.life === 'defeated') {
          if (actor.label) actor.label.hidden = true;
          actor.death.sample(deathAge(wolf.diedAt, seconds), wolf.facing, [actor.mesh], () => {
            for (const g of actor.clips.values()) g.stop();
            const rest = actor.clips.get('Idle')!; rest.start(false).pause(); rest.goToFrame(rest.from);
          });
          actor.root.computeWorldMatrix(true); actor.mesh.computeWorldMatrix(true); actor.visible = actor.mesh.isInFrustum(planes);
          selectCharacterLOD(actor.mesh, camera); continue;
        }
        actor.root.rotationQuaternion ??= Quaternion.Identity();
        Quaternion.RotationYawPitchRollToRef(wolf.facing, 0, 0, actor.root.rotationQuaternion);
        actor.root.computeWorldMatrix(true); actor.mesh.computeWorldMatrix(true);
        actor.visible = actor.mesh.isInFrustum(planes);
        // Offscreen poses need no sampling. Authoritative phases keep running
        // in the simulation, so returning to view resumes at the right phase.
        if (!actor.visible) continue;
        const hurt = wolf.hurtAt !== undefined ? seconds - wolf.hurtAt : Infinity;
        const clip = wolf.attack ? 'Bite' : hurt >= 0 && hurt < .26 ? 'Hurt' : wolf.feeding > 0 ? 'Feed' : wolf.speed > .08 ? 'Run' : 'Idle';
        const phase = wolf.attack ? Math.min(1, wolf.attack.elapsed / .55) : clip === 'Hurt' ? hurt / .26 : clip === 'Feed' ? Math.min(1, wolf.feeding / 1.1) : clip === 'Run' ? wolf.gait : 0;
        if (actor.clip !== clip) {
          actor.clips.get(actor.clip)?.stop();
          const group = actor.clips.get(clip)!; group.start(false); group.pause(); actor.clip = clip; actor.phase = -1;
        }
        if (actor.phase !== phase) { const group = actor.clips.get(clip)!; group.goToFrame(group.from + (group.to - group.from) * phase); actor.phase = phase; }
        // LOD selection is native; camera parameter also makes the shared view
        // policy explicit for all three geometries and the shadow pass.
        selectCharacterLOD(actor.mesh, camera);
      }
    },
    updateLabels(camera: Camera) {
      const width = ui.canvas.clientWidth, height = ui.canvas.clientHeight, viewport = camera.viewport.toGlobal(width, height);
      for (const actor of pool) {
        if (!actor.label || !actor.root.isEnabled() || actor.death.snapshot().phase !== 'alive') continue;
        point.set(actor.root.position.x, 1.95, actor.root.position.z);
        Vector3.ProjectToRef(point, identity, scene.getTransformMatrix(), viewport, projected);
        const visible = actor.visible && (camera.orthoTop ?? 0) - (camera.orthoBottom ?? 0) < 50 && projected.z >= 0 && projected.z <= 1
          && projected.x >= 0 && projected.x <= width && projected.y >= 0 && projected.y <= height;
        actor.label.hidden = !visible;
        if (visible) ui.positionResidentLabel(actor.id, projected.x, projected.y);
      }
    },
    snapshot: () => pool.map(a => ({ id: a.id, death: a.death.snapshot(), active: a.root.isEnabled(), visible: a.visible, clip: a.clip, phase: a.phase,
      skeleton: a.mesh.skeleton?.uniqueId, material: a.mesh.material?.uniqueId, geometry: a.mesh.geometry?.id,
      triangles: scene.activeCamera ? selectCharacterLOD(a.mesh, scene.activeCamera)!.getTotalIndices() / 3 : 0,
      pose: a.mesh.skeleton?.bones.map(b => b.getTransformNode()?.rotationQuaternion?.asArray()),
    })),
  };
}
