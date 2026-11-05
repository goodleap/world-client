/** Vite defaults to the map workshop during this development phase. The
 * standard opening remains available with VITE_MAP_DEVELOPMENT=false. */
export const MAP_DEVELOPMENT = (import.meta.env ? (import.meta.env.VITE_MAP_DEVELOPMENT ?? 'true')
  : (typeof process !== 'undefined' ? process.env.VITE_MAP_DEVELOPMENT : undefined)) === 'true';
export const OPENING_PROFILE = MAP_DEVELOPMENT ? 'map-development' : 'standard';
