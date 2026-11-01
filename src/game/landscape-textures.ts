import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { KhronosTextureContainer2 } from '@babylonjs/core/Misc/khronosTextureContainer2.js';
import type { Scene } from '@babylonjs/core/scene.js';
import manifest from './texture-manifest.json' with { type: 'json' };
import { texturePaintKey } from './texture-paint-key.ts';

const matchingPaint = manifest.paintKey === texturePaintKey();
let configured = false;
export function landscapeTexture(name: string, scene: Scene): Texture | undefined {
  if (typeof document === 'undefined' || !matchingPaint || !manifest.names.includes(name)
    || new URLSearchParams(location.search).has('proceduralTextures')) return;
  const asset = (path: string) => new URL(import.meta.env.BASE_URL + path, document.baseURI).href;
  if (!configured) {
    const vendor = 'vendor/ktx2-9.32.1/';
    Object.assign(KhronosTextureContainer2.URLConfig, {
      jsDecoderModule: asset(vendor + 'decoder.js'), wasmUASTCToASTC: asset(vendor + 'uastc_astc.wasm'),
      wasmUASTCToBC7: asset(vendor + 'uastc_bc7.wasm'), wasmUASTCToRGBA_UNORM: asset(vendor + 'uastc_rgba8_unorm_v2.wasm'),
      wasmUASTCToRGBA_SRGB: asset(vendor + 'uastc_rgba8_srgb_v2.wasm'), wasmUASTCToR8_UNORM: asset(vendor + 'uastc_r8_unorm.wasm'),
      wasmUASTCToRG8_UNORM: asset(vendor + 'uastc_rg8_unorm.wasm'), jsMSCTranscoder: asset(vendor + 'msc_basis_transcoder.js'),
      wasmMSCTranscoder: asset(vendor + 'msc_basis_transcoder.wasm'), wasmZSTDDecoder: asset(vendor + 'zstddec.wasm'),
    });
    KhronosTextureContainer2.DefaultNumWorkers = 1;
    configured = true;
  }
  const caps = scene.getEngine().getCaps(), compressed = !!(caps.astc || caps.bptc || caps.etc2);
  const png = asset(`terrain/${name}.png?v=${manifest.paintKey}`);
  let failed = false;
  const texture = new Texture(compressed ? asset(`terrain/${name}.ktx2?v=${manifest.paintKey}`) : png, scene, {
    noMipmap: false, invertY: true, samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
    onError: () => { if (compressed && !failed) { failed = true; texture.updateURL(png); } },
  });
  texture.name = name;
  return texture;
}
