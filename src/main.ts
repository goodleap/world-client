import './style.css';
import { createLauncher, nextPaint } from './launcher.ts';
import type { GameUI } from './ui.ts';
import type { Game } from './game/game.ts';

declare global {
  interface Window { __DEMO__?: { snapshot: Game['snapshot'] } }
}

const launcher = createLauncher();
let ui: GameUI | undefined;
let game: Game | undefined;
let disposed = false;
let makeUI: typeof import('./ui.ts')['createUI'];

function leave(destination: 'menu' | 'exit') {
  if (!game || !ui) return;
  if (!game.save()) { ui.saveFailed(); return; }
  game.dispose(); ui.dispose(); game = undefined; ui = undefined; delete window.__DEMO__;
  const page = document.querySelector<HTMLElement>('#game-page')!;
  page.hidden = true; page.inert = true; page.replaceChildren();
  const menu = () => launcher.menu(() => { void start(makeUI); }, true);
  if (destination === 'exit') launcher.exit(menu);
  else menu();
}

async function boot() {
  try {
    launcher.report(25, '正在准备界面…');
    const { createUI } = await import('./ui.ts');
    makeUI = createUI;
    launcher.report(75, '正在准备文字与按钮…');
    await document.fonts.ready;
    if (disposed) return;
    launcher.report(100, '界面已准备好');
    await nextPaint();
    launcher.menu(() => { void start(createUI); });
  } catch (error) {
    console.error('Unable to prepare the menu:', error);
    launcher.error();
  }
}
async function start(createUI: typeof import('./ui.ts')['createUI']) {
  try {
    launcher.beginGame();
    await nextPaint();
    const { createGame } = await import('./game/game.ts');
    if (disposed) return;
    launcher.report(8, '正在布置家园…');
    const page = document.querySelector<HTMLElement>('#game-page')!;
    page.hidden = false; page.inert = true;
    ui = createUI(page);
    ui.bindLeave(leave);
    game = await createGame(ui, launcher.report);
    if (disposed) { game.dispose(); return; }
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
      window.__DEMO__ = { snapshot: game.snapshot };
    }
    page.inert = false;
    launcher.ready(); ui.ready();
  } catch (error) {
    console.error('Unable to initialize the game:', error);
    launcher.error();
  }
}
void boot();
function dispose() { disposed = true; game?.dispose(); ui?.dispose(); launcher.dispose(); delete window.__DEMO__; }
if (import.meta.hot) import.meta.hot.dispose(dispose);
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
