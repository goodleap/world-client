import { defineConfig } from 'vite';
import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let buildId = 'unknown';
try { buildId = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* source archives */ }

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(buildId), __MODEL_BYTES__: JSON.stringify(Object.fromEntries(['characters/characters', 'characters/characters-lod', 'characters/characters-far-lod', 'wolf/wolf', 'dog/dog']
    .map(path => [path.split('/').pop(), statSync(new URL(`./studies/${path}.glb`, import.meta.url)).size]))) },
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    rolldownOptions: { output: { codeSplitting: { groups: [
      // Placement rules also run while inspecting a save before the menu opens.
      // Keep their native curve/math dependencies separate from the 3D engine.
      { name: 'map-layout', test: /src\/game\/road-layout\.ts$/, priority: 20, includeDependenciesRecursively: true },
      // Keep Vite's shared import helper outside the engine chunk, otherwise
      // the small boot entry imports the whole 3D engine before the menu appears.
      { name: 'engine', test: /node_modules\/@babylonjs/, includeDependenciesRecursively: false },
    ] } } },
  },
});
