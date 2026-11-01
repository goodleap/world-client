import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { bumpFragment } from '@babylonjs/core/Shaders/ShadersInclude/bumpFragment.js';

const bumpInclude = '!' + bumpFragment.shader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** StandardMaterial enables SPECULARTERM from lights, even when a matte
 * surface multiplies the result by black. Keep Babylon lighting/shadows,
 * and compile that zero-contribution term out only for opaque matte surfaces. */
export class MatteMaterialPlugin extends MaterialPluginBase {
  constructor(private readonly surface: StandardMaterial) {
    super(surface, 'MatteLighting', 210, { COLOR_DETAIL_ONLY: false }, true, true);
  }
  override prepareDefines(defines: MaterialDefines) {
    const material = this.surface;
    if (material.alpha === 1 && !material.specularTexture && material.specularColor.equalsFloats(0, 0, 0)) {
      (defines as MaterialDefines & { SPECULARTERM: boolean }).SPECULARTERM = false;
    }
    const d = defines as MaterialDefines & { COLOR_DETAIL_ONLY: boolean; DETAIL: boolean; BUMP: boolean; PARALLAX: boolean };
    d.COLOR_DETAIL_ONLY = !!d.DETAIL && !d.BUMP && !d.PARALLAX && material.detailMap.bumpLevel === 0;
  }
  override getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    // Babylon 9.32.1's detail include reconstructs normals/TBN even at zero
    // bump strength. Retain its color sample and UV offset, bypass just those
    // calculations; every other material uses the unchanged native include.
    return { [bumpInclude]: '#ifdef COLOR_DETAIL_ONLY\nvec2 uvOffset=vec2(0.0);\nvec4 detailColor=texture2D(detailSampler,vDetailUV);\n#else\n$0\n#endif' };
  }
}

export function installMatteMaterials(scene: Scene) {
  const attach = (material: unknown) => {
    if (material instanceof StandardMaterial && !material.pluginManager?.getPlugin('MatteLighting')) new MatteMaterialPlugin(material);
  };
  scene.materials.forEach(attach);
  scene.onNewMaterialAddedObservable.add(attach);
}
