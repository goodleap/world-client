import { decodeEconomy } from './economy.ts';
import type { Economy } from './economy.ts';

export const ECONOMY_SAVE_KEY = 'world-basic-economy-v1';
export type SavedGame = { status: 'ready'; economy: Economy } | { status: 'empty' | 'invalid' | 'unavailable' };

/** Inspection never overwrites a missing, broken or unreadable save. */
export function readSavedGame(read: () => string | null = () => localStorage.getItem(ECONOMY_SAVE_KEY)): SavedGame {
  let text: string | null;
  try { text = read(); } catch { return { status: 'unavailable' }; }
  if (text === null) return { status: 'empty' };
  try { return { status: 'ready', economy: decodeEconomy(text) }; }
  catch { return { status: 'invalid' }; }
}
