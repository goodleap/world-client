import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

export interface WorldObject {
  id: string;
  kind: 'building' | 'tree' | 'crop' | 'scenery' | 'plot' | 'rock' | 'site' | 'goods';
  name: string;
  x: number; z: number; radius: number;
  width?: number; depth?: number; markerY?: number;
  anchor: { x: number; y: number; z: number };
}
export interface FaceRange { start: number; end: number; id: string }

/** Trees/resources retain triangle identity through native material batching.
 * Buildings and characters use their own simple picking volumes. */
export function selectionRanges(meshes: readonly AbstractMesh[]): FaceRange[] {
  const ranges: FaceRange[] = [];
  let offset = 0;
  for (const mesh of meshes) {
    const end = offset + mesh.getTotalIndices() / 3;
    const id = mesh.metadata?.worldObjectId as string | undefined;
    if (id) {
      const previous = ranges.at(-1);
      if (previous?.id === id && previous.end === offset) previous.end = end;
      else ranges.push({ start: offset, end, id });
    }
    offset = end;
  }
  return ranges;
}

export function objectAtFace(ranges: readonly FaceRange[], faceId: number): string | undefined {
  if (!Number.isInteger(faceId) || faceId < 0) return;
  return ranges.find(range => faceId >= range.start && faceId < range.end)?.id;
}

/** Native LOD meshes share labels but are render-only. A custom picking
 * predicate must retain Babylon's enabled/visible/pickable checks. */
export function isWorldPickable(mesh:AbstractMesh){
  return mesh.isPickable&&mesh.isVisible&&mesh.isEnabled()&&(mesh.metadata?.selectionKind==='resident'||!!mesh.metadata?.worldObjectId||!!mesh.metadata?.worldFaceRanges?.length);
}
