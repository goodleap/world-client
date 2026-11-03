import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/** Interpolate between completed logic steps. A separate native parent supplies
 * only the visual offset: navigation, collision, commands and saves still read
 * the untouched authoritative root. Never extrapolate through an obstacle. */
export class RenderMotion {
  readonly position = new Vector3();
  readonly rotation = Quaternion.Identity();
  private readonly layer: TransformNode;
  private readonly previous = { position: new Vector3(), rotation: Quaternion.Identity() };
  private readonly current = { position: new Vector3(), rotation: Quaternion.Identity() };
  private readonly inverse = Quaternion.Identity();
  private readonly matrix = Matrix.Identity();
  private readonly rotated = new Vector3();
  private readonly root: TransformNode;
  constructor(root: TransformNode) {
    this.root = root;
    this.layer = new TransformNode(`${root.name}-render-motion`, root.getScene());
    this.layer.parent = root.parent; root.parent = this.layer;
    this.layer.rotationQuaternion = Quaternion.Identity(); this.reset();
  }
  private read() {
    this.current.position.copyFrom(this.root.position);
    if (this.root.rotationQuaternion) this.current.rotation.copyFrom(this.root.rotationQuaternion);
    else Quaternion.FromEulerVectorToRef(this.root.rotation, this.current.rotation);
  }
  beginStep() {
    this.previous.position.copyFrom(this.current.position); this.previous.rotation.copyFrom(this.current.rotation);
    this.layer.position.setAll(0); this.layer.rotationQuaternion!.set(0, 0, 0, 1);
  }
  endStep() { this.read(); }
  reset() {
    this.read(); this.beginStep(); this.position.copyFrom(this.current.position); this.rotation.copyFrom(this.current.rotation);
  }
  sample(alpha: number) {
    const x = this.position.x, y = this.position.y, z = this.position.z;
    Vector3.LerpToRef(this.previous.position, this.current.position, alpha, this.position);
    Quaternion.SlerpToRef(this.previous.rotation, this.current.rotation, alpha, this.rotation);
    this.current.rotation.conjugateToRef(this.inverse);
    this.rotation.multiplyToRef(this.inverse, this.layer.rotationQuaternion!);
    Matrix.FromQuaternionToRef(this.layer.rotationQuaternion!, this.matrix);
    Vector3.TransformCoordinatesToRef(this.current.position, this.matrix, this.rotated);
    this.position.subtractToRef(this.rotated, this.layer.position);
    return Math.hypot(this.position.x - x, this.position.y - y, this.position.z - z) > 1e-7;
  }
}

export function interpolateAngle(from: number, to: number, alpha: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * alpha;
}
export function interpolateCycle(from: number, to: number, alpha: number) {
  return (from + ((to - from + 1) % 1) * alpha) % 1;
}
