import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';

/** StandardMaterial supplies lighting, shadows and detail sampling. Its native
 * detail strength is uniform; this plugin adds the static per-vertex road mask
 * and blends exposed soil/rock on one continuous opaque surface. No extra pass. */
export class TerrainMaterialPlugin extends MaterialPluginBase {
  constructor(material:StandardMaterial){super(material,'TerrainSurface',220,{},true,true);}
  override getAttributes(attributes:string[],_scene:Scene,_mesh:AbstractMesh){
    if(!attributes.includes('uv2'))attributes.push('uv2');
  }
  override getCustomCode(shaderType:string):Record<string,string>|null{
    if(shaderType==='vertex')return {
      CUSTOM_VERTEX_DEFINITIONS:'\n#ifndef UV2\nattribute vec2 uv2;\n#endif\nvarying vec2 vTerrainWeights;\n',
      // Native vColor forces alpha to 1 for an opaque mesh. Read the raw
      // blend weight separately so it never becomes transparency or opacity.
      CUSTOM_VERTEX_MAIN_END:'vTerrainWeights=vec2(uv2.x,color.a);',
    };
    if(shaderType==='fragment')return {
      CUSTOM_FRAGMENT_DEFINITIONS:'varying vec2 vTerrainWeights;',
      // Babylon 9.32.1: vertex RGB carries the rock/bank color, A its weight.
      '!baseColor\\.rgb\\*=vColor\\.rgb;':'baseColor.rgb=mix(baseColor.rgb,vColor.rgb,clamp(vTerrainWeights.y,0.0,1.0));',
      // Replace the whole statement: Babylon's shader processor drops a lone
      // semicolon left on the next line by expression-only code injection.
      '!baseColor\\.rgb=baseColor\\.rgb\\*2\\.0\\*mix\\(0\\.5,detailColor\\.r,vDetailInfos\\.y\\);':'baseColor.rgb*=2.0*mix(0.5,detailColor.r,vDetailInfos.y*clamp(vTerrainWeights.x,0.0,1.0));',
    };
    return null;
  }
}
