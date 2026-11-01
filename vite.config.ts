import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
