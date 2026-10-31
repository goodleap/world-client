import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import studioUrl from '../assets/lighting/studio.env?url';
import { loadingProgress } from '../loading-progress.ts';
loadingProgress.register(studioUrl, '金属环境纹理（studio.env）', 'download');

/** Shared by the game and asset review. A small prefiltered environment gives
 * metal broad reflections through Babylon's native PBR, without a skybox or
 * another render pass. Cotton, skin and the scenery keep their existing light. */
export function createCharacterMaterialSetup(scene: Scene) {
  let metalEnvironment: CubeTexture | undefined;
  return (materials: readonly (Material | null)[]) => {
    for (const material of new Set(materials)) {
      if (!(material instanceof PBRMaterial)) continue;
      const cotton = material.name === 'Warm ivory cotton' || material.name === 'Cotton hems';
      material.directIntensity = cotton ? 1 : 1.12;
      if ((material.metallic ?? 0) > 0) {
        if (!metalEnvironment) {
          loadingProgress.begin(studioUrl, '金属环境纹理（studio.env）', 'download');
          metalEnvironment = new CubeTexture(studioUrl, scene, { prefiltered: true,
            onLoad: () => {
              const entry = performance.getEntriesByName(new URL(studioUrl, location.href).href).at(-1) as PerformanceResourceTiming | undefined;
              if (entry?.encodedBodySize) loadingProgress.bytes(studioUrl, entry.encodedBodySize, entry.encodedBodySize);
              loadingProgress.done(studioUrl);
            },
            onError: (message) => loadingProgress.fail(studioUrl, new Error(message ?? '环境纹理加载失败')),
          });
        }
        material.reflectionTexture = metalEnvironment;
        material.environmentIntensity = .45;
      }
    }
  };
}
