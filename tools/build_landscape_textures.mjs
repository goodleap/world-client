// Export the five original DynamicTexture canvases with inspect_render_scene
// on the baseline (or ?proceduralTextures=1), then run this offline encoder.
import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { texturePaintKey } from '../src/game/texture-paint-key.ts';

const source = process.argv[2], basisu = process.argv[3];
if (!source || !basisu) throw new Error('Usage: node tools/build_landscape_textures.mjs <export directory> <basisu executable>');
const output = 'public/terrain', vendor = 'public/vendor/ktx2-9.32.1';
await mkdir(output, { recursive: true }); await mkdir(vendor, { recursive: true });
await build({ entryPoints: ['node_modules/@babylonjs/ktx2decoder/index.js'], bundle: true, format: 'iife', globalName: 'KTX2DECODER', minify: true, outfile: `${vendor}/decoder.js`, legalComments: 'eof' });
for (const file of await readdir('node_modules/@babylonjs/ktx2decoder/wasm')) await copyFile(`node_modules/@babylonjs/ktx2decoder/wasm/${file}`, `${vendor}/${file}`);
await copyFile('node_modules/@babylonjs/ktx2decoder/license.md', `${vendor}/decoder-license.md`);
await copyFile('node_modules/@babylonjs/ktx2decoder/NOTICE.md', `${vendor}/NOTICE.md`);
// Preserve upstream license text, using the repository's LF / whitespace format.
for (const name of ['decoder-license.md', 'license.md', 'NOTICE.md']) {
  const text = await readFile(`${vendor}/${name}`, 'utf8');
  await writeFile(`${vendor}/${name}`, text.replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, ''));
}
const names = ['woodland-ground-colors', 'woodland-meadow-strokes', 'woodland-road-grain', 'woodland-canopy-leaves', 'woodland-water-ripples'];
for (const name of names) {
  await copyFile(`${source}/${name}.png`, `${output}/${name}.png`);
  const result = spawnSync(basisu, ['-file', `${source}/${name}.png`, '-output_file', `${output}/${name}.ktx2`, '-ktx2', '-uastc', '-uastc_level', '3', '-mipmap', '-mip_filter', 'box', '-mip_linear', '-y_flip', '-max_threads', '2'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr + result.stdout);
  console.log(`Encoded ${name}`);
}
await writeFile('src/game/texture-manifest.json', JSON.stringify({ paintKey: texturePaintKey(), names, encoder: 'Basis Universal 1.16.4; UASTC level 3; box/linear mipmaps; vertical flip' }, null, 2) + '\n');
