import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { createShadowCasterFilter } from './shadow-culling.ts';

/** A 1024px map shadow covers the village, not the zoomed-in phone viewport.
 * Use Babylon's independent LOD camera to reuse the existing map geometry for
 * that pass. Main-camera geometry is untouched; model previews retain full LOD. */
export function createMapShadowLOD(scene: Scene, shadows: ShadowGenerator, mainCamera: Camera) {
  const lodCamera = new Camera('map-shadow-lod', Vector3.Zero(), scene, false);
  lodCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  lodCamera.orthoLeft = -16; lodCamera.orthoRight = 16;
  lodCamera.orthoTop = 16; lodCamera.orthoBottom = -16;
  const filter = createShadowCasterFilter(shadows.getLight().getShadowDirection());
  const planes = Frustum.GetPlanes(mainCamera.getTransformationMatrix());
  return (preview = false) => {
    const map = shadows.getShadowMap();
    if (map) {
      map.cameraForLOD = preview ? mainCamera : lodCamera;
      map.getCustomRenderList = preview ? null : (_pass, list, length) => {
        if (!list) return null;
        Frustum.GetPlanesToRef(mainCamera.getTransformationMatrix(), planes);
        return filter(list, length, planes);
      };
    }
  };
}

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
