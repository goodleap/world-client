import type { Landmark } from './game/world-data.ts';
import type { FrameSample } from './game/frame-metrics.ts';
import { copyDiagnostics, diagnosticContext } from './diagnostics.ts';

export interface SelectionAction { id: string; label: string; disabled?: boolean }
export interface SelectionDetails { name: string; kind: string; hint: string; actions?: SelectionAction[] }
export interface QueueRow { id: number; title: string; status: string; progress: number; reason: string; cancellable: boolean }

const icons = {
  home: '<path d="m3 11 9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  leaf: '<path d="M20 4C9 2 3 8 5 15s15 6 15-11ZM5 20 16 9"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  settings: '<path d="m10 3-.5 2-2 .9-1.9-.5-2 3.4L5 10v2l-1.4 1.2 2 3.5 1.9-.5 2 .9.5 2h4l.5-2 2-.9 1.9.5 2-3.5L19 12v-2l1.4-1.2-2-3.4-1.9.5-2-.9L14 3Z"/><circle cx="12" cy="11" r="3"/>',
};
function icon(name: keyof typeof icons) {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

export function createUI(app: HTMLElement) {
  app.innerHTML = `
    <canvas id="game" tabindex="0" aria-label="三维家园，点击选中人物、建筑、树木或作物，拖动地图，WASD 移动视角"></canvas>
    <div id="resident-labels" class="resident-labels" aria-label="家园居民"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="topbar">
      <div class="brand"><span class="brand-icon">${icon('home')}</span><div><h1>家园漫游</h1><p>A LITTLE PLACE TO GROW</p></div></div>
      <div class="weather">${icon('sun')}<span>初夏<span class="weather-divider">/</span>晴</span></div>
    </header>
    <button id="settings" class="settings-button icon-button" aria-label="设置" title="设置">${icon('settings')}</button>
    <aside id="performance" class="performance-hud" aria-label="性能信息" title="最近约半秒的平均帧率与每帧 CPU 处理耗时。CPU 统计游戏逻辑和渲染提交，不包含帧间等待或 GPU 执行时间。">
      <span>FPS <b id="fps-value">—</b></span><span>CPU <b id="cpu-value">—</b><small>ms/帧</small></span>
    </aside>
    <aside class="economy-bar" aria-label="家园资源">
      <div id="inventory" class="inventory"></div>
      <button id="queue-toggle" aria-expanded="false" aria-controls="queue-panel">作业 <b id="queue-count">0</b></button>
    </aside>
    <section id="queue-panel" class="queue-panel" aria-label="作业队列" hidden>
      <div class="queue-heading"><h2>作业队列</h2><button id="queue-close" aria-label="收起作业队列">${icon('close')}</button></div>
      <p class="queue-note">农民依次接取可执行的任务。缺少材料或暂时无法到达时，会先处理其他任务。</p>
      <ol id="queue-list"></ol>
    </section>
    <aside class="journey" aria-label="探索进度" hidden>
      <div class="eyebrow"><span class="status-dot"></span> 初到家园</div>
      <div class="journey-heading"><h2>沿着小路，走一走</h2><span id="progress-count">0<span> / 3</span></span></div>
      <p id="journey-message">去看看小屋、菜园与水井。</p>
      <div class="stops"><span data-stop="cottage">${icon('home')}小屋</span><span data-stop="garden">${icon('leaf')}菜园</span><span data-stop="well">${icon('compass')}水井</span></div>
      <div class="progress-track"><span id="progress-bar"></span></div>
    </aside>
    <nav class="view-controls" aria-label="视角控制">
      <button id="base-preview" class="icon-button" aria-label="查看基础人物" title="查看基础人物" aria-pressed="false">人</button>
      <button id="farmer-preview" class="icon-button" aria-label="查看农民模型" title="查看农民模型" aria-pressed="false">农</button>
      <button id="overview" class="icon-button" aria-label="查看全景" title="查看全景" aria-pressed="false">${icon('compass')}</button>
      <span class="control-divider"></span>
      <button id="zoom-in" class="icon-button" aria-label="放大" title="放大">${icon('plus')}</button>
      <button id="zoom-out" class="icon-button" aria-label="缩小" title="缩小">${icon('minus')}</button>
      <span class="control-divider"></span>
      <button id="reset" class="icon-button" aria-label="回到起点" title="回到起点">${icon('reset')}</button>
    </nav>
    <div class="north" aria-hidden="true"><span>N</span><i></i></div>
    <div id="landmark-prompt" class="landmark-prompt" hidden><button id="inspect"><span class="prompt-icon">${icon('leaf')}</span><span><small>发现一处小风景</small><strong id="nearby-name"></strong></span><span class="prompt-key">E</span>${icon('arrow')}</button></div>
    <footer class="bottom-bar"><div class="control-hint"><span class="desktop-hint"><span class="key-set"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span> 移动视角 <span class="hint-dot">·</span> 点击选中</span><span class="touch-hint"><span class="touch-dot"></span>拖动地图<span class="hint-dot">·</span>点击选中</span></div><button id="help" class="help-button" aria-label="操作说明">${icon('help')}<span>操作说明</span></button></footer>
    <div id="joystick" class="joystick" aria-hidden="true"><div class="joystick-axis"></div><div id="joystick-knob" class="joystick-knob"></div></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <section id="selection-card" class="selection-card" aria-label="对象操作" hidden><div id="selection-actions" class="selection-actions"></div></section>
    <section id="resident-selection" class="resident-selection" aria-label="当前指挥单位" hidden><div><strong id="resident-name"></strong><small id="resident-hint"></small></div><button id="clear-selection" aria-label="取消选中">${icon('close')}</button></section>
    <dialog id="settings-dialog" class="paper-dialog settings-dialog" aria-labelledby="settings-title"><button class="dialog-close" aria-label="关闭设置">${icon('close')}</button><p class="eyebrow">游戏已暂停</p><h2 id="settings-title">设置</h2><div class="system-actions"><button id="continue-game" class="primary-button">继续游戏</button><button id="settings-help">操作说明</button><button id="return-menu">回到主菜单</button><button id="exit-game">退出游戏</button></div><p id="settings-notice" class="dialog-note" role="status">离开前会保存当前进度。</p></dialog>
    <dialog id="help-dialog" class="paper-dialog"><button class="dialog-close" aria-label="关闭操作说明">${icon('close')}</button><div class="dialog-symbol">${icon('compass')}</div><p class="eyebrow">经营家园</p><h2>操作说明</h2><p class="dialog-intro">点击土地或资源，选择按钮安排作业。<br>选中任意单位（包括狗），再点空地指挥移动；选中农民后点作业目标可直接指派，多种作物需先选择。<br>再次点击同一人物取消选择；成功下令后自动取消选择，指令仍会执行。<br>新指令优先，完成后恢复自主行为；中断作业会保留进度。</p><div class="instruction-row"><b>电脑</b><p>拖动地图或使用 WASD / 方向键移动视角<br>鼠标滚轮缩放</p></div><div class="instruction-row"><b>手机</b><p>滑动屏幕移动地图<br>双指捏合缩放</p></div><p class="dialog-note">离开页面或打开系统面板会暂停作业和作物生长。进度保存在当前浏览器中。<br><a href="./credits.html" target="_blank" rel="noopener">资源署名</a></p><button class="primary-button" id="start-walking">继续 ${icon('arrow')}</button></dialog>
    <dialog id="landmark-dialog" class="paper-dialog"><button class="dialog-close" aria-label="关闭地标详情">${icon('close')}</button><div class="dialog-symbol">${icon('leaf')}</div><p class="eyebrow" id="landmark-label"></p><h2 id="landmark-title"></h2><p class="dialog-intro" id="landmark-description"></p><button class="primary-button" id="keep-walking">继续逛逛 ${icon('arrow')}</button></dialog>
  `;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = get<HTMLCanvasElement>('game');
  const help = get<HTMLDialogElement>('help-dialog');
  const detail = get<HTMLDialogElement>('landmark-dialog');
  const settings = get<HTMLDialogElement>('settings-dialog');
  const copy = document.createElement('button');
  copy.id = 'copy-diagnostics'; copy.textContent = '复制诊断信息';
  settings.querySelector('.system-actions')!.append(copy);
  const record = document.createElement('button');
  record.id = 'record-performance'; record.textContent = '记录当前视距';
  copy.before(record);
  let recordPerformance = () => '请先运行游戏几秒。';
  record.addEventListener('click', () => { get('settings-notice').textContent = recordPerformance(); });
  let diagnostics: () => unknown = diagnosticContext;
  copy.addEventListener('click', async () => {
    const ok = await copyDiagnostics(JSON.stringify(diagnostics(), null, 2), settings);
    get('settings-notice').textContent = ok ? '诊断信息已复制，可粘贴反馈。' : '复制失败，请允许浏览器访问剪贴板后重试。';
  });
  const dialogs = [settings, help, detail];
  const discovered = new Set<string>();
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let nearby: Landmark | undefined;
  let loading = true;
  let toastTimer: ReturnType<typeof setTimeout>;
  function focusGame() { if (!dialogs.some(dialog => dialog.open)) canvas.focus({ preventScroll: true }); }
  let onPauseChange = () => {};
  let onLeave: (destination: 'menu' | 'exit') => void = () => {};
  const showDialog = (dialog: HTMLDialogElement) => { if (!dialog.open) dialog.showModal(); onPauseChange(); };
  let onAction: (id: string) => void = () => {};
  let onCancel: (id: number) => void = () => {};
  let actionsKey = '', inventoryKey = '', queueKey = '';
  const toggleQueue = () => {
    get('queue-panel').hidden = !get('queue-panel').hidden;
    get('queue-toggle').setAttribute('aria-expanded', String(!get('queue-panel').hidden));
    focusGame();
  };
  get('queue-toggle').addEventListener('click', toggleQueue, options);
  get('queue-close').addEventListener('click', toggleQueue, options);
  get('selection-actions').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (button && !button.disabled) { onAction(button.dataset.action!); focusGame(); }
  }, options);
  get('queue-list').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-cancel]');
    if (button) { onCancel(Number(button.dataset.cancel)); focusGame(); }
  }, options);
  for (const dialog of dialogs) {
    dialog.querySelector('button')!.addEventListener('click', () => dialog.close(), options);
    dialog.addEventListener('close', () => { onPauseChange(); focusGame(); }, options);
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }, options);
  }
  get('help').addEventListener('click', () => showDialog(help), options);
  get('settings').addEventListener('click', () => showDialog(settings), options);
  get('settings-help').addEventListener('click', () => showDialog(help), options);
  get('continue-game').addEventListener('click', () => settings.close(), options);
  get('return-menu').addEventListener('click', () => onLeave('menu'), options);
  get('exit-game').addEventListener('click', () => onLeave('exit'), options);
  get('start-walking').addEventListener('click', () => help.close(), options);
  get('keep-walking').addEventListener('click', () => detail.close(), options);
  const inspect = () => {
    if (!nearby || dialogs.some(dialog => dialog.open)) return;
    get('landmark-title').textContent = nearby.name;
    get('landmark-label').textContent = nearby.label;
    get('landmark-description').textContent = nearby.description;
    if (!discovered.has(nearby.id)) {
      discovered.add(nearby.id);
      const stop = app.querySelector(`[data-stop="${nearby.id}"]`)!;
      stop.classList.add('visited'); stop.querySelector('svg')!.outerHTML = icon('check');
      get('progress-count').innerHTML = `${discovered.size}<span> / 3</span>`;
      get('progress-bar').style.width = `${discovered.size / 3 * 100}%`;
      if (discovered.size === 3) {
        get('journey-message').textContent = '每一处小风景，都已留下你的足迹。';
      }
    }
    showDialog(detail);
  };
  get('inspect').addEventListener('click', inspect, options);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyE' && !event.repeat && !event.ctrlKey && !event.metaKey && event.target === canvas) inspect();
  }, options);

  // Cache DOM measurements; only the Babylon-projected anchor moves each frame.
  const card = get('selection-card');
  const fixedControls = [...app.querySelectorAll<HTMLElement>('.topbar, .settings-button, .performance-hud, .economy-bar, .view-controls, .bottom-bar, .resident-selection')];
  let layoutDirty = true;
  let layout = { width: 0, height: 0, cardWidth: 0, cardHeight: 0, left: 12, right: 12, top: 12, bottom: 12,
    blockers: [] as { x: number; y: number; width: number; height: number }[] };
  const layoutObserver = new ResizeObserver(() => { layoutDirty = true; });
  for (const element of [app, card, ...fixedControls]) layoutObserver.observe(element);
  const positionSelection = (x: number, y: number, visible: boolean) => {
    if (card.hidden) return;
    card.style.visibility = visible && get('queue-panel').hidden ? 'visible' : 'hidden';
    if (card.style.visibility === 'hidden') return;
    if (layoutDirty) {
      const bounds = app.getBoundingClientRect(), style = getComputedStyle(app);
      const inset = (edge: string) => Math.max(12, parseFloat(style.getPropertyValue(`--safe-${edge}`)) || 0);
      layout = { width: bounds.width, height: bounds.height, cardWidth: card.offsetWidth, cardHeight: card.offsetHeight,
        left: inset('left'), right: inset('right'), top: inset('top'), bottom: inset('bottom'),
        blockers: fixedControls.filter(element => !element.hidden).map(element => {
          const r = element.getBoundingClientRect(); return { x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height };
        }) };
      layoutDirty = false;
    }
    const { width, height, cardWidth: w, cardHeight: h, blockers } = layout;
    const candidates = [{ x: x - w / 2, y: y - h - 18 }, { x: x - w / 2, y: y + 18 },
      { x: x + 18, y: y - h / 2 }, { x: x - w - 18, y: y - h / 2 }];
    for (const b of blockers) candidates.push({ x: x - w / 2, y: b.y - h - 8 }, { x: x - w / 2, y: b.y + b.height + 8 },
      { x: b.x - w - 8, y: y - h / 2 }, { x: b.x + b.width + 8, y: y - h / 2 });
    let best = { x: layout.left, y: layout.top }, score = Infinity;
    for (const candidate of candidates) {
      const p = { x: Math.max(layout.left, Math.min(width - w - layout.right, candidate.x)),
        y: Math.max(layout.top, Math.min(height - h - layout.bottom, candidate.y)) };
      const overlap = blockers.reduce((sum, b) => sum + Math.max(0, Math.min(p.x + w + 4, b.x + b.width) - Math.max(p.x - 4, b.x))
        * Math.max(0, Math.min(p.y + h + 4, b.y + b.height) - Math.max(p.y - 4, b.y)), 0);
      const distance = (p.x + w / 2 - x) ** 2 + (p.y + h / 2 - y) ** 2;
      const value = overlap * 1e6 + distance;
      if (value < score) { score = value; best = p; }
    }
    card.style.transform = `translate(${Math.round(best.x)}px, ${Math.round(best.y)}px)`;
  };

  return {
    canvas, joystick: get('joystick'), knob: get('joystick-knob'),
    addResidentLabel(id: string, name: string) {
      const label = document.createElement('span');
      label.className = 'resident-label'; label.dataset.resident = id; label.textContent = name;
      get('resident-labels').append(label);
      return label;
    },
    get paused() { return loading || dialogs.some(dialog => dialog.open); },
    bindPause(callback: () => void) { onPauseChange = callback; },
    bindLeave(callback: (destination: 'menu' | 'exit') => void) { onLeave = callback; },
    bindDiagnostics(callback: () => unknown) { diagnostics = callback; },
    bindPerformanceRecord(callback: () => string) { recordPerformance = callback; },
    saveFailed() { get('settings-notice').textContent = '未能保存进度，请检查浏览器存储后重试。当前游戏已保留。'; },
    get discoveredCount() { return discovered.size; },
    bind(id: string, callback: () => void) {
      get(id).addEventListener('click', () => { callback(); focusGame(); }, options);
    },
    setFarmerPreview(active: boolean) {
      get('farmer-preview').setAttribute('aria-pressed', String(active));
      get('farmer-preview').setAttribute('title', active ? '返回游戏视角' : '查看农民模型');
    },
    setBasePreview(active: boolean) {
      get('base-preview').setAttribute('aria-pressed', String(active));
      get('base-preview').setAttribute('title', active ? '返回游戏视角' : '查看基础人物');
    },
    setNearby(landmark: Landmark | undefined) {
      if (nearby?.id === landmark?.id) return;
      nearby = landmark;
      get('landmark-prompt').hidden = !landmark;
      if (landmark) get('nearby-name').textContent = landmark.name;
    },
    setOverview(active: boolean) {
      get('overview').setAttribute('aria-pressed', String(active));
      get('overview').setAttribute('aria-label', active ? '返回地图视角' : '查看全景');
      get('overview').title = active ? '返回地图视角' : '查看全景';
    },
    ready() { loading = false; onPauseChange(); focusGame(); },
    bindEconomy(action: (id: string) => void, cancel: (id: number) => void) { onAction = action; onCancel = cancel; },
    setResources(values: { name: string; amount: number; capacity: number; reserved: number }[]) {
      const key = JSON.stringify(values); if (key === inventoryKey) return; inventoryKey = key;
      get('inventory').replaceChildren(...values.map(value => {
        const cell = document.createElement('span');
        cell.textContent = `${value.name} ${value.amount}/${value.capacity}`;
        cell.title = `容量 ${value.capacity}，预留 ${value.reserved}，可用 ${value.amount - value.reserved}`;
        if (value.reserved) { const reserved = document.createElement('small'); reserved.textContent = `预留 ${value.reserved}`; cell.append(reserved); }
        return cell;
      }));
    },
    setQueue(rows: QueueRow[], count: number) {
      get('queue-count').textContent = String(count);
      // Progress and status changes preserve the original buttons and focus.
      const list = get('queue-list'), key = rows.map(row => row.id).join(',');
      if (key !== queueKey || !list.childNodes.length) {
        queueKey = key;
        list.replaceChildren(...rows.map(row => {
          const item = document.createElement('li'); item.dataset.task = String(row.id);
          item.append(document.createElement('strong'), document.createElement('span'), document.createElement('progress'), document.createElement('p'));
          const button = document.createElement('button'); button.dataset.cancel = String(row.id); button.textContent = '取消'; button.setAttribute('aria-label', `取消任务 ${row.id}`); item.append(button);
          return item;
        }));
        if (!rows.length) list.textContent = '还没有任务，点击地图上的资源或土地开始。';
      }
      for (const row of rows) {
        const item = list.querySelector<HTMLElement>(`[data-task="${row.id}"]`)!;
        item.querySelector('strong')!.textContent = row.title;
        item.querySelector('span')!.textContent = row.status;
        const reason = item.querySelector('p')!; reason.textContent = row.reason; reason.hidden = !row.reason;
        const progress = item.querySelector('progress')!; progress.max = 100; progress.value = row.progress; progress.setAttribute('aria-label', row.title + '进度');
        const button = item.querySelector('button')!; button.hidden = !row.cancellable; button.disabled = !row.cancellable;
      }
    },
    setSelection(details?: SelectionDetails) {
      const visible = !!details?.actions?.length;
      if (card.hidden && visible) card.style.visibility = 'hidden';
      card.hidden = !visible;
      if (!details || !visible) return;
      card.setAttribute('aria-label', `${details.name}的操作`);
      const actions = details.actions ?? [], key = JSON.stringify(actions);
      if (key !== actionsKey) {
        actionsKey = key;
        get('selection-actions').replaceChildren(...actions.map(action => {
          const button = document.createElement('button'); button.dataset.action = action.id; button.textContent = action.label; button.disabled = !!action.disabled; return button;
        }));
      }
    },
    positionSelection,
    setResident(name?: string, canWork = false) {
      get('resident-selection').hidden = !name;
      get('resident-name').textContent = name ?? '';
      get('resident-hint').textContent = canWork ? '点空地移动 · 点目标作业' : '点空地指挥移动';
      layoutDirty = true;
    },
    setPerformance(sample?: FrameSample) {
      get('fps-value').textContent = sample ? sample.fps.toFixed(1) : '—';
      get('cpu-value').textContent = sample ? sample.cpuMs.toFixed(2) : '—';
    },
    toast(message: string) {
      clearTimeout(toastTimer);
      get('toast').textContent = message; get('toast').classList.add('visible');
      toastTimer = setTimeout(() => get('toast').classList.remove('visible'), 2200);
    },
    dispose() { abort.abort(); layoutObserver.disconnect(); clearTimeout(toastTimer); for (const dialog of dialogs) dialog.close(); },
  };
}

export type GameUI = ReturnType<typeof createUI>;
