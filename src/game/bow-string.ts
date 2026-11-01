import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import anchors from '../../studies/characters/bow-string.json';

/** Three-point string follows the authored hand bones. The drawn arrow is a
 * visual only; Combat owns projectile release/damage. One updatable native line
 * mesh replaces the rigid string only while drawing the shared BowShot clip. */
export function createBowString(scene: Scene, right: TransformNode, left: TransformNode) {
  const topLocal = Vector3.FromArray(anchors.rightHandTop), bottomLocal = Vector3.FromArray(anchors.rightHandBottom);
  const points = [new Vector3(), new Vector3(), new Vector3()];
  const string = MeshBuilder.CreateLines('drawn-bow-string', { points, updatable: true }, scene);
  string.color = Color3.FromHexString('#e5d6b3'); string.isPickable = false; string.setEnabled(false);
  const arrowPoints = [new Vector3(), new Vector3()];
  const arrow = MeshBuilder.CreateLines('nocked-arrow', { points: arrowPoints, updatable: true }, scene);
  arrow.color = Color3.FromHexString('#66472c'); arrow.isPickable = false; arrow.setEnabled(false);
  return { update(phase?: number) {
    const active = phase !== undefined && phase >= .2 && phase < .58;
    string.setEnabled(active); arrow.setEnabled(active);
    if (!active) return false;
    right.computeWorldMatrix(true); left.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(topLocal, right.getWorldMatrix(), points[0]);
    Vector3.TransformCoordinatesToRef(bottomLocal, right.getWorldMatrix(), points[2]);
    points[1].copyFrom(left.getAbsolutePosition());
    MeshBuilder.CreateLines('drawn-bow-string', { points, instance: string });
    arrowPoints[0].copyFrom(points[1]);
    const grip = right.getAbsolutePosition();
    arrowPoints[1].copyFrom(grip).addInPlace(grip.subtract(points[1]).normalize().scale(.45));
    MeshBuilder.CreateLines('nocked-arrow', { points: arrowPoints, instance: arrow });
    return true;
  } };
}
