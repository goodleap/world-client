// Developer-only quantitative review. No palette or parameter is written back
// into the game; results are candidates that still need visual review.
import { Engine, Scene, ArcRotateCamera, Vector3, Matrix, Color3, Color4, TransformNode, RenderTargetTexture, PBRMaterial, Mesh } from '@babylonjs/core';
import { createDaylight } from '../src/game/lighting';
import { createCharacterLibrary } from '../src/game/character-library';

type RGB = [number, number, number];
type Region = { name: string; imageRect: [number, number, number, number]; targetRGB: RGB };
type Target = { material: string; mesh: string; referenceBounds: [number, number, number, number]; regions: Region[] };
const engine = new Engine(document.querySelector<HTMLCanvasElement>('canvas')!, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(.961, .945, .91, 1);
const camera = new ArcRotateCamera('calibration', Math.PI / 2, Math.PI / 2, 4, new Vector3(0, .89, 0), scene);
camera.mode = 1; camera.minZ = .01;
camera.orthoTop = 1.05; camera.orthoBottom = -1.05;
camera.orthoRight = 1.05 * engine.getAspectRatio(camera); camera.orthoLeft = -camera.orthoRight;
createDaylight(scene);
const library = createCharacterLibrary(scene);
const actor = await library.instantiate('base', new TransformNode('calibration-actor', scene));
actor.walk.start(true); actor.walk.pause(); actor.walk.goToFrame(actor.walk.from);
await scene.whenReadyAsync();
scene.render();
const width = engine.getRenderWidth(), height = engine.getRenderHeight();
const target = new RenderTargetTexture('material-calibration', { width, height }, scene, false);
target.activeCamera = camera; target.clearColor = new Color4(0, 0, 0, 0);

const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const srgb = (v: number) => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
const lab = (rgb: RGB): RGB => {
  const [r, g, b] = rgb.map(v => linear(v / 255));
  const f = (v: number) => v > (6 / 29) ** 3 ? Math.cbrt(v) : v / (3 * (6 / 29) ** 2) + 4 / 29;
  const x = f((.4124564 * r + .3575761 * g + .1804375 * b) / .95047);
  const y = f(.2126729 * r + .7151522 * g + .072175 * b);
  const z = f((.0193339 * r + .119192 * g + .9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const deltaE = (a: RGB, b: RGB) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const hex = (rgb: RGB) => '#' + rgb.map(c => Math.round(clamp(srgb(c)) * 255).toString(16).padStart(2, '0')).join('');
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function fit(input: Target) {
  const mesh = actor.meshes.find(mesh => mesh.name === input.mesh);
  if (!(mesh instanceof Mesh) || !(mesh.material instanceof PBRMaterial) || mesh.material.name !== input.material) {
    throw new Error(`Material/mesh correspondence missing: ${input.mesh}`);
  }
  const material = mesh.material;
  const original = material.albedoColor.clone();
  target.renderList = [mesh];
  mesh.computeWorldMatrix(true);
  const viewport = camera.viewport.toGlobal(width, height);
  const bounds = mesh.getBoundingInfo().boundingBox.vectorsWorld.map(point => Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(), viewport));
  const left = Math.min(...bounds.map(p => p.x)), top = Math.min(...bounds.map(p => p.y));
  const w = Math.max(...bounds.map(p => p.x)) - left, h = Math.max(...bounds.map(p => p.y)) - top;
  const [rx, ry, rw, rh] = input.referenceBounds;
  const regions = input.regions.map(region => {
    const [x, y, width, height] = region.imageRect;
    return { ...region, renderRect: [Math.round(left + (x - rx) / rw * w), Math.round(top + (y - ry) / rh * h),
      Math.max(2, Math.round(width / rw * w)), Math.max(2, Math.round(height / rh * h))] };
  });
  let evaluations = 0;
  const measure = async (albedo: RGB) => {
    material.albedoColor.set(...albedo);
    target.render();
    const pixels = await target.readPixels();
    if (!(pixels instanceof Uint8Array)) throw new Error('Expected native RGBA8 readback');
    evaluations++;
    const samples = regions.map(region => {
      const [x, y, w, h] = region.renderRect;
      const channels: [number[], number[], number[]] = [[], [], []];
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
        if (i < 0 || j < 0 || i >= width || j >= height) continue;
        const index = ((height - 1 - j) * width + i) * 4;
        if (pixels[index + 3] < 250) continue;
        for (let c = 0; c < 3; c++) channels[c].push(pixels[index + c]);
      }
      if (channels[0].length < .8 * w * h) throw new Error(`ROI intersects silhouette/background: ${region.name}`);
      const rgb = channels.map(median) as RGB;
      return { name: region.name, rgb, deltaE76: deltaE(rgb, region.targetRGB), pixels: channels[0].length };
    });
    return { albedo: [...albedo] as RGB, samples, error: samples.reduce((sum, s) => sum + s.deltaE76, 0) / samples.length };
  };
  try {
    const baseline = await measure(original.asArray() as RGB);
    const middle = Math.floor(input.regions.length / 2);
    const estimate = original.asArray().map((c, i) => clamp(c * linear(input.regions[middle].targetRGB[i] / 255)
      / Math.max(.001, linear(baseline.samples[middle].rgb[i] / 255)))) as RGB;
    const seed = await measure(estimate);
    let best = seed.error < baseline.error ? seed : baseline;
    // Small bounded coordinate search through the actual PBR renderer. This
    // does not approximate the engine's BRDF or fit another custom shader.
    for (const step of [.128, .064, .032, .016, .008, .004]) for (let repeat = 0; repeat < 2; repeat++) {
      for (let channel = 0; channel < 3; channel++) for (const direction of [-1, 1]) {
        const candidate = [...best.albedo] as RGB;
        candidate[channel] = clamp(candidate[channel] + direction * step);
        if (candidate[channel] === best.albedo[channel]) continue;
        const measured = await measure(candidate);
        if (measured.error < best.error) best = measured;
      }
    }
    return { material: input.material, mesh: input.mesh, regions, baseline, candidate: best,
      candidateAlbedoSRGB: hex(best.albedo), evaluations,
      parameterBoundary: best.albedo.some(c => c <= 0 || c >= 1),
      retained: { metallic: material.metallic, roughness: material.roughness, directIntensity: material.directIntensity, vertexColors: mesh.useVertexColors },
      interpretation: 'A bounded local candidate, not a unique inverse solution or an approved appearance. Residuals can come from lighting, normals/shape, material response, vertex colors or ROI correspondence.' };
  } finally { material.albedoColor.copyFrom(original); scene.render(); }
}

Object.assign(window, { calibration: {
  fit,
  describe: () => ({ engine: Engine.Version, renderer: engine.getGlInfo(), resolution: [width, height], camera: { alpha: camera.alpha, beta: camera.beta, target: camera.target.asArray(), orthoHeight: 2.1 },
    imageProcessing: { exposure: scene.imageProcessingConfiguration.exposure, contrast: scene.imageProcessingConfiguration.contrast,
      toneMapping: scene.imageProcessingConfiguration.toneMappingEnabled, applyByPostProcess: scene.imageProcessingConfiguration.applyByPostProcess },
    lights: scene.lights.map(light => ({ type: light.getClassName(), name: light.name, intensity: light.intensity, diffuse: light.diffuse.asArray(),
      direction: 'direction' in light ? (light.direction as Vector3).asArray() : undefined,
      groundColor: 'groundColor' in light ? (light.groundColor as Color3).asArray() : undefined })),
    method: 'Babylon RenderTargetTexture + native RGBA8 readPixels; D65 CIELAB DeltaE76 of region medians; linear albedo search. Daylight/PBR matches game configuration; isolated material with self-shadows disabled.' }),
  preview(candidates: { material: string; candidate: { albedo: RGB } }[]) {
    for (const row of candidates) {
      const material = actor.meshes.find(mesh => mesh.material?.name === row.material)?.material;
      if (material instanceof PBRMaterial) material.albedoColor.set(...row.candidate.albedo);
    }
    scene.render();
  },
} });
