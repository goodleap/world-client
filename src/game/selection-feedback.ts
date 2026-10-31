import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HighlightLayer } from '@babylonjs/core/Layers/highlightLayer';
import '@babylonjs/core/Rendering/outlineRenderer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { WorldObject } from './world-selection.ts';
export const SELECTION_COLOR = '#62e4ff';

/** Native skinned outlines follow animation. A selected instance gets a temporary
 * geometry-sharing mesh, so Babylon never highlights all instances of its source. */
export function createSelectionFeedback(scene: Scene, shadows: ShadowGenerator) {
  const color = Color3.FromHexString(SELECTION_COLOR);
  const glow = new HighlightLayer('selection-glow', scene, { mainTextureRatio: .5, blurHorizontalSize: .7, blurVerticalSize: .7 });
  glow.innerGlow = false; glow.outerGlow = true;
  const fillMaterial = new StandardMaterial('selection-area-fill', scene);
  fillMaterial.diffuseColor = color; fillMaterial.emissiveColor = color.scale(.4); fillMaterial.alpha = .23;
  fillMaterial.disableLighting = true; fillMaterial.zOffset = -2;
  const edgeMaterial = new StandardMaterial('selection-area-edge', scene);
  edgeMaterial.emissiveColor = color; edgeMaterial.disableLighting = true;
  const fill = MeshBuilder.CreateGround('selection-area', { width: 1, height: 1 }, scene);
  fill.material = fillMaterial; fill.isPickable = false; fill.setEnabled(false);
  const edges = Array.from({ length: 4 }, (_, i) => {
    const edge = MeshBuilder.CreateBox('selection-edge-' + i, { size: 1 }, scene);
    edge.material = edgeMaterial; edge.isPickable = false; edge.setEnabled(false); return edge;
  });
  type Entry = { shown: Mesh; original?: InstancedMesh };
  const selected = new Map<AbstractMesh, Entry>();
  function remove(mesh: AbstractMesh, entry: Entry) {
    if (!entry.shown.isDisposed()) {
      glow.removeMesh(entry.shown); entry.shown.renderOutline = false; entry.shown.renderOverlay = false;
      if (entry.original) { shadows.removeShadowCaster(entry.shown, false); entry.shown.dispose(); }
    }
    if (entry.original && !entry.original.isDisposed()) entry.original.setEnabled(true);
    selected.delete(mesh);
  }
  function update(meshes: AbstractMesh[], object?: WorldObject) {
    const wanted = new Set(meshes.filter(m => !m.isDisposed() && !((object?.kind === 'plot' || object?.kind === 'crop') && m.metadata?.worldObjectId === object.id && ['soil', 'grass'].includes(m.material?.name ?? ''))));
    for (const [mesh, entry] of selected) if (!wanted.has(mesh)) remove(mesh, entry);
    for (const mesh of wanted) {
      if (selected.has(mesh)) continue;
      let shown: Mesh, original: InstancedMesh | undefined;
      if (mesh instanceof InstancedMesh) {
        original = mesh; shown = mesh.sourceMesh.clone('selected-' + mesh.name, null, true)!;
        shown.position.copyFrom(mesh.position); shown.scaling.copyFrom(mesh.scaling); shown.rotation.copyFrom(mesh.rotation);
        shown.rotationQuaternion = mesh.rotationQuaternion?.clone() ?? null;
        shown.isVisible = true; shown.setEnabled(true); shown.metadata = { ...mesh.metadata };
        shown.isPickable = true; mesh.setEnabled(false);
        if (shadows.getShadowMap()?.renderList?.includes(mesh)) shadows.addShadowCaster(shown, false);
      } else if (mesh instanceof Mesh) shown = mesh;
      else continue;
      shown.renderOutline = false; shown.outlineWidth = .035; shown.outlineColor = color;
      shown.renderOverlay = true; shown.overlayColor = color; shown.overlayAlpha = .06;
      glow.addMesh(shown, color); selected.set(mesh, { shown, original });
    }
    const area = !!object?.width && !!object?.depth;
    fill.setEnabled(area); edges.forEach(e => e.setEnabled(area));
    if (area && object) {
      const w = object.width!, d = object.depth!, y = object.markerY ?? .04;
      fill.position.set(object.x, y + .015, object.z); fill.scaling.set(w, 1, d);
      edges.forEach((e, i) => {
        e.scaling.set(i < 2 ? w : .07, .025, i < 2 ? .07 : d);
        e.position.set(object.x + (i < 2 ? 0 : (i === 2 ? -.5 : .5) * (w - .07)), y + .035,
          object.z + (i < 2 ? (i ? .5 : -.5) * (d - .07) : 0));
      });
    }
  }
  return { update, snapshot: () => ({ color: SELECTION_COLOR, meshes: selected.size, area: fill.isEnabled() }),
    dispose() { for (const [m, e] of selected) remove(m, e); glow.dispose(); fill.dispose(); edges.forEach(e => e.dispose()); fillMaterial.dispose(); edgeMaterial.dispose(); } };
}
