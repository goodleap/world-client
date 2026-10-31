import { loadingProgress } from '../loading-progress.ts';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { ISceneLoaderProgressEvent } from '@babylonjs/core/Loading/sceneLoader.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { BoundingSphere } from '@babylonjs/core/Culling/boundingSphere.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { modelData, modelOptions } from './asset-cache.ts';

export interface CharacterLOD { source: Mesh; detail: Mesh; far?: Mesh }

// Orthographic viewport width × height in world units. Ordinary map views use
// the reduced geometry; the model previews and closest phone zoom retain it all.
const MAP_LOD_VIEW_AREA = 120;
const FAR_LOD_VIEW_AREA = 320;
const coverageSpheres = new WeakMap<AbstractMesh, BoundingSphere>();
const configuredScenes = new WeakSet<Scene>();

/** Babylon's conservative world sphere grows when a mesh rotates. For our
 * orthographic view-area thresholds use its fixed reference sphere for LOD
 * only; native render bounds, skinning and frustum tests remain unchanged. */
export function selectCharacterLOD(source: Mesh, camera: Camera) {
  return source.getLOD(camera, camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? coverageSpheres.get(source) : undefined);
}

/** Normalize part thresholds to one orthographic view area: a tiny eye and a
 * large torso switch together. Babylon selects the LOD for both main/shadow
 * passes, and automatically restores the source geometry in close views. */
function addLevel(source: Mesh, data: VertexData | Geometry, area: number, suffix: string) {
  const detail = new Mesh(`${source.name}-${suffix}`, source.getScene());
  data.applyToMesh(detail);
  detail.material = source.material;
  detail.skeleton = source.skeleton;
  detail.numBoneInfluencers = source.numBoneInfluencers;
  detail.computeBonesUsingShaders = source.computeBonesUsingShaders;
  detail.renderingGroupId = source.renderingGroupId;
  detail.sideOrientation = source.sideOrientation;
  detail.useVertexColors = source.useVertexColors;
  detail.hasVertexAlpha = source.hasVertexAlpha;
  detail.receiveShadows = source.receiveShadows;
  detail.isPickable = false;
  detail.metadata = { characterLOD: true };
  source.computeWorldMatrix(true);
  const scene = source.getScene();
  if (!coverageSpheres.has(source)) {
    const sphere = source.getBoundingInfo().boundingSphere;
    coverageSpheres.set(source, new BoundingSphere(sphere.minimum, sphere.maximum, source.getWorldMatrix()));
  }
  if (!configuredScenes.has(scene)) {
    const previous = scene.customLODSelector;
    scene.customLODSelector = (mesh, camera) => mesh instanceof Mesh && coverageSpheres.has(mesh) ? selectCharacterLOD(mesh, camera)
      : previous ? previous(mesh, camera) : mesh.getLOD(camera);
    configuredScenes.add(scene);
  }
  const radius = coverageSpheres.get(source)!.radiusWorld;
  source.useLODScreenCoverage = true;
  source.addLODLevel(Math.PI * radius * radius / area, detail);
  return detail;
}

export function attachMeshLOD(source: Mesh, data: VertexData | Geometry, farData?: VertexData | Geometry): CharacterLOD {
  const detail = addLevel(source, data, MAP_LOD_VIEW_AREA, 'map-lod');
  const far = farData ? addLevel(source, farData, FAR_LOD_VIEW_AREA, 'far-map-lod') : undefined;
  return { source, detail, far };
}

/** Read geometry only. Temporary LOD materials/rigs are disposed after copying;
 * the rendered LOD uses the original character's material and Skeleton. */
export async function loadCharacterLOD(scene: Scene, sources: readonly AbstractMesh[], url: string,
  options: { namePrefix?: string; onProgress?: (event: ISceneLoaderProgressEvent) => void } = {}): Promise<CharacterLOD[]> {
  const data = await modelData(url, options.onProgress);
  const container = await loadingProgress.run(url + ':parse', `${loadingProgress.items.get(url)?.name ?? 'LOD'}：解析`, () => LoadAssetContainerAsync(data, scene, modelOptions(url)));
  const attached: CharacterLOD[] = [];
  const originalName = (name: string) => options.namePrefix && name.startsWith(options.namePrefix) ? name.slice(options.namePrefix.length) : name;
  try {
    if (container.animationGroups.length) throw new Error('Character LOD must not contain duplicate animations');
    const parts = new Map(container.meshes.map(mesh => [mesh.name, mesh]));
    for (const source of sources) {
      if (!(source instanceof Mesh) || !source.skeleton || !source.getTotalVertices()) continue;
      const skeleton = source.skeleton;
      const names: string[] = source.metadata?.batchedParts ?? [source.name];
      const data = names.map(name => {
        const mesh = parts.get(originalName(name));
        if (!(mesh instanceof Mesh) || !mesh.skeleton || mesh.material?.name !== source.material?.name) {
          throw new Error(`Incompatible LOD geometry for ${name}`);
        }
        const indices = (candidate: typeof source.skeleton) => candidate!.bones.filter(bone => bone.getIndex() >= 0)
          .map(bone => `${bone.getIndex()}:${originalName(bone.name)}`).sort().join('|');
        if (indices(mesh.skeleton) !== indices(skeleton)) throw new Error(`LOD joint indices differ for ${name}`);
        if (mesh.numBoneInfluencers !== source.numBoneInfluencers) throw new Error(`LOD skin influences differ for ${name}`);
        return VertexData.ExtractFromMesh(mesh, true, true);
      });
      const [first, ...rest] = data;
      if (rest.length) first.merge(rest, true);
      attached.push(attachMeshLOD(source, first));
    }
    return attached;
  } catch (error) {
    for (const { source, detail } of attached) { source.removeLODLevel(detail); detail.dispose(); }
    throw error;
  } finally { container.dispose(); }
}
