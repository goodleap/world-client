import type { Landmark } from './game/world-data.ts';

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
};
function icon(name: keyof typeof icons) {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

export function createUI(app: HTMLElement) {
  app.innerHTML = `
    <canvas id="game" tabindex="0" aria-label="三维家园，点击选中人物或建筑，拖动地图，WASD 移动视角"></canvas>
    <div id="resident-labels" class="resident-labels" aria-label="家园居民"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="topbar">
      <div class="brand"><span class="brand-icon">${icon('home')}</span><div><h1>家园漫游</h1><p>A LITTLE PLACE TO GROW</p></div></div>
      <div class="weather">${icon('sun')}<span>初夏<span class="weather-divider">/</span>晴</span></div>
    </header>
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
    <dialog id="help-dialog" class="paper-dialog"><button class="dialog-close" aria-label="关闭操作说明">${icon('close')}</button><div class="dialog-symbol">${icon('compass')}</div><p class="eyebrow">探索家园</p><h2>操作说明</h2><p class="dialog-intro">点击人物选中，再点击空地指挥移动。<br>点击建筑可以选中建筑。</p><div class="instruction-row"><b>电脑</b><p>拖动地图或使用 WASD / 方向键移动视角<br>鼠标滚轮缩放</p></div><div class="instruction-row"><b>手机</b><p>滑动屏幕移动地图<br>双指捏合缩放</p></div><p class="dialog-note">右侧罗盘可以查看全景，回转箭头可回到初始视角。</p><button class="primary-button" id="start-walking">开始 ${icon('arrow')}</button></dialog>
    <dialog id="landmark-dialog" class="paper-dialog"><button class="dialog-close" aria-label="关闭地标详情">${icon('close')}</button><div class="dialog-symbol">${icon('leaf')}</div><p class="eyebrow" id="landmark-label"></p><h2 id="landmark-title"></h2><p class="dialog-intro" id="landmark-description"></p><button class="primary-button" id="keep-walking">继续逛逛 ${icon('arrow')}</button></dialog>
    <div id="loading" class="loading"><span class="loading-icon">${icon('home')}</span><h2>让小世界慢慢醒来</h2><p>正在准备你的家园…</p><span class="loading-line"></span></div>
  `;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = get<HTMLCanvasElement>('game');
  const help = get<HTMLDialogElement>('help-dialog');
  const detail = get<HTMLDialogElement>('landmark-dialog');
  const discovered = new Set<string>();
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let nearby: Landmark | undefined;
  let toastTimer: ReturnType<typeof setTimeout>;
  function focusGame() { canvas.focus({ preventScroll: true }); }
  for (const dialog of [help, detail]) {
    dialog.querySelector('button')!.addEventListener('click', () => dialog.close(), options);
    dialog.addEventListener('close', focusGame, options);
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }, options);
  }
  get('help').addEventListener('click', () => help.showModal(), options);
  get('start-walking').addEventListener('click', () => help.close(), options);
  get('keep-walking').addEventListener('click', () => detail.close(), options);
  const inspect = () => {
    if (!nearby || help.open || detail.open) return;
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
    detail.showModal();
  };
  get('inspect').addEventListener('click', inspect, options);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyE' && !event.repeat && !event.ctrlKey && !event.metaKey && event.target === canvas) inspect();
  }, options);

  return {
    canvas, joystick: get('joystick'), knob: get('joystick-knob'),
    addResidentLabel(id: string, name: string) {
      const label = document.createElement('span');
      label.className = 'resident-label'; label.dataset.resident = id; label.textContent = name;
      get('resident-labels').append(label);
      return label;
    },
    get paused() { return help.open || detail.open; },
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
    ready() { get('loading').classList.add('loaded'); focusGame(); },
    error() {
      const loading = get('loading'); loading.classList.remove('loaded');
      loading.querySelector('h2')!.textContent = '暂时无法打开这个小世界';
      loading.querySelector('p')!.textContent = '请使用支持 WebGL 的浏览器，并开启硬件加速后刷新页面。';
      loading.querySelector('.loading-line')?.remove();
    },
    toast(message: string) {
      clearTimeout(toastTimer);
      get('toast').textContent = message; get('toast').classList.add('visible');
      toastTimer = setTimeout(() => get('toast').classList.remove('visible'), 2200);
    },
    dispose() { abort.abort(); clearTimeout(toastTimer); },
  };
}

export type GameUI = ReturnType<typeof createUI>;
