import { LANDSCAPE, MAP_WIDTH, MAP_DEPTH, GRID_SIZE } from './world-data.ts';

// Increment when the authored paint algorithm/colors change. Map dimensions,
// seed and generated placements are hashed, so a new layout never reuses an
// old ground map. The original generators remain the fallback for new maps.
export function texturePaintKey() {
  // V8 builds can differ in the last bits of trig results. Canonicalize well
  // below a texel/world millimetre rather than fingerprinting floating noise.
  const data = JSON.stringify([8, MAP_WIDTH, MAP_DEPTH, GRID_SIZE, LANDSCAPE.seed, LANDSCAPE.regions, LANDSCAPE.trees, LANDSCAPE.rocks, LANDSCAPE.decorations, LANDSCAPE.geography.forms, LANDSCAPE.geography.forests, LANDSCAPE.waterAreas, LANDSCAPE.roadControls],
    (_key, value) => typeof value === 'number' ? Math.round(value * 10000) / 10000 : value);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
