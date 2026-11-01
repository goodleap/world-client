const SHADOWS_KEY = 'world-shadows-enabled';
const LIGHTING_KEY = 'world-lighting';

export interface LightingSettings {
  environment: number;
  sunlight: number;
  sunColor: string;
}
export const DEFAULT_LIGHTING: Readonly<LightingSettings> = {
  environment: .72, sunlight: .56, sunColor: '#fff4e2',
};
export function normalizeLighting(value: Partial<LightingSettings>): LightingSettings {
  const strength = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n)
    ? Math.max(0, Math.min(2, n)) : fallback;
  return {
    environment: strength(value.environment, DEFAULT_LIGHTING.environment),
    sunlight: strength(value.sunlight, DEFAULT_LIGHTING.sunlight),
    sunColor: typeof value.sunColor === 'string' && /^#[\da-f]{6}$/i.test(value.sunColor)
      ? value.sunColor.toLowerCase() : DEFAULT_LIGHTING.sunColor,
  };
}
export function readLighting(): LightingSettings {
  try { return normalizeLighting(JSON.parse(localStorage.getItem(LIGHTING_KEY) ?? '{}') ?? {}); }
  catch { return { ...DEFAULT_LIGHTING }; }
}
export function saveLighting(settings: LightingSettings) {
  try { localStorage.setItem(LIGHTING_KEY, JSON.stringify(normalizeLighting(settings))); return true; }
  catch { return false; }
}

/** Device preference, independent of a saved village or starting a new game. */
export function readShadowsEnabled() {
  try { return localStorage.getItem(SHADOWS_KEY) !== 'false'; }
  catch { return true; }
}

export function saveShadowsEnabled(enabled: boolean) {
  try { localStorage.setItem(SHADOWS_KEY, String(enabled)); return true; }
  catch { return false; }
}
