import './style.css';
import { createUI } from './ui.ts';
import type { Game } from './game/game.ts';

declare global {
  interface Window { __DEMO__?: { snapshot: Game['snapshot'] } }
}

const ui = createUI(document.querySelector<HTMLElement>('#app')!);
let game: Game | undefined;
let disposed = false;

async function start() {
  try {
    const { createGame } = await import('./game/game.ts');
    game = await createGame(ui);
    if (disposed) { game.dispose(); return; }
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
      window.__DEMO__ = { snapshot: game.snapshot };
    }
  } catch (error) {
    console.error('Unable to initialize the game:', error);
    ui.error();
  }
}
void start();
function dispose() { disposed = true; game?.dispose(); ui.dispose(); delete window.__DEMO__; }
if (import.meta.hot) import.meta.hot.dispose(dispose);
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
