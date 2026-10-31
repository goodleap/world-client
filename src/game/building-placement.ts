import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { GameUI } from '../ui.ts';
import type { Economy } from './economy.ts';
import type { Obstacle } from './movement.ts';
import { buildingAt, placementReason } from './construction.ts';
import type { BuildingSite } from './construction.ts';

/** Both pointer workflows share the same snap, validation and commit operation. */
export function createBuildingPlacement(scene: Scene, camera: Camera, ui: GameUI, economy: Economy,
  occupants: () => Obstacle[], blocked: () => boolean, onBegin: () => void, onPlaced: (id: string) => void) {
  const abort = new AbortController(), options = { signal: abort.signal };
  const { toggle, palette, house, cancel: cancelButton } = ui.constructionControls;
  const fillMaterial = new StandardMaterial('placement-fill', scene);
  fillMaterial.disableLighting = true; fillMaterial.alpha = .25;
  const edgeMaterial = new StandardMaterial('placement-edge', scene);
  edgeMaterial.disableLighting = true;
  const fill = MeshBuilder.CreateGround('placement-footprint', { width: 1, height: 1 }, scene);
  fill.material = fillMaterial;
  const edges = Array.from({ length: 6 }, (_, i) => {
    const edge = MeshBuilder.CreateBox(`placement-grid-${i}`, { size: 1 }, scene);
    edge.material = edgeMaterial; return edge;
  });
  const meshes = [fill, ...edges];
  for (const mesh of meshes) { mesh.isPickable = false; mesh.setEnabled(false); }
  let active = false, candidate: BuildingSite | undefined, reason = '';
  let pointer: { id: number; x: number; y: number; dragging: boolean } | undefined;
  let cursor: { x: number; y: number } | undefined;
  const showPalette = (show: boolean) => { palette.hidden = !show; toggle.setAttribute('aria-expanded', String(show)); };
  const hidePreview = () => { for (const m of meshes) m.setEnabled(false); candidate = undefined; };
  function cancel() { active = false; cursor = undefined; pointer = undefined; hidePreview(); ui.setPlacement(false); showPalette(false); }
  function begin() { if (blocked()) return; onBegin(); active = true; ui.setPlacement(true); }
  function preview(x: number, y: number) {
    cursor = { x, y };
    if (!active || blocked() || document.elementFromPoint(x, y) !== ui.canvas) { hidePreview(); return; }
    const rect = ui.canvas.getBoundingClientRect(), ray = scene.createPickingRay(x - rect.left, y - rect.top, null, camera);
    const distance = -ray.origin.y / ray.direction.y;
    if (!Number.isFinite(distance) || distance <= 0) { hidePreview(); return; }
    const point = ray.origin.add(ray.direction.scale(distance));
    candidate = buildingAt('house', point);
    reason = placementReason(candidate, economy.state, occupants());
    const color = Color3.FromHexString(reason ? '#ff826f' : '#62e4ff');
    fillMaterial.emissiveColor.copyFrom(color); edgeMaterial.emissiveColor.copyFrom(color);
    const { width, depth } = candidate;
    fill.scaling.set(width, 1, depth); fill.position.set(candidate.x, .14, candidate.z);
    for (let i = 0; i < edges.length; i++) {
      const horizontal = i < 2 || i === 4, inner = i >= 4;
      const offset = inner ? 0 : (i % 2 ? 1 : -1) * (horizontal ? depth : width) / 2;
      edges[i].scaling.set(horizontal ? width : inner ? .025 : .065, .025, horizontal ? inner ? .025 : .065 : depth);
      edges[i].position.set(candidate.x + (horizontal ? 0 : offset), .17, candidate.z + (horizontal ? offset : 0));
    }
    for (const mesh of meshes) mesh.setEnabled(true);
    ui.setPlacement(true, reason || '民房 · 2 × 2 格 · 点击或松手放置');
  }
  function place(x: number, y: number) {
    if (!active || blocked()) return;
    preview(x, y);
    if (!candidate) return;
    if (reason) { ui.toast(reason); return; }
    const result = economy.placeBuilding('house', candidate, occupants());
    ui.toast(result.message);
    if (result.ok) { cancel(); onPlaced(result.task!.target); }
    else ui.setPlacement(true, result.message);
  }
  toggle.addEventListener('click', () => {
    if (blocked()) return;
    const show = !!palette.hidden; cancel(); showPalette(show); ui.canvas.focus({ preventScroll: true });
  }, options);
  cancelButton.addEventListener('click', cancel, options);
  house.addEventListener('pointerdown', event => {
    if (event.button !== 0 || blocked()) return;
    event.preventDefault(); house.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  }, options);
  house.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.dragging && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 8) { pointer.dragging = true; begin(); }
    if (pointer.dragging) preview(event.clientX, event.clientY);
  }, options);
  house.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dragging = pointer.dragging; pointer = undefined;
    if (dragging) place(event.clientX, event.clientY); else begin();
    showPalette(false); ui.canvas.focus({ preventScroll: true });
  }, options);
  house.addEventListener('pointercancel', cancel, options);
  // Native keyboard activation has no pointer sequence.
  house.addEventListener('click', event => { if (event.detail === 0) { begin(); showPalette(false); } }, options);
  window.addEventListener('pointermove', event => { if (active && !pointer) preview(event.clientX, event.clientY); }, options);
  window.addEventListener('blur', cancel, options);
  return {
    get active() { return active; }, place, cancel,
    update() { if (active && cursor) preview(cursor.x, cursor.y); },
    snapshot: () => ({ active, candidate, reason }),
    dispose() { cancel(); abort.abort(); meshes.forEach(m => m.dispose()); fillMaterial.dispose(); edgeMaterial.dispose(); },
  };
}
