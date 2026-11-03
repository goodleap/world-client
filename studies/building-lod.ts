import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { createPalette } from '../src/game/models.ts';
import { createDaylight } from '../src/game/lighting.ts';
import { referenceHouse, homeCenter } from '../src/game/buildings.ts';
import { attachBuildingLOD } from '../src/game/building-lod.ts';
import { createBuildingDoors } from '../src/game/building-doors.ts';
import { BUILDINGS } from '../src/game/world-data.ts';
const canvas = document.querySelector('canvas')!, engine = new Engine(canvas, true), scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#e9e4cfff');
const camera = new ArcRotateCamera('review', -Math.PI / 2, .76, 30, new Vector3(0, 2.1, 0), scene);
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
const p = createPalette(scene), shadows = createDaylight(scene);
const id = new URLSearchParams(location.search).get('id') || 'cottage';
const b = { ...BUILDINGS.find(b => b.id === id)!, x: 0, z: 0 };
if (id === 'home-center') homeCenter(scene, p, b); else referenceHouse(scene, p, b, false);
const groups = new Map<Mesh['material'], Mesh[]>();
for (const m of scene.meshes) { const group = groups.get(m.material) ?? []; group.push(m as Mesh); groups.set(m.material, group); }
const sources = [...groups.values()].map(parts => Mesh.MergeMeshes(parts, true, true)!);
for (const m of sources) { m.receiveShadows = true; shadows.addShadowCaster(m, false); }
attachBuildingLOD(scene, sources, detail => { if (id === 'home-center') homeCenter(scene, p, b, detail); else referenceHouse(scene, p, b, false, detail); });
const doors = createBuildingDoors(scene, p, shadows); doors.add(b, id === 'warehouse');
const ground = MeshBuilder.CreateGround('floor', { width: 60, height: 60 }, scene); ground.material = p.grass; ground.receiveShadows = true;
const levels = sources.map(source => ({ source, levels: [...source.getLODLevels()] }));
function detail(value: 'near' | 'map' | 'far') {
  for (const entry of levels) {
    for (const l of entry.levels) entry.source.removeLODLevel(l.mesh);
    for (const l of entry.levels) entry.source.addLODLevel(l.mesh?.name.endsWith(value) ? 1e6 : 0, l.mesh);
  }
  scene.render();
}
function view(name: string, height = 8) {
  engine.resize(); camera.alpha = name === 'side' ? 0 : -Math.PI / 2; camera.beta = name === 'front' || name === 'side' ? 1.45 : .76;
  const aspect = engine.getAspectRatio(camera); camera.orthoTop = height / 2; camera.orthoBottom = -height / 2;
  camera.orthoRight = height / 2 * aspect; camera.orthoLeft = -camera.orthoRight; scene.render();
}
view('game'); await scene.whenReadyAsync(); scene.render();
Object.assign(window, { buildingReview: { detail, view, scene, engine, sources, doors,
  summary: () => ({ triangles: sources.reduce((sum, mesh) => sum + mesh.getLOD(camera)!.getTotalIndices() / 3, 0), meshes: scene.meshes.length }) } });
