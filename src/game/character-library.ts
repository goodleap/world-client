import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import combatActions from '../../studies/characters/combat-actions.json';
import { createBowString } from './bow-string.ts';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Geometry } from '@babylonjs/core/Meshes/geometry';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { nextPaint } from '../launcher.ts';
import { loadingProgress } from '../loading-progress.ts';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { DEATH } from './death.ts';
import { modelAssets } from './model-assets.ts';
import { modelData, modelOptions } from './asset-cache.ts';
import { createCharacterMaterialSetup } from './character-materials.ts';
import { attachMeshLOD } from './character-lod.ts';
import type { CharacterLOD } from './character-lod.ts';
import catalog from '../../studies/characters/roles.json';
import { batchCharacterMaterials } from './character-material-batching.ts';

export type CharacterRole = keyof typeof catalog.roles;
const parts: Record<string, { name: string; horse: boolean }> = catalog.parts;

/** A scene-local native asset container, with one authoritative human rig and
 * action library. Clones share immutable geometry/materials/keys, while each
 * actor owns its skeleton, target nodes and AnimationGroup playback state. */
export function createCharacterLibrary(scene: Scene) {
  const containers: AssetContainer[] = [];
  const highBatches = new Map<string, Geometry>();
  const lowBatches = new Map<string, { detail: Geometry; far: Geometry }>();
  let templates: Promise<{ high: AssetContainer; low: AssetContainer; far: AssetContainer }> | undefined;
  const prepareMaterials = createCharacterMaterialSetup(scene);
  let instanceCount = 0;
  let humanActions: string[] = [];
  const instances: { role: CharacterRole; meshes: AbstractMesh[]; skeletons: { uniqueId: number; bones: unknown[] }[] }[] = [];
  scene.onDisposeObservable.add(() => containers.forEach(container => container.dispose()));

  const load = () => templates ??= (async () => {
    const loadOne = async (url: string) => {
      const bytes = await modelData(url);
      const container = await loadingProgress.run(url + ':parse', `${loadingProgress.items.get(url)?.name}：模型解析`,
        () => LoadAssetContainerAsync(bytes, scene, modelOptions(url)));
      containers.push(container);
      container.animationGroups.forEach(group => group.stop());
      const geometries = new Map<string, Geometry>();
      for (const mesh of container.meshes) {
        if (!(mesh instanceof Mesh) || !mesh.geometry) continue;
        const extra = mesh.metadata?.gltf?.extras;
        if (!extra?.partId) throw new Error(`共享资源缺少部件标识：${mesh.name}`);
        mesh.metadata = { ...mesh.metadata, sharedParts: [extra.partId] };
        const key = extra.geometryKey;
        const shared = geometries.get(key);
        if (shared) shared.applyToMesh(mesh);
        else geometries.set(key, mesh.geometry);
      }
      return container;
    };
    const urls = [modelAssets.characters, modelAssets.characterLOD, modelAssets.characterFarLOD];
    await Promise.all(urls.map(url => modelData(url)));
    const prepared: AssetContainer[] = [];
    for (const url of urls) { await nextPaint(); prepared.push(await loadOne(url)); }
    const [high, low, far] = prepared;
    for (const [i, container] of [high, low, far].entries()) {
      loadingProgress.begin(urls[i] + ':materials', '共享材质合批'); await nextPaint();
      prepareMaterials(container.materials);
      batchCharacterMaterials(container.meshes);
      for (const material of new Set(container.meshes.map(mesh => mesh.material))) material?.freeze();
      loadingProgress.done(urls[i] + ':materials');
    }
    humanActions = high.animationGroups.filter(group => !group.name.startsWith('Horse')).map(group => group.name);
    return { high, low, far };
  })();

  return {
    highBatches,
    async instantiate(role: CharacterRole, parent: TransformNode) {
      const { high } = await load();
      const config = catalog.roles[role];
      const selectedParts = new Set<string>(config.parts);
      const instance = high.instantiateModelsToScene(name => parts[name]?.name ?? name, false, {
        doNotInstantiate: true,
        predicate: entity => parts[entity.name] ? selectedParts.has(entity.name)
          : config.mounted || !entity.name.startsWith('Horse'),
      });
      for (const root of instance.rootNodes) root.parent = parent;
      const meshes = instance.rootNodes.flatMap(root => [root, ...root.getChildMeshes()])
        .filter((node): node is AbstractMesh => node instanceof Mesh);
      for (const group of instance.animationGroups) group.stop();
      // Mount and rider keep separate rigs and authored tracks, but one native
      // group drives both with identical time/speed/loop boundaries.
      if (config.mounted) for (const name of ['RideIdle', 'RideWalk', 'RideRun']) {
        const human = instance.animationGroups.find(group => group.name === name)!;
        const horse = instance.animationGroups.find(group => group.name === 'Horse' + name)!;
        for (const target of horse.targetedAnimations) human.addTargetedAnimation(target.animation, target.target);
        horse.dispose();
        instance.animationGroups.splice(instance.animationGroups.indexOf(horse), 1);
      }
      if (config.mounted) {
        const idle = instance.animationGroups.find(g => g.name === 'RideIdle')!;
        const attack = instance.animationGroups.find(g => g.name === 'LanceThrust')!;
        // Keep the independent horse rig in its authored standing pose during
        // the thrust. Native constant tracks also reset the previous run pose.
        for (const track of idle.targetedAnimations) if (track.target.name.startsWith('Horse.')) {
          const animation = track.animation.clone();
          const value = animation.getKeys()[0].value;
          animation.setKeys([{ frame: attack.from, value: value.clone() }, { frame: attack.to, value: value.clone() }]);
          attack.addTargetedAnimation(animation, track.target);
        }
      }
      const clip = (name: string) => {
        const found = instance.animationGroups.find(group => group.name === name);
        if (!found) throw new Error(`基础人物动作库缺少 ${name}`);
        return found;
      };
      // Existing seated and standing tracks supply a native, fixed-bone blend
      // for dismounting into a prone corpse. No second body or skeleton.
      let fallPosture: AnimationGroup | undefined;
      if (config.mounted) {
        const seated = clip('RideIdle'), standing = clip('Walk');
        fallPosture = new AnimationGroup('RiderFallPosture', scene);
        for (const track of standing.targetedAnimations) {
          const start = seated.targetedAnimations.find(t => t.target === track.target && t.animation.targetProperty === track.animation.targetProperty);
          if (!start) continue;
          const animation = track.animation.clone(), from = start.animation.getKeys()[0].value, to = track.animation.getKeys()[0].value;
          animation.setKeys([{ frame: 0, value: from.clone() }, { frame: DEATH.fall * 60, value: to.clone() }]);
          animation.framePerSecond = 60; animation.enableBlending = false;
          fallPosture.addTargetedAnimation(animation, track.target);
        }
      }
      const originalString = role === 'archer' ? meshes.find(m => m.name === 'Bow • taut linen string') : undefined;
      const heldArrow = role === 'archer' ? meshes.filter(m => m.name.startsWith('Held arrow •')) : [];
      const roots = instance.rootNodes.filter((node): node is TransformNode => node instanceof TransformNode).map(node => ({ node, rotation: node.rotationQuaternion?.clone() ?? Quaternion.Identity() }));
      const drawn = combatActions.BowShot.keys.find(key => key.phase === combatActions.BowShot.drawPhase)!;
      const bowYaw = Math.atan2(drawn.left[0] - drawn.right[0], drawn.right[2] - drawn.left[2]);
      const hand = (name: string) => instance.skeletons.flatMap(s => s.bones).find(b => b.name === name)?.getTransformNode();
      const right = hand('hand.R'), left = hand('hand.L');
      const bow = originalString && right && left ? createBowString(scene, right, left) : undefined;
      if (originalString) originalString.isPickable = false;
      // Exclude the rigid string from batching so the authored bow can draw.
      const renderedMeshes = meshes.filter(m => m !== originalString && !heldArrow.includes(m));
      instanceCount++;
      for(let i=instances.length-1;i>=0;i--)if(instances[i].meshes.every(mesh=>mesh.isDisposed()))instances.splice(i,1);
      instances.push({ role, meshes, skeletons: instance.skeletons });
      let bowPhase: number | undefined | false = false;
      return { ...instance, fallPosture, meshes: renderedMeshes, bowPose(phase?: number) {
        if (!bow || !originalString) return;
        if (bowPhase === phase) return;
        bowPhase = phase;
        const turn = phase === undefined ? 0 : Math.min(1, phase / .22, (1 - phase) / .22);
        for (const { node, rotation } of roots) node.rotationQuaternion = Quaternion.RotationYawPitchRoll(-bowYaw * turn, 0, 0).multiply(rotation);
        for (const mesh of heldArrow) mesh.setEnabled(phase === undefined);
        originalString.setEnabled(!bow.update(phase));
      }, walk: clip(config.walk), run: clip(config.run), work: clip('Hammer'),
        idle: config.mounted ? clip('RideIdle') : undefined };
    },
    async attachLOD(sources: readonly AbstractMesh[]): Promise<CharacterLOD[]> {
      const { low, far } = await load();
      const levels = [low, far].map(container => new Map(container.meshes.map(mesh => [mesh.metadata?.sharedParts?.[0], mesh])));
      const attached: CharacterLOD[] = [];
      for (const source of sources) {
        if (!(source instanceof Mesh) || !source.skeleton || !source.getTotalVertices()) continue;
        const ids: string[] = source.metadata?.sharedParts;
        if (!ids?.length) throw new Error(`LOD 缺少部件对应关系：${source.name}`);
        const key = ids.join(',');
        let geometry = lowBatches.get(key);
        if (!geometry || geometry.detail.isDisposed() || geometry.far.isDisposed()) {
          const data = levels.map(templates => {
            const parts = ids.map(id => {
              const mesh = templates.get(id);
              if (!(mesh instanceof Mesh) || mesh.material?.name !== source.material?.name ||
                mesh.numBoneInfluencers !== source.numBoneInfluencers ||
                mesh.skeleton?.bones.map(bone => bone.name).join('|') !== source.skeleton!.bones.map(bone => bone.name).join('|')) {
                throw new Error(`LOD 蒙皮或材质不匹配：${id}`);
              }
              return VertexData.ExtractFromMesh(mesh, true, true);
            });
            const [first, ...rest] = parts;
            if (rest.length) first.merge(rest, true);
            return first;
          });
          const pair = attachMeshLOD(source, data[0], data[1]);
          geometry = { detail: pair.detail.geometry!, far: pair.far!.geometry! };
          lowBatches.set(key, geometry);
          attached.push(pair);
        } else attached.push(attachMeshLOD(source, geometry.detail, geometry.far));
      }
      return attached;
    },
    summary: () => ({ containers: containers.length, instances: instanceCount,
      humanActions, highBatches: highBatches.size, lowBatches: lowBatches.size,
      actors: instances.filter(instance=>instance.meshes.some(mesh=>!mesh.isDisposed())).map(instance => ({ role: instance.role,
        skeletons: instance.skeletons.map(skeleton => ({ id: skeleton.uniqueId, bones: skeleton.bones.length })),
        headGeometry: (instance.meshes.find(mesh => mesh.name === 'Head • shaped cranium cheeks and jaw') as Mesh | undefined)?.geometry?.uniqueId,
      })),
    }),
  };
}
