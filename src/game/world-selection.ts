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

/** MergeMeshes preserves source triangle order; keep logical object identity
 * alongside the material batches without adding invisible picking volumes. */
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
