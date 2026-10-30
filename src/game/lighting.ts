import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import { Engine } from '@babylonjs/core/Engines/engine';

/** Shared by the single-asset review and the demo; no exposure/saturation filter. */
export function createDaylight(scene: Scene, mobile = false) {
  const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  sky.intensity = 0.82;
  sky.diffuse = Color3.FromHexString('#fffdf6');
  sky.groundColor = Color3.FromHexString('#dce5e0');
  // A lateral sun keeps ground shadows visible beside roofs and large heads.
  const sun = new DirectionalLight('sun', new Vector3(0.9, -1.3, 0.3), scene);
  sun.position.set(-18, 26, -6); sun.intensity = 0.42;
  sun.diffuse = Color3.FromHexString('#fff8ed');
  sun.autoCalcShadowZBounds = true;
  const shadows = new ShadowGenerator(mobile ? 1024 : 2048, sun);
  // Large exponential blur erased small characters' contact shadows. PCF
  // preserves their shape; WebGL 1 uses Babylon's supported Poisson fallback.
  const engine = scene.getEngine();
  if (engine instanceof Engine && engine.webGLVersion > 1) {
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  } else shadows.usePoissonSampling = true;
  shadows.bias = 0.0005; shadows.normalBias = 0.02;
  shadows.setDarkness(0.18);
  return shadows;
}
