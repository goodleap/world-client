export type ReportProgress = (percent: number, description: string) => void;

/** Each phase starts at zero; progress advances only when real work reports it. */
export function createLauncher() {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const screen = get('loading');
  const panel = get('loading-panel');
  const menu = get('menu-panel');
  const exit = get('exit-panel');
  const progress = get<HTMLProgressElement>('loading-progress');
  const start = get<HTMLButtonElement>('start-game');
  const abort = new AbortController();
  let percent = 0;
  const report: ReportProgress = (value, description) => {
    percent = Math.max(percent, Math.min(100, Math.floor(value)));
    progress.value = percent;
    progress.textContent = `${percent}%`;
    get('loading-percent').textContent = `${percent}%`;
    get('loading-description').textContent = description;
  };
  get('retry-loading').addEventListener('click', () => location.reload(), { signal: abort.signal });
  return {
    report,
    menu(onStart: () => void, returning = false) {
      screen.className = 'loading menu-screen'; screen.dataset.phase = 'menu';
      panel.hidden = true; exit.hidden = true; menu.hidden = false;
      start.disabled = false; start.textContent = returning ? '继续游戏' : '开始游戏';
      start.addEventListener('click', () => {
        if (start.disabled) return;
        start.disabled = true; onStart();
      }, { once: true, signal: abort.signal });
      start.focus({ preventScroll: true });
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
    dispose() { abort.abort(); },
  };
}

export const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
