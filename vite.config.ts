import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    rolldownOptions: { output: { codeSplitting: { groups: [
      // Keep Vite's shared import helper outside the engine chunk, otherwise
      // the small boot entry imports the whole 3D engine before the menu appears.
      { name: 'engine', test: /node_modules\/@babylonjs/, includeDependenciesRecursively: false },
    ] } } },
  },
});
