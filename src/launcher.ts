export type ReportProgress = (percent: number, description: string) => void;
export type StartMode = 'new' | 'continue';
type SaveStatus = 'ready' | 'empty' | 'invalid' | 'unavailable';

/** Each phase starts at zero; progress advances only when real work reports it. */
export function createLauncher() {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const screen = get('loading');
  const panel = get('loading-panel');
  const menu = get('menu-panel');
  const exit = get('exit-panel');
  const progress = get<HTMLProgressElement>('loading-progress');
  const start = get<HTMLButtonElement>('start-game');
  const resume = get<HTMLButtonElement>('continue-save');
  const confirmation = get<HTMLDialogElement>('new-game-dialog');
  const abort = new AbortController();
  let onStart: (mode: StartMode) => void = () => {};
  let confirmNew = false;
  let percent = 0;
  const report: ReportProgress = (value, description) => {
    percent = Math.max(percent, Math.min(100, Math.floor(value)));
    progress.value = percent;
    progress.textContent = `${percent}%`;
    get('loading-percent').textContent = `${percent}%`;
    get('loading-description').textContent = description;
  };
  get('retry-loading').addEventListener('click', () => location.reload(), { signal: abort.signal });
  const enter = (mode: StartMode) => {
    if (start.disabled || mode === 'continue' && resume.disabled) return;
    start.disabled = true; resume.disabled = true; onStart(mode);
  };
  start.addEventListener('click', () => {
    if (confirmNew) { confirmation.returnValue = ''; confirmation.showModal(); }
    else enter('new');
  }, { signal: abort.signal });
  resume.addEventListener('click', () => enter('continue'), { signal: abort.signal });
  confirmation.addEventListener('close', () => {
    if (confirmation.returnValue === 'new') enter('new');
  }, { signal: abort.signal });
  return {
    report,
    menu(startGame: (mode: StartMode) => void, saveStatus: SaveStatus) {
      screen.className = 'loading menu-screen'; screen.dataset.phase = 'menu';
      panel.hidden = true; exit.hidden = true; menu.hidden = false;
      onStart = startGame; confirmNew = saveStatus !== 'empty';
      start.disabled = false; resume.disabled = saveStatus !== 'ready';
      start.classList.toggle('secondary-button', saveStatus === 'ready');
      get('menu-save-status').textContent = {
        ready: '已有进度，继续照料你的家园。', empty: '暂无存档，开始建立你的家园。',
        invalid: '现有存档无法读取，原数据已保留。', unavailable: '浏览器暂时无法读取进度。',
      }[saveStatus];
      (saveStatus === 'ready' ? resume : start).focus({ preventScroll: true });
    },
    exit(onMenu: () => void) {
      screen.className = 'loading menu-screen'; screen.dataset.phase = 'exited';
      panel.hidden = true; menu.hidden = true; exit.hidden = false;
      const button = get('exit-to-menu');
      button.addEventListener('click', onMenu, { once: true, signal: abort.signal });
      button.focus({ preventScroll: true });
    },
    beginGame() {
      percent = 0;
      screen.className = 'loading game-loading'; screen.dataset.phase = 'game-loading';
      menu.hidden = true; exit.hidden = true; panel.hidden = false;
      get('loading-meter').hidden = false; get('retry-loading').hidden = true;
      get('loading-title').textContent = '正在走进家园';
      get('loading-stage').textContent = '游戏资源加载';
      progress.setAttribute('aria-label', '游戏资源加载进度');
      report(0, '正在准备地图…');
    },
    ready() {
      report(100, '家园已准备好');
      screen.dataset.phase = 'playing'; screen.classList.add('loaded');
    },
    error() {
      screen.dataset.phase = 'error'; panel.hidden = false; menu.hidden = true;
      get('loading-title').textContent = '暂时无法打开家园';
      get('loading-description').textContent = '请检查网络并重新加载。若仍无法进入，请使用支持 WebGL 的浏览器。';
      get('loading-meter').hidden = true;
      get('retry-loading').hidden = false;
      get('retry-loading').focus({ preventScroll: true });
    },
    dispose() { abort.abort(); confirmation.close(); },
  };
}

export const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
