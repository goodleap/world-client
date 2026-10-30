import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import studioUrl from '../assets/lighting/studio.env?url';

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
        metalEnvironment ??= CubeTexture.CreateFromPrefilteredData(studioUrl, scene);
        material.reflectionTexture = metalEnvironment;
        material.environmentIntensity = .45;
      }
    }
  };
}
