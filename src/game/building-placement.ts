import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { GameUI } from '../ui.ts';
import type { Economy } from './economy.ts';
import type { Obstacle } from './movement.ts';
import { buildingAt, placementReason, BUILDING_TYPES } from './construction.ts';
import type { BuildingSite, BuildingKind } from './construction.ts';

/** Both pointer workflows share the same snap, validation and commit operation. */
export function createBuildingPlacement(scene: Scene, camera: Camera, ui: GameUI, economy: Economy,
  occupants: () => Obstacle[], blocked: () => boolean, onBegin: () => void, onPlaced: (id: string) => void) {
  const abort = new AbortController(), options = { signal: abort.signal };
  const { toggle, palette, choices, cancel: cancelButton } = ui.constructionControls;
  const fillMaterial = new StandardMaterial('placement-fill', scene);
  fillMaterial.disableLighting = true; fillMaterial.alpha = .25;
  const edgeMaterial = new StandardMaterial('placement-edge', scene);
  edgeMaterial.disableLighting = true;
  const fill = MeshBuilder.CreateGround('placement-footprint', { width: 1, height: 1 }, scene);
  fill.material = fillMaterial;
  const edges = Array.from({ length: 7 }, (_, i) => {
    const edge = MeshBuilder.CreateBox(`placement-grid-${i}`, { size: 1 }, scene);
    edge.material = edgeMaterial; return edge;
  });
  const meshes = [fill, ...edges];
  for (const mesh of meshes) { mesh.isPickable = false; mesh.setEnabled(false); }
  let active = false, candidate: BuildingSite | undefined, reason = '';
  let kind: BuildingKind = 'farm';
  let pointer: { id: number; x: number; y: number; dragging: boolean } | undefined;
  let cursor: { x: number; y: number } | undefined;
  const showPalette = (show: boolean) => { palette.hidden = !show; toggle.setAttribute('aria-expanded', String(show)); };
  const hidePreview = () => { for (const m of meshes) m.setEnabled(false); candidate = undefined; ui.clearTargetHint(); };
  function cancel() { active = false; cursor = undefined; pointer = undefined; hidePreview(); ui.setPlacement(false); showPalette(false); }
  function begin(nextKind: BuildingKind) { if (blocked()) return; onBegin(); kind = nextKind; active = true; ui.setPlacement(true, `${BUILDING_TYPES[kind].name} · 选择位置`); }
  function preview(x: number, y: number) {
    cursor = { x, y };
    if (!active || blocked() || document.elementFromPoint(x, y) !== ui.canvas) { hidePreview(); return; }
    const rect = ui.canvas.getBoundingClientRect(), ray = scene.createPickingRay(x - rect.left, y - rect.top, null, camera);
    const distance = -ray.origin.y / ray.direction.y;
    if (!Number.isFinite(distance) || distance <= 0) { hidePreview(); return; }
    const point = ray.origin.add(ray.direction.scale(distance));
    candidate = buildingAt(kind, point);
    reason = economy.regionLocked(candidate) || placementReason(candidate, economy.state, occupants());
    const color = Color3.FromHexString(reason ? '#ff826f' : '#62e4ff');
    fillMaterial.emissiveColor.copyFrom(color); edgeMaterial.emissiveColor.copyFrom(color);
    const { width, depth } = candidate;
    fill.scaling.set(width, 1, depth); fill.position.set(candidate.x, .14, candidate.z);
    const type = BUILDING_TYPES[kind];
    let index = 0;
    for (const horizontal of [true, false]) {
      const count = horizontal ? type.rows : type.columns;
      for (let i = 0; i <= count; i++) {
        const edge = edges[index++], offset = (i / count - .5) * (horizontal ? depth : width), thickness = i === 0 || i === count ? .065 : .025;
        edge.scaling.set(horizontal ? width : thickness, .025, horizontal ? thickness : depth);
        edge.position.set(candidate.x + (horizontal ? 0 : offset), .17, candidate.z + (horizontal ? offset : 0));
        edge.setEnabled(true);
      }
    }
    for (; index < edges.length; index++) edges[index].setEnabled(false);
    fill.setEnabled(true);
    ui.setPlacement(true, `${type.name} · 点击或松手放置`);
    if (reason) ui.targetHint(reason, { x: candidate.x, y: .2, z: candidate.z }, true);
    else ui.clearTargetHint(true);
  }
  function place(x: number, y: number) {
    if (!active || blocked()) return;
    preview(x, y);
    if (!candidate) return;
    if (reason) return;
    const result = economy.placeBuilding(kind, candidate, occupants());
    if (result.ok) { cancel(); onPlaced(result.task!.target); }
    else ui.targetHint(result.message, { x: candidate.x, y: .2, z: candidate.z });
  }
  toggle.addEventListener('click', () => {
    if (blocked()) return;
    const show = !!palette.hidden; cancel(); showPalette(show); ui.canvas.focus({ preventScroll: true });
  }, options);
  cancelButton.addEventListener('click', cancel, options);
  for (const choice of choices) {
    const nextKind = choice.dataset.building as BuildingKind;
    choice.addEventListener('pointerdown', event => {
      if (event.button !== 0 || blocked()) return;
      event.preventDefault(); choice.setPointerCapture(event.pointerId);
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    }, options);
    choice.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (!pointer.dragging && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 8) { pointer.dragging = true; begin(nextKind); }
      if (pointer.dragging) preview(event.clientX, event.clientY);
    }, options);
    choice.addEventListener('pointerup', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dragging = pointer.dragging; pointer = undefined;
      if (dragging) place(event.clientX, event.clientY); else begin(nextKind);
      showPalette(false); ui.canvas.focus({ preventScroll: true });
    }, options);
    choice.addEventListener('pointercancel', cancel, options);
    // Native keyboard activation has no pointer sequence.
    choice.addEventListener('click', event => { if (event.detail === 0) { begin(nextKind); showPalette(false); } }, options);
  }
  window.addEventListener('pointermove', event => { if (active && !pointer) preview(event.clientX, event.clientY); }, options);
  window.addEventListener('blur', cancel, options);
  return {
    get active() { return active; }, place, cancel,
    update() { if (active && cursor) preview(cursor.x, cursor.y); },
    snapshot: () => ({ active, candidate, reason }),
    dispose() { cancel(); abort.abort(); meshes.forEach(m => m.dispose()); fillMaterial.dispose(); edgeMaterial.dispose(); },
  };
}
