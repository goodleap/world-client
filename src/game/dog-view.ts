import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { modelAssets } from './model-assets.ts';
import { modelData, modelOptions } from './asset-cache.ts';
import { attachMeshLOD, selectCharacterLOD } from './character-lod.ts';
import { createCharacterMaterialSetup } from './character-materials.ts';
import { loadingProgress } from '../loading-progress.ts';
import metadata from '../../studies/dog/dog.json';

/** One authored GLB, one material/rig/action library, three native skinned LODs.
 * Navigation still owns root movement. All animation uses the scene pause clock. */
export function createVillageDog(scene: Scene, shadows: ShadowGenerator, id: string) {
  const root = new TransformNode(id, scene);
  root.rotationQuaternion = Quaternion.Identity();
  let mesh!: Mesh, skeleton!: Skeleton;
  const clips = new Map<string, AnimationGroup>();
  let motion: 'idle' | 'walk' | 'run' | 'feed' = 'idle', facing = Math.PI;
  const referenceSpeed = metadata.motion.Run.referenceSpeed;
  return {
    root,
    get mesh() { return mesh; },
    get skeleton() { return skeleton; },
    partNames: metadata.parts,
    get motion() { return motion; },
    get runPlaybackRate() { return clips.get('Run')?.speedRatio; },
    get runReferenceSpeed() { return referenceSpeed; },
    lodInfo() {
      if (!mesh) return;
      return { triangles: scene.activeCamera ? selectCharacterLOD(mesh, scene.activeCamera)!.getTotalIndices() / 3 : 0,
        levels: metadata.levels, sharedSkeletonAndMaterials: mesh.getLODLevels().every(l => l.mesh?.skeleton === skeleton && l.mesh.material === mesh.material) };
    },
    async loadModel() {
      const url = modelAssets.dog, data = await modelData(url);
      const source = await loadingProgress.run(url + ':parse', '田园犬：曲面模型与动作解析', () => LoadAssetContainerAsync(data, scene, modelOptions(url)));
      source.addAllToScene();
      loadingProgress.begin('dog:attach', '田园犬：骨骼、动作与 LOD 挂接');
      for (const node of source.rootNodes) node.parent = root;
      const levels = [0, 1, 2].map(n => source.meshes.find(m => m.metadata?.gltf?.extras?.dogLOD === n) as Mesh);
      if (levels.some(m => !m?.geometry)) throw new Error('田园犬缺少 LOD 几何');
      mesh = levels[0]; skeleton = mesh.skeleton!;
      mesh.receiveShadows = true; mesh.isPickable = false;
      const bounds = mesh.getBoundingInfo().boundingBox;
      mesh.setBoundingInfo(new BoundingInfo(bounds.minimum.subtract(new Vector3(.15, .2, .25)), bounds.maximum.add(new Vector3(.15, .15, .25))));
      createCharacterMaterialSetup(scene)([mesh.material]);
      attachMeshLOD(mesh, levels[1].geometry!, levels[2].geometry!);
      for (const detail of levels.slice(1)) detail.dispose(false, false);
      shadows.addShadowCaster(mesh, false);
      for (const group of source.animationGroups) {
        group.stop(); group.enableBlending = true; group.blendingSpeed = .2;
        clips.set(group.name, group);
      }
      for (const name of ['Idle', 'Walk', 'Run', 'Feed']) if (!clips.has(name)) throw new Error(`田园犬缺少 ${name} 动作`);
      clips.get('Idle')!.start(true); mesh.material?.freeze();
      loadingProgress.done('dog:attach');
    },
    freezePose() {
      for (const group of clips.values()) { group.stop(); group.enableBlending = false; }
      const rest = clips.get('Idle')!; rest.start(false).pause(); rest.goToFrame(rest.from); motion = 'idle';
    },
    update(seconds: number, vx: number, vz: number, purposeful = false, feeding = false) {
      if (!clips.size) return;
      const speed = Math.hypot(vx, vz);
      const next = speed > .06 ? purposeful ? 'run' : 'walk' : feeding ? 'feed' : 'idle';
      const name = (value: typeof motion) => value[0].toUpperCase() + value.slice(1);
      if (next !== motion) { clips.get(name(motion))!.stop(); motion = next; clips.get(name(motion))!.start(true); }
      clips.get(name(motion))!.speedRatio = motion === 'run' ? speed / referenceSpeed : motion === 'walk' ? speed / metadata.motion.Walk.referenceSpeed : 1;
      if (speed > .06) {
        const target = Math.atan2(vx, vz);
        facing += Math.atan2(Math.sin(target - facing), Math.cos(target - facing)) * (1 - Math.exp(-seconds * 7));
      }
      Quaternion.RotationYawPitchRollToRef(facing, 0, 0, root.rotationQuaternion!);
    },
  };
}
