import { loadingProgress, byteLabel } from './loading-progress.ts';
import { copyDiagnostics, diagnosticContext } from './diagnostics.ts';
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
  loadingProgress.register('engine', '游戏引擎与代码准备');
  const details = document.createElement('details');
  details.id = 'loading-details';
  details.innerHTML = '<summary>加载详情与诊断</summary><ol id="loading-items"></ol><button id="copy-loading" class="primary-button">复制加载诊断</button><p id="copy-loading-status" role="status"></p>';
  screen.querySelector('.launch-content')!.append(details);
  const status = document.createElement('p'); status.id = 'loading-status'; status.setAttribute('role', 'status');
  details.querySelector('summary')!.after(status);
  const rows = new Map<string, HTMLLIElement>();
  const renderDetails = () => {
    if (screen.dataset.phase === 'playing' || screen.dataset.phase === 'exited') return;
    const items = loadingProgress.snapshot();
    const active = items.filter(item => item.state === 'working');
    const stalled = active.filter(item => item.idleMs >= 10000);
    const failed = items.filter(item => item.state === 'failed');
    const waiting = stalled.filter(item => item.kind === 'download');
    status.textContent = stalled.length ? `仍在等待：${(waiting.length ? waiting : stalled).map(item => item.name).join('、')}；${Math.floor(Math.max(...stalled.map(item => item.idleMs)) / 1000)} 秒没有新进展报告，可继续等待、复制诊断或重新加载。`
      : active.length ? `进行中：${active.map(item => item.name).join('、')}` : failed.length ? `未完成：${failed.map(item => item.name).join('、')}`
        : screen.dataset.phase === 'menu' ? '预加载已完成，开始游戏后处理模型与场景。' : '等待下一阶段…';
    get('retry-loading').hidden = screen.dataset.phase !== 'error' && !stalled.length;
    for (const item of items) {
      let row = rows.get(item.id);
      if (!row) { row = document.createElement('li'); rows.set(item.id, row); get('loading-items').append(row); }
      row.dataset.state = item.state;
      const state = { waiting: '等待', working: item.kind === 'download' ? '下载中' : '处理中', done: '完成', failed: '失败' }[item.state];
      const bytes = item.kind === 'download' ? item.request && item.loaded === undefined
        ? ` · ${item.state === 'working' ? '字节进度未知' : '大小未知'}` : ` · ${byteLabel(item.loaded ?? 0)} / ${byteLabel(item.total)}` : '';
      row.textContent = `${item.name}\n${state}${bytes} · ${(item.elapsedMs / 1000).toFixed(1)} 秒${item.state === 'working' ? ` · ${(item.idleMs / 1000).toFixed(1)} 秒未更新` : ''}${item.note ? `\n${item.note}` : ''}${item.error ? `\n${item.error}` : ''}`;
    }
  };
  const ticker = setInterval(renderDetails, 500);
  get('copy-loading').addEventListener('click', async () => {
    const ok = await copyDiagnostics(JSON.stringify({ ...diagnosticContext(), phase: screen.dataset.phase, loading: loadingProgress.snapshot() }, null, 2), details);
    get('copy-loading-status').textContent = ok ? '加载诊断已复制' : '复制失败，请允许剪贴板访问后重试';
  }, { signal: abort.signal });
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
      details.open = false; renderDetails();
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
      details.open = false;
      percent = 0;
      screen.className = 'loading game-loading'; screen.dataset.phase = 'game-loading';
      menu.hidden = true; exit.hidden = true; panel.hidden = false;
      get('loading-meter').hidden = false; get('retry-loading').hidden = true;
      get('loading-title').textContent = '正在走进家园';
      get('loading-stage').textContent = '游戏资源加载';
      progress.setAttribute('aria-label', '游戏资源加载进度');
      report(0, '正在下载并准备游戏代码…');
    },
    ready() {
      report(100, '家园已准备好');
      screen.dataset.phase = 'playing'; screen.classList.add('loaded');
    },
    error(error: unknown) {
      for (const item of loadingProgress.items.values()) if (item.kind === 'stage' && item.state === 'working') loadingProgress.fail(item.id, error);
      screen.dataset.phase = 'error'; panel.hidden = false; menu.hidden = true;
      get('loading-title').textContent = '暂时无法打开家园';
      get('loading-description').textContent = error instanceof Error ? error.message : String(error);
      loadingProgress.begin('failure', '游戏启动'); loadingProgress.fail('failure', error);
      details.open = true; renderDetails();
      get('loading-meter').hidden = true;
      get('retry-loading').hidden = false;
      get('retry-loading').focus({ preventScroll: true });
    },
    dispose() { clearInterval(ticker); abort.abort(); confirmation.close(); },
  };
}

export const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
