import './style.css';
import { createLauncher, nextPaint } from './launcher.ts';
import type { GameUI } from './ui.ts';
import type { Game } from './game/game.ts';
import { Economy } from './game/economy.ts';
import { readSavedGame } from './game/economy-storage.ts';
import type { StartMode } from './launcher.ts';
import { diagnosticContext } from './diagnostics.ts';
import { loadingProgress } from './loading-progress.ts';
import { trackModuleLoading } from './module-loading.ts';

declare global {
  interface Window { __DEMO__?: { snapshot: Game['snapshot'] } }
}

const stopModuleTracking = trackModuleLoading();
const launcher = createLauncher();
let ui: GameUI | undefined;
let game: Game | undefined;
let disposed = false;
let makeUI: typeof import('./ui.ts')['createUI'];
let gameModule: Promise<typeof import('./game/game.ts')> | undefined;
function prepareGame() {
  return gameModule ??= loadingProgress.run('engine', '游戏引擎与代码准备', () => {
    loadingProgress.items.get('engine')!.note = '等待代码文件下载、解析与初始化；此阶段尚未开始模型处理。';
    return import('./game/game.ts');
  })
    .then(module => { loadingProgress.items.get('engine')!.note = '引擎与游戏代码已准备好；模型与场景处理另列。'; return module; })
    .catch(error => { gameModule = undefined; throw error; });
}
function menu() {
  launcher.menu(mode => { void start(makeUI, mode); }, readSavedGame().status);
  // Load code and GLBs after the menu is visible; no engine, scene or simulation
  // runs until Start. Entry shares these promises even while downloads continue.
  void nextPaint().then(() => disposed ? undefined : prepareGame().then(module => module.preloadGameAssets())).catch(() => {});
}

function leave(destination: 'menu' | 'exit') {
  if (!game || !ui) return;
  if (!game.save()) { ui.saveFailed(); return; }
  game.dispose(); ui.dispose(); game = undefined; ui = undefined; delete window.__DEMO__;
  const page = document.querySelector<HTMLElement>('#game-page')!;
  page.hidden = true; page.inert = true; page.replaceChildren();
  if (destination === 'exit') launcher.exit(menu);
  else menu();
}

async function boot() {
  try {
    launcher.report(25, '正在准备界面…');
    const { createUI } = await loadingProgress.run('ui', '基础界面代码', () => import('./ui.ts'));
    makeUI = createUI;
    launcher.report(75, '正在准备文字与按钮…');
    await loadingProgress.run('fonts', '文字与按钮准备', () => document.fonts.ready);
    if (disposed) return;
    launcher.report(100, '界面已准备好');
    await nextPaint();
    menu();
  } catch (error) {
    console.error('Unable to prepare the menu:', error);
    launcher.error(error);
  }
}
async function start(createUI: typeof import('./ui.ts')['createUI'], mode: StartMode) {
  try {
    // Re-read when Continue is clicked, in case another tab changed the save.
    const saved = mode === 'continue' ? readSavedGame() : undefined;
    if (saved && saved.status !== 'ready') { menu(); return; }
    const economy = saved?.status === 'ready' ? saved.economy : new Economy();
    launcher.beginGame();
    await nextPaint();
    const { createGame } = await prepareGame();
    if (disposed) return;
    launcher.report(8, '正在布置家园…');
    const page = document.querySelector<HTMLElement>('#game-page')!;
    page.hidden = false; page.inert = true;
    ui = createUI(page);
    ui.bindLeave(leave);
    game = await createGame(ui, launcher.report, economy);
    ui.bindPerformanceRecord(game.markPerformance);
    ui.bindDiagnostics(() => {
      const state = game?.snapshot();
      return { ...diagnosticContext(), loading: loadingProgress.snapshot(), performance: game?.performanceReport(), rendering: state?.rendering,
        size: state?.size, camera: state?.camera, shadows: state?.shadows, frames: state?.frames, suspended: state?.suspended };
    });
    if (disposed) { game.dispose(); return; }
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
      window.__DEMO__ = { snapshot: game.snapshot };
    }
    page.inert = false;
    launcher.ready(); ui.ready(); game.save();
  } catch (error) {
    console.error('Unable to initialize the game:', error);
    launcher.error(error);
  }
}
void boot();
function dispose() { disposed = true; game?.dispose(); ui?.dispose(); launcher.dispose(); stopModuleTracking(); delete window.__DEMO__; }
if (import.meta.hot) import.meta.hot.dispose(dispose);
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
