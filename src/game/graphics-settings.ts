const SHADOWS_KEY = 'world-shadows-enabled';

/** Device preference, independent of a saved village or starting a new game. */
export function readShadowsEnabled() {
  try { return localStorage.getItem(SHADOWS_KEY) !== 'false'; }
  catch { return true; }
}

export function saveShadowsEnabled(enabled: boolean) {
  try { localStorage.setItem(SHADOWS_KEY, String(enabled)); return true; }
  catch { return false; }
}
