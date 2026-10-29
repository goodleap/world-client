// Review the exported asset in the same engine as the game, without a scene
// hiding its silhouette. Kept separate from the game's entry point.
import { Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, ImportMeshAsync } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(.961, .945, .91, 1);
const camera = new ArcRotateCamera('review', -Math.PI / 2, Math.PI / 2, 4, new Vector3(0, .89, 0), scene);
camera.mode = 1;
camera.minZ = .01;
// Neutral inspection light faces the asset's glTF front (+Z in this scene).
const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
fill.intensity = .55; fill.groundColor = new Color3(.42, .40, .38);
const key = new DirectionalLight('key', new Vector3(.5, -1, -.8), scene); key.intensity = 1.5;
const params = new URLSearchParams(location.search);
const asset = params.get('asset') || '/studies/base-human/base-human.glb';
const loaded = await ImportMeshAsync(asset, scene);
const groups = loaded.animationGroups;
function pose(name = 'Walk', phase = 0) {
  groups.forEach(g => g.stop());
  const group = groups.find(g => g.name === name)!;
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
Object.assign(window, { review: { pose, view, scene, loaded,
  play(name: string) { groups.forEach(g => g.stop()); groups.find(g => g.name === name)!.start(true); },
  summary: { meshes: loaded.meshes.map(m => m.name), bones: loaded.skeletons[0]?.bones.map(b => b.name), animations: groups.map(g => ({ name: g.name, from: g.from, to: g.to })) },
} });
