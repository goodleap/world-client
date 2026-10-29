import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { Scene } from '@babylonjs/core/scene';

/** Shared by the single-asset review and the demo; no exposure/saturation filter. */
export function createDaylight(scene: Scene) {
  const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  sky.intensity = 0.82;
  sky.diffuse = Color3.FromHexString('#fffdf6');
  sky.groundColor = Color3.FromHexString('#dce5e0');
  const sun = new DirectionalLight('sun', new Vector3(0.5, -1.3, 0.7), scene);
  sun.position.set(-12, 24, -14); sun.intensity = 0.42;
  sun.diffuse = Color3.FromHexString('#fff8ed');
  sun.autoCalcShadowZBounds = true;
  const shadows = new ShadowGenerator(2048, sun);
  shadows.useBlurExponentialShadowMap = true;
  shadows.useKernelBlur = true;
  shadows.blurKernel = 48;
  shadows.depthScale = 40;
  shadows.bias = 0.001; shadows.normalBias = 0.035;
  shadows.setDarkness(0.12);
  return shadows;
}
