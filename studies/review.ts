// Review the exported asset in the same engine as the game, without a scene
// hiding its silhouette. Kept separate from the game's entry point.
import { Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, ImportMeshAsync, TransformNode, Mesh } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { createCharacterMaterialSetup } from '../src/game/character-materials';
import { createDaylight } from '../src/game/lighting';
import { createCharacterLibrary } from '../src/game/character-library';
import type { CharacterRole } from '../src/game/character-library';
import { batchSkinnedMeshes } from '../src/game/mesh-batching';
import { loadCharacterLOD, selectCharacterLOD } from '../src/game/character-lod';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(.961, .945, .91, 1);
const camera = new ArcRotateCamera('review', -Math.PI / 2, Math.PI / 2, 4, new Vector3(0, .89, 0), scene);
camera.mode = 1;
camera.minZ = .01;
const params = new URLSearchParams(location.search);
// Keep lighting explicit: neutral shape inspection or the actual game rig.
if (params.get('lighting') === 'game') createDaylight(scene);
else {
  const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
  fill.intensity = .55; fill.groundColor = new Color3(.42, .40, .38);
  const key = new DirectionalLight('key', new Vector3(.5, -1, -.8), scene); key.intensity = 1.5;
}
const asset = params.get('asset') || '/studies/base-human/base-human.glb';
const role = params.get('role') as CharacterRole | null;
const library = role ? createCharacterLibrary(scene) : undefined;
const loaded = library ? await library.instantiate(role!, new TransformNode('review-actor', scene)) : await ImportMeshAsync(asset, scene);
createCharacterMaterialSetup(scene)(loaded.meshes.map(mesh => mesh.material));
const sources = batchSkinnedMeshes(loaded.meshes, library?.highBatches);
const lod = library ? await library.attachLOD(sources) : params.has('lodAsset')
  ? await loadCharacterLOD(scene, sources, params.get('lodAsset')!) : [];
function mapLOD(enabled: boolean | 'far') {
  for (const { source, detail, far } of lod) {
    source.removeLODLevel(detail);
    if (far) source.removeLODLevel(far);
    source.addLODLevel(enabled ? 1e6 : 0, enabled === 'far' ? far ?? detail : detail);
  }
  scene.render();
}
await scene.whenReadyAsync();
const groups = loaded.animationGroups;
function pose(name = params.get('clip') || 'Walk', phase = 0) {
  groups.forEach(g => g.stop());
  const group = groups.find(g => g.name === name);
  if (!group) throw new Error(`Unknown review clip: ${name}`);
  group.start(true); group.pause(); group.goToFrame(group.from + phase * (group.to - group.from));
  scene.render();
}
function view(name: string) {
  camera.target.set(0, Number(params.get('center') || .89), 0);
  camera.alpha = Math.PI / 2; camera.beta = Math.PI / 2;
  let height = Number(params.get('height') || 2.1);
  if (name === 'side') camera.alpha = 0;
  if (name === 'back') camera.alpha = -Math.PI / 2;
  if (name === 'game' || name === 'mobile') { camera.alpha = 1.13; camera.beta = 1.03; height *= 2.25 / 2.1; }
  if (name === 'hands') { camera.target.set(-.40, .405, .015); camera.alpha = 2.25; camera.beta = 1.35; height = .32; }
  if (name === 'feet') { camera.target.set(0, .080, .080); camera.alpha = 1.35; camera.beta = .97; height = .88; }
  camera.orthoTop = height / 2; camera.orthoBottom = -height / 2;
  camera.orthoLeft = -height / 2 * engine.getAspectRatio(camera);
  camera.orthoRight = -camera.orthoLeft;
  scene.render();
}
pose(); view('front');
engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());
Object.assign(window, { review: { pose, view, mapLOD, scene, loaded, engine,
  async pixels() {
    scene.render();
    const bytes = new Uint8Array((await engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight()))!.buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  },
  geometry: () => sources.filter((m): m is Mesh => m instanceof Mesh && !!m.geometry).map(mesh => ({ name: mesh.name,
    triangles: (selectCharacterLOD(mesh, camera) ?? mesh).getTotalIndices() / 3, skeleton: mesh.skeleton?.name })),
  play(name: string) { groups.forEach(g => g.stop()); groups.find(g => g.name === name)!.start(true); },
  summary: { meshes: loaded.meshes.map(m => m.name), bones: loaded.skeletons[0]?.bones.map(b => b.name), animations: groups.map(g => ({ name: g.name, from: g.from, to: g.to })) },
} });
