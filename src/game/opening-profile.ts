/** The map workshop is an explicit development override. Player modes use
 * the standard world, with their own saved setup and chapter state. */
export const MAP_DEVELOPMENT = (import.meta.env ? (import.meta.env.VITE_MAP_DEVELOPMENT ?? 'false')
  : (typeof process !== 'undefined' ? process.env.VITE_MAP_DEVELOPMENT : undefined)) === 'true';
export const OPENING_PROFILE = MAP_DEVELOPMENT ? 'map-development' : 'standard';
