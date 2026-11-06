import { TOWER_CONFIG } from './game/towers.ts';
import type { UnitInfo } from './game/unit-info.ts';
import { DEFAULT_LIGHTING, normalizeLighting } from './game/graphics-settings.ts';
import type { PerformanceMode } from './game/graphics-settings.ts';
import type { LightingSettings } from './game/graphics-settings.ts';
import { ECONOMY_CONFIG } from './game/economy-config.ts';
import { CAMPFIRE_CONFIG } from './game/campfire.ts';
import { ResidentSpeech } from './game/resident-speech.ts';
import { HealthIndicator } from './game/health-indicator.ts';
import { createMapGestures } from './game/map-gestures.ts';
import type { Landmark } from './game/world-data.ts';
import type { FrameSample } from './game/frame-metrics.ts';
import { copyDiagnostics, diagnosticContext } from './diagnostics.ts';

export interface SelectionAction { id: string; label: string; disabled?: boolean }
export interface SelectionDetails { showHint?: boolean; name: string; kind: string; hint: string; actions?: SelectionAction[]; health?:{value:number;maximum:number} }
export interface QueueRow { id: number; title: string; status: string; progress: number; reason: string; cancellable: boolean }

const icons = {
  hammer: '<path d="m14 3 7 7-3 3-3-3-9 11-3-3 11-9-3-3Z"/>',
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
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16M15 5v16"/>',
};
function icon(name: keyof typeof icons, viewBox = '0 0 24 24') {
  return `<svg width="22" height="22" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

export function createUI(app: HTMLElement) {
  app.innerHTML = `
    <canvas id="game" tabindex="0" aria-label="三维家园，点击选中人物、建筑、树木或作物，拖动地图，WASD 移动视角"></canvas>
    <div id="resident-labels" class="resident-labels" aria-label="家园居民"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="topbar">
      <button id="home-resources" class="home-summary" aria-label="资源、人口与建筑" title="查看资源、人口、编队与建筑"><span id="population">人口 6</span><span id="resource-summary"></span></button>
      <div class="weather"><time id="game-time">00:00</time>${icon('sun')}<span>初夏<span class="weather-divider">/</span>晴</span></div>
    </header>
    <button id="map-toggle" class="map-button icon-button" aria-label="展开小地图" title="展开小地图" aria-expanded="false" aria-controls="minimap-panel">${icon('map')}</button>
    <button id="settings" class="settings-button icon-button" aria-label="设置" title="设置">${icon('settings')}</button>
    <section id="minimap-panel" class="minimap-panel" aria-label="小地图" hidden>
      <canvas id="minimap" width="320" height="320" role="button" tabindex="0" aria-label="全屏查看地图"></canvas>
    </section>
    <div class="status-stack">
    <aside id="performance" class="performance-hud" aria-label="性能信息" title="约每半秒更新。FPS 与 CPU 为这段时间的平均值；CPU 包含游戏逻辑和渲染提交，不包含帧间等待或 GPU 执行时间。三角形为采样帧实际提交总量，包含主画面、阴影等渲染通道。">
      <span>FPS <b id="fps-value">—</b></span><span>CPU <b id="cpu-value">—</b><small>ms/帧</small></span>
      <span class="performance-triangles">三角形 <b id="triangles-value">—</b><small>/帧</small></span>
      <span class="performance-memory" title="浏览器提供的 JavaScript 已用堆内存，不含 GPU、贴图及页面进程的全部内存；不支持时显示 —。">JS 内存 <b id="memory-value">—</b><small>MB</small></span>
    </aside>
    <aside class="economy-bar" aria-label="资源与人口">
      <button id="queue-toggle" aria-expanded="false" aria-controls="queue-panel">作业 <b id="queue-count">0</b></button>
    </aside>
    <button id="raid-notice" class="raid-notice" aria-live="polite" hidden></button>
    <section id="queue-panel" class="queue-panel" aria-label="作业队列" hidden>
      <div class="queue-heading"><h2>作业队列</h2><button id="queue-close" aria-label="收起作业队列">${icon('close')}</button></div>
      <ol id="queue-list"></ol>
    </section>
    </div>
    <aside class="journey" aria-label="探索进度" hidden>
      <div class="eyebrow"><span class="status-dot"></span> 初到家园</div>
      <div class="journey-heading"><h2>沿着小路，走一走</h2><span id="progress-count">0<span> / 3</span></span></div>
      <p id="journey-message">去看看小屋、菜园与水井。</p>
      <div class="stops"><span data-stop="cottage">${icon('home')}小屋</span><span data-stop="garden">${icon('leaf')}菜园</span><span data-stop="well">${icon('compass')}水井</span></div>
      <div class="progress-track"><span id="progress-bar"></span></div>
    </aside>
    <section id="selection-info" class="selection-info" aria-label="选中信息" hidden>
      <section id="resident-selection" class="resident-selection" aria-label="当前单位信息" aria-describedby="resident-hint" hidden>
        <details id="unit-details"><summary aria-label="展开或收起单位详情">
          <div class="resident-card-heading"><strong id="resident-name"></strong><small id="resident-level" hidden></small><span id="resident-activity"></span></div>
          <div id="resident-vitals" class="resident-vitals"></div>
        </summary><div class="unit-details-body"><div id="unit-attributes" class="unit-attributes"></div><label id="leader-command-control" class="leader-command" hidden><span>指挥</span><input id="leader-command-enabled" type="checkbox" role="switch" aria-label="开启领头指挥"></label></div></details>
        <span id="resident-hint" class="sr-only"></span>
      </section>
      <section id="selection-card" class="selection-card" aria-label="对象信息" hidden><strong id="selection-name"></strong><small id="selection-kind"></small><p id="selection-hint" role="status"></p></section>
    </section>
    <div id="landmark-prompt" class="landmark-prompt" hidden><button id="inspect"><span class="prompt-icon">${icon('leaf')}</span><span><small>发现一处小风景</small><strong id="nearby-name"></strong></span><span class="prompt-key">E</span>${icon('arrow')}</button></div>
    <div class="bottom-dock">
      <nav class="construction-controls" aria-label="建筑选项">
        <div id="building-palette" class="building-palette" aria-label="选择建设类型" hidden>
          <button id="build-farm" data-building="farm"><span>耕地 <small>1 × 1</small></span><small class="building-cost">无需材料</small></button>
          <button id="build-warehouse" data-building="warehouse"><span>仓库 <small>3 × 2</small></span><small class="building-cost">木材 ${ECONOMY_CONFIG.warehouseCost.wood}
石材 ${ECONOMY_CONFIG.warehouseCost.stone}</small></button>
          <button id="build-campfire" data-building="campfire"><span>火堆 <small>2 × 2</small></span><small class="building-cost">石材 ${CAMPFIRE_CONFIG.cost.stone}</small></button>
          <button id="build-tower" data-building="tower"><span>哨塔 <small>1.5 × 1.5</small></span><small class="building-cost">木材 ${TOWER_CONFIG.cost.wood}
石材 ${TOWER_CONFIG.cost.stone}</small></button>
          <button id="build-house" data-building="house"><span>民房 <small>2 × 2</small></span><small class="building-cost">木材 ${ECONOMY_CONFIG.houseCost.wood}
石材 ${ECONOMY_CONFIG.houseCost.stone}</small></button>
        </div>
        <div id="placement-status" class="placement-status" hidden><span id="placement-hint" role="status"></span><button id="cancel-building" aria-label="取消放置">取消</button></div>
      </nav>
      <div class="bottom-controls">
        <button id="building-toggle" aria-expanded="false" aria-controls="building-palette">${icon('hammer')}建造</button>
        <button id="clear-selection" class="cancel-selection" aria-label="取消选中" hidden>${icon('close')}<span>取消选中</span></button>
        <nav class="view-controls" aria-label="视角控制">
          <button id="reset" class="icon-button" aria-label="恢复视角" title="恢复视角">${icon('reset')}</button>
        </nav>
      </div>
    </div>
    <div id="joystick" class="joystick" aria-hidden="true"><div class="joystick-axis"></div><div id="joystick-knob" class="joystick-knob"></div></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <section id="selection-actions-panel" class="selection-actions-panel" aria-label="对象操作" hidden><div id="selection-actions" class="selection-actions"></div></section>
    <div id="target-hint" class="target-hint floating-hint" role="status" hidden></div>

    <nav id="group-shortcuts" class="group-shortcuts" aria-label="快速选择编队"></nav>
    <dialog id="resources-dialog" class="paper-dialog resources-dialog" aria-labelledby="resources-title">
      <button class="dialog-close" aria-label="关闭家园面板">${icon('close')}</button><h2 id="resources-title">家园</h2>
      <div class="home-tabs" role="tablist" aria-label="家园信息">
        <button id="resources-tab" role="tab" aria-controls="resources-panel" aria-selected="true">资源</button>
        <button id="population-tab" role="tab" aria-controls="population-panel" aria-selected="false">人口</button>
        <button id="buildings-tab" role="tab" aria-controls="buildings-panel" aria-selected="false">建筑</button>
      </div>
      <section id="resources-panel" role="tabpanel" aria-labelledby="resources-tab"><div id="inventory" class="inventory"></div><p class="dialog-note">资源送达仓库后才可使用。预留材料用于已安排的建设。</p></section>
      <section id="buildings-panel" role="tabpanel" aria-labelledby="buildings-tab" hidden>
        <label class="auto-repair-control"><input id="auto-repair" type="checkbox" role="switch">自动维修</label>
        <p id="building-summary" class="dialog-note"></p>
        <div class="building-scroll"><table class="building-table" aria-label="家园建筑">
          <thead><tr><th scope="col">名称</th><th scope="col">生命</th><th scope="col">防御</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
          <tbody id="building-rows"></tbody>
        </table></div>
        <p id="building-notice" class="dialog-note" role="status"></p>
      </section>
      <section id="population-panel" role="tabpanel" aria-labelledby="population-tab" hidden>
        <div class="population-heading"><p id="population-summary"></p><label id="population-command-control" class="leader-command" hidden><span>领头指挥</span><input id="population-command-enabled" type="checkbox" role="switch" aria-label="开启领头指挥"></label></div>
        <div class="population-tools"><div id="group-editor-tabs" class="home-tabs" aria-label="选择要编辑的编队"></div><div class="group-edit-actions"><button id="clear-group">清空本队</button></div></div>
        <nav id="population-filters" class="population-filters" aria-label="按人物类型筛选"></nav>
        <div class="population-scroll">
          <table class="population-table" aria-label="存活我方单位">
            <colgroup><col class="population-check"><col class="population-name"><col class="population-level"><col class="population-group"><col class="population-assignment"><col class="population-health"><col class="population-stamina"><col class="population-stats"></colgroup>
            <thead><tr><th scope="col" aria-label="编入队伍"></th><th scope="col">名称</th><th scope="col">等级</th><th scope="col">编队</th><th scope="col">安排</th><th scope="col">生命</th><th scope="col">体力</th><th scope="col" aria-label="攻击与护甲">攻 / 防</th></tr></thead>
            <tbody id="group-candidates"></tbody>
          </table>
        </div>
        <p id="group-notice" role="status">已选 0 / 6</p>
      </section>
      <footer class="panel-footer"><button id="continue-home" class="primary-button">继续游戏</button></footer>
    </dialog>
    <dialog id="map-dialog" class="map-dialog" aria-label="全屏地图"><button class="dialog-close" aria-label="关闭全屏地图">${icon('close')}</button><div id="map-viewport" class="map-viewport" aria-label="拖动浏览，双指或滚轮缩放"></div></dialog>
    <dialog id="demolish-dialog" class="paper-dialog demolish-dialog" aria-labelledby="demolish-title"><button class="dialog-close" aria-label="取消拆除">${icon('close')}</button><h2 id="demolish-title">拆除建筑</h2><p id="demolish-description"></p><div class="home-actions"><button id="demolish-confirm">确认拆除</button></div></dialog>
    <dialog id="recruit-dialog" class="paper-dialog recruit-dialog" aria-labelledby="recruit-title"><button class="dialog-close" aria-label="关闭家园中心">${icon('close')}</button><p class="eyebrow">游戏已暂停</p><h2 id="recruit-title">家园中心</h2><p id="recruit-capacity"></p><div class="recruit-options-scroll"><div id="recruit-options" class="recruit-options"></div></div><div class="recruit-queue-heading"><h3>招募队列 <small>最多 20 名 · 依次招募</small></h3></div><ol id="recruit-queue"></ol><p id="recruit-notice" class="dialog-note" role="status"></p><footer class="panel-footer"><button id="continue-recruit" class="primary-button">继续游戏</button></footer></dialog>
    <dialog id="settings-dialog" class="paper-dialog settings-dialog" aria-labelledby="settings-title"><button class="dialog-close" aria-label="关闭设置">${icon('close')}</button><p class="eyebrow">游戏已暂停</p><h2 id="settings-title">设置</h2><div class="settings-scroll"><div class="system-actions"><button id="settings-graphics">画面设置</button><button id="settings-help">操作说明</button><button id="return-menu">回到主菜单</button><button id="exit-game">退出游戏</button></div><p id="settings-notice" class="dialog-note" role="status">离开前会保存当前进度。</p></div><footer class="panel-footer"><button id="continue-game" class="primary-button">继续游戏</button></footer></dialog>
    <dialog id="graphics-dialog" class="paper-dialog graphics-dialog" aria-labelledby="graphics-title"><div class="graphics-heading"><h2 id="graphics-title">画面设置</h2><button id="graphics-back">返回设置</button></div><p class="eyebrow">游戏已暂停</p><label class="performance-setting" for="performance-mode">性能模式<select id="performance-mode"><option value="standard">标准 · 60 帧</option><option value="saving">省电 · 30 帧</option><option value="minimum">强省电 · 20 帧</option></select><small>省电模式降低画面分辨率与阴影，游戏速度保持不变。</small></label><label class="settings-toggle" for="shadows-enabled"><span>开启阴影<small>关闭可减轻设备负担</small></span><input id="shadows-enabled" type="checkbox" role="switch" checked></label><div class="lighting-controls" aria-label="光照设置">
      <label for="environment-light">环境补光 <output id="environment-light-value"></output><input id="environment-light" type="range" min="0" max="2" step="0.01"></label>
      <label for="sunlight">太阳光强度 <output id="sunlight-value"></output><input id="sunlight" type="range" min="0" max="2" step="0.01"></label>
      <label for="sun-color" class="light-color">太阳光颜色<input id="sun-color" type="color"></label>
      <button id="reset-lighting">恢复默认光照</button>
    </div><p id="graphics-notice" class="dialog-note" role="status" hidden></p></dialog>
    <dialog id="help-dialog" class="paper-dialog"><button class="dialog-close" aria-label="关闭操作说明">${icon('close')}</button><div class="dialog-symbol">${icon('compass')}</div><p class="eyebrow">经营家园</p><h2>操作说明</h2><p class="dialog-intro">建造菜单可开垦耕地、建造仓库、民房、哨塔和火堆；手机可横向滑动选项，轻点选择或向上拖出放置。<br>选中后，头顶显示名称和生命条，顶部信息卡显示状态、体力和等级，点击展开详情。底部可取消选中。<br>点击耕地或资源，选择按钮安排作业。<br>选中任意单位（包括狗），再点空地指挥移动；选中农民后点作业目标可直接指派，多种作物需先选择。<br>再次点击同一人物取消选择；移动与攻击保留选择，安排作业后释放选择。<br>依次点击步兵、弓兵或骑兵，单独下达指令；点敌人攻击，点空地移动。切换士兵不会取消上一名士兵的命令。敌我受击自动反击；点空地离开战斗，移动优先。我方士兵生命归零后死亡，停止全部任务，不能再指挥或通过进食复活。存活单位可到火堆进食补体力并缓慢回血。人物与动物在已开启火堆 30 格内、体力低于 30% 或受伤时，空闲后自行进食；缺料时所有人物均可从仓库分批补给，动物等待供餐。熄火停止消耗；关闭烹饪只照明。清理矿谷和山口后获得战利品并开放资源采集，物资需要农民搬运入库。林间果丛可采集粮食；铁矿送入仓库后，可在仓库加工工具和装备。密林和湖泊不可建设，道路与通道空地允许建造；通行影响仅作提醒，施工仍需农民实际到场。<br>新指令优先；中断作业会保留进度。</p><div class="instruction-row"><b>电脑</b><p>拖动地图或使用 WASD / 方向键移动视角<br>触控板双指滑动平移、捏合缩放；鼠标滚轮缩放</p></div><div class="instruction-row"><b>手机</b><p>滑动屏幕移动地图<br>双指捏合缩放</p></div><p class="dialog-note">离开页面或打开系统面板会暂停作业和作物生长；从后台返回后需点击继续游戏。进度保存在当前浏览器中。<br><a href="./credits.html" target="_blank" rel="noopener">资源署名</a></p><button class="primary-button" id="start-walking">继续 ${icon('arrow')}</button></dialog>
    <dialog id="landmark-dialog" class="paper-dialog"><button class="dialog-close" aria-label="关闭地标详情">${icon('close')}</button><div class="dialog-symbol">${icon('leaf')}</div><p class="eyebrow" id="landmark-label"></p><h2 id="landmark-title"></h2><p class="dialog-intro" id="landmark-description"></p><button class="primary-button" id="keep-walking">继续逛逛 ${icon('arrow')}</button></dialog>
  `;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = get<HTMLCanvasElement>('game');
  const help = get<HTMLDialogElement>('help-dialog');
  const detail = get<HTMLDialogElement>('landmark-dialog');
  const settings = get<HTMLDialogElement>('settings-dialog');
  const graphics = get<HTMLDialogElement>('graphics-dialog');
  const copy = document.createElement('button');
  copy.id = 'copy-diagnostics'; copy.textContent = '复制性能日志';
  settings.querySelector('.system-actions')!.append(copy);
  const record = document.createElement('button');
  record.id = 'record-performance'; record.textContent = '记录当前视距';
  copy.before(record);
  let recordPerformance:()=>string|Promise<string> = () => '请先运行游戏几秒。';
  record.addEventListener('click', async () => { get('settings-notice').textContent = await recordPerformance(); });
  let diagnostics: () => unknown = diagnosticContext;
  copy.addEventListener('click', async () => {
    const ok = await copyDiagnostics(JSON.stringify(await diagnostics()), settings);
    get('settings-notice').textContent = ok ? '最近 10 秒性能日志已复制，可粘贴反馈。' : '复制失败，请允许浏览器访问剪贴板后重试。';
  });
  const resources = get<HTMLDialogElement>('resources-dialog');
  const recruitment = get<HTMLDialogElement>('recruit-dialog');
  const demolition=get<HTMLDialogElement>('demolish-dialog');
  const fullMap=get<HTMLDialogElement>('map-dialog');
  const dialogs = [settings, graphics, help, detail, resources, recruitment, demolition, fullMap];
  let confirmDemolition: (()=>void)|undefined;
  const speech = new ResidentSpeech();
  const bubbles = new Map<string, HTMLElement>();
  const residentLabels = new Map<string, HTMLElement>();
  const healthIndicators = new Map<string, { state: HealthIndicator; bar: HTMLElement; fill: HTMLElement }>();
  let inspectedUnits=new Set<string>(),inspectionKey='';
  const residentSizes = new Map<HTMLElement, { width: number; height: number }>();
  const residentSizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) residentSizes.delete(entry.target as HTMLElement);
  });
  const residentSize = (element?: HTMLElement) => {
    if (!element) return { width: 0, height: 0 };
    let size = residentSizes.get(element);
    if (!size) { size = { width: element.offsetWidth, height: element.offsetHeight }; residentSizes.set(element, size); }
    return size;
  };
  const discovered = new Set<string>();
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const minimapPanel = get('minimap-panel'), mapToggle = get<HTMLButtonElement>('map-toggle');
  const mapCanvas=get<HTMLCanvasElement>('minimap'),mapViewport=get('map-viewport');
  let onMapPick=(x:number,y:number)=>{void x;void y;},onMapClose=()=>{};
  const mapGestures=createMapGestures(mapViewport,mapCanvas,options,(x,y)=>onMapPick(x,y));
  mapToggle.addEventListener('click', () => {
    minimapPanel.hidden = !minimapPanel.hidden;
    mapToggle.setAttribute('aria-expanded', String(!minimapPanel.hidden));
    mapToggle.setAttribute('aria-label', minimapPanel.hidden ? '展开小地图' : '收起小地图');
    mapToggle.title = minimapPanel.hidden ? '展开小地图' : '收起小地图';
  }, options);
  let nearby: Landmark | undefined;
  let loading = true;
  let backgroundPaused = false;
  let toastTimer: ReturnType<typeof setTimeout>;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let hintPersistent = false;
  let hintAnchor: { x: number; y: number; z: number } | undefined;
  function focusGame() { if (!dialogs.some(dialog => dialog.open)) canvas.focus({ preventScroll: true }); }
  let onPauseChange = () => {};
  let onLeave: (destination: 'menu' | 'exit') => void = () => {};
  const showDialog = (dialog: HTMLDialogElement) => { if (!dialog.open) dialog.showModal(); onPauseChange(); };
  // Open the destination first so the game stays paused throughout the swap.
  // Closing the source also removes its native backdrop from the top layer.
  const switchDialog = (from: HTMLDialogElement, to: HTMLDialogElement) => { showDialog(to); from.close(); };
  const openMap=()=>{if(fullMap.open)return;mapViewport.append(mapCanvas);mapCanvas.setAttribute('role','img');mapCanvas.tabIndex=-1;mapCanvas.setAttribute('aria-label','全屏地图，上方为北，浅色框为当前视野');showDialog(fullMap);mapGestures.reset();};
  mapCanvas.addEventListener('click',openMap,options);
  mapCanvas.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openMap();}},options);
  fullMap.addEventListener('close',()=>{mapGestures.reset();minimapPanel.append(mapCanvas);mapCanvas.setAttribute('role','button');mapCanvas.tabIndex=0;mapCanvas.setAttribute('aria-label','全屏查看地图');onMapClose();},options);
  get('demolish-confirm').addEventListener('click',()=>{const action=confirmDemolition;confirmDemolition=undefined;demolition.close();action?.();},options);
  const closeDialog = (dialog: HTMLDialogElement) => {
    if (dialog === graphics) switchDialog(graphics, settings);
    else {if(dialog===settings){backgroundPaused=false;get('settings-notice').textContent='离开前会保存当前进度。';}dialog.close();}
  };
  function showBackgroundPause() {
    for (const dialog of dialogs) if (dialog !== settings && dialog.open) dialog.close();
    get('settings-notice').textContent = '游戏已在后台暂停，点击继续游戏恢复。';
    showDialog(settings);
  }
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
    dialog.querySelector('button')!.addEventListener('click', () => closeDialog(dialog), options);
    dialog.addEventListener('cancel', event => {
      if (dialog === settings || dialog === graphics) {event.preventDefault();closeDialog(dialog);}
    }, options);
    dialog.addEventListener('close', () => { onPauseChange(); focusGame(); }, options);
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog || dialog === graphics || dialog === settings) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
    }, options);
  }
  get('home-resources').addEventListener('click', () => showDialog(resources), options);
  get('settings').addEventListener('click', () => showDialog(settings), options);
  get('settings-graphics').addEventListener('click', () => switchDialog(settings, graphics), options);
  get('settings-help').addEventListener('click', () => showDialog(help), options);
  get('continue-game').addEventListener('click', () => closeDialog(settings), options);
  get('continue-recruit').addEventListener('click', () => closeDialog(recruitment), options);
  get('continue-home').addEventListener('click', () => closeDialog(resources), options);
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

  // World overlays keep their offset from the projected target, even at edges.
  const card = get('selection-card'),actionsPanel=get('selection-actions-panel');
  residentSizeObserver.observe(actionsPanel);
  const hint = get('target-hint');
  const infoCard=get('selection-info'),unitCard=get('resident-selection');
  let residentName='',residentInfo:UnitInfo|undefined;
  const syncSelection=()=>{unitCard.hidden=!card.hidden||!residentName||!residentInfo;infoCard.hidden=card.hidden&&unitCard.hidden;get('clear-selection').hidden=infoCard.hidden;};
  const infoObserver=new ResizeObserver(entries=>{for(const entry of entries)app.style.setProperty('--selection-height',`${Math.ceil(entry.borderBoxSize?.[0]?.blockSize??entry.contentRect.height)}px`);});
  infoObserver.observe(infoCard);
  const objectLabel=document.createElement('span');objectLabel.className='resident-label selected-object-label';objectLabel.hidden=true;
  const objectName=document.createElement('span'),objectBars=document.createElement('span'),objectBar=document.createElement('span'),objectFill=document.createElement('span');
  objectBars.className='resident-health-bars';objectBar.className='resident-health';objectBar.setAttribute('role','meter');objectBar.setAttribute('aria-label','选中建筑生命');
  objectBar.append(objectFill);objectBars.append(objectBar);objectLabel.append(objectName,objectBars);get('resident-labels').append(objectLabel);
  const positionOverlay = (element: HTMLElement, x: number, y: number, visible: boolean) => {
    if (element.hidden) return;
    const visibility = visible && get('queue-panel').hidden ? 'visible' : 'hidden';
    if (element.style.visibility !== visibility) element.style.visibility = visibility;
    if (visibility === 'hidden') return;
    const transform = `translate(${x.toFixed(2)}px, ${(y - 18).toFixed(2)}px) translate(-50%, -100%)`;
    if (element.style.transform !== transform) element.style.transform = transform;
  };

  const vitalRows = Array.from({ length: 2 }, () => {
    const row = document.createElement('div'), value = document.createElement('span');
    const meter = document.createElement('span'), fill = document.createElement('span');
    row.className = 'unit-vital'; value.className = 'unit-vital-value'; meter.className = 'unit-meter';
    meter.setAttribute('role', 'meter'); meter.setAttribute('aria-valuemin', '0'); meter.append(fill);
    row.append(meter, value); row.hidden = true; get('resident-vitals').append(row);
    return { row, value, meter, fill };
  });
  const setText = (element: HTMLElement, text: string) => { if (element.textContent !== text) element.textContent = text; };
  const attackMarker = document.createElement('span');
  attackMarker.className = 'resident-attack-target'; attackMarker.setAttribute('aria-label', '当前攻击目标');
  attackMarker.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l4 1 11 14-2 2L4 9zM3 16l5 5M3 21l3-3M14 8l6-5 1 5-5 6M16 17l5 4M17 16l4-4"/></g></svg>';
  let attackPulseId: string | undefined, attackPulseAt = -Infinity;

  return {
    canvas, joystick: get('joystick'), knob: get('joystick-knob'),
    constructionControls: { toggle: get('building-toggle'), palette: get('building-palette'), choices: [...app.querySelectorAll<HTMLButtonElement>('[data-building]')], cancel: get('cancel-building') },
    setPlacement(active: boolean, hint = '选择放置位置') {
      get('placement-status').hidden = !active; get('placement-hint').textContent = hint;
      get('building-toggle').classList.toggle('active', active);
    },
    addResidentLabel(id: string, name: string, leader = false) {
      const label = document.createElement('span');
      label.className = 'resident-label'; label.dataset.resident = id; label.textContent = name;
      label.classList.toggle('enemy-label', id.startsWith('enemy-') || id.startsWith('wolf-'));
      if (leader) { label.classList.add('resident-leader'); label.title = '领头 · 参与作业并指挥同职业居民'; }
      get('resident-labels').append(label);
      residentLabels.set(id, label); residentSizeObserver.observe(label);
      return label;
    },
    removeResidentLabel(id: string) {
      const label = residentLabels.get(id); if (label) { residentSizeObserver.unobserve(label); residentSizes.delete(label); label.remove(); }
      residentLabels.delete(id); healthIndicators.delete(id);
    },
    setRaidNotice(text: string) {
      const notice = get('raid-notice'); notice.hidden = !text;
      if (notice.textContent !== text) notice.textContent = text;
    },
    flashAttackTarget(id: string, seconds: number) { attackPulseId = id; attackPulseAt = seconds; },
    setAttackTarget(id: string | undefined, seconds: number) {
      const label = id ? residentLabels.get(id) : undefined;
      if (!label) { attackMarker.remove(); return; }
      if (attackMarker.parentElement !== label) label.prepend(attackMarker);
      const pulse = id === attackPulseId ? Math.max(0, Math.min(1, 1 - (seconds - attackPulseAt) / .7)) : 0;
      attackMarker.style.transform = `scale(${(1 + pulse * .65).toFixed(3)})`;
      attackMarker.style.opacity = String(pulse > 0 ? .7 + .3 * Math.cos(pulse * Math.PI * 4) : 1);
    },
    setCombatHint(active: boolean) { if (active) get('resident-hint').textContent = '点敌人攻击 · 点空地移动'; },
    setInspectedUnits(ids:readonly string[]) {
      const key=ids.join(',');if(key===inspectionKey)return;inspectionKey=key;inspectedUnits=new Set(ids);
      for (const [id, { state, bar }] of healthIndicators) bar.hidden = !(state.visible || inspectedUnits.has(id));
    },
    setUnitHealth(id: string, hp: number, maximum: number, seconds: number, labelId = id) {
      const label = residentLabels.get(labelId); if (!label) return;
      let indicator = healthIndicators.get(id);
      if (!indicator) {
        let bars = label.querySelector('.resident-health-bars');
        if (!bars) { bars = document.createElement('span'); bars.className = 'resident-health-bars'; label.append(bars); }
        const bar = document.createElement('span'), fill = document.createElement('span');
        bar.className = 'resident-health'; bar.dataset.health = id; bar.hidden = true;
        bar.setAttribute('role', 'meter'); bar.setAttribute('aria-label', id === labelId ? `${label.textContent}生命` : '坐骑生命');
        bar.setAttribute('aria-valuemin', '0'); bar.append(fill); bars.append(bar);
        indicator = { state: new HealthIndicator(), bar, fill }; healthIndicators.set(id, indicator);
      }
      const { state, bar, fill } = indicator;
      state.update(hp, maximum, seconds);
      const visible = state.visible || inspectedUnits.has(id) || inspectedUnits.has(labelId);
      if (bar.hidden === visible) bar.hidden = !visible;
      const scale = `scaleX(${state.fraction.toFixed(4)})`;
      if (fill.style.transform !== scale) fill.style.transform = scale;
      const current = String(Math.ceil(hp)), max = String(maximum);
      if (bar.getAttribute('aria-valuenow') !== current) bar.setAttribute('aria-valuenow', current);
      if (bar.getAttribute('aria-valuemax') !== max) bar.setAttribute('aria-valuemax', max);
    },
    sayResident(id: string, text: string, duration = 3.5) {
      if (!bubbles.has(id)) { const bubble = document.createElement('span'); bubble.className = 'resident-speech'; bubble.dataset.speaker = id; bubble.hidden = true; get('resident-labels').append(bubble); bubbles.set(id, bubble); }
      speech.say(id, text, duration);
    },
    clearResidentSpeech(id: string) { speech.clear(id); const bubble = bubbles.get(id); if (bubble) { bubble.hidden = true; bubble.textContent = ''; } },
    advanceSpeech(seconds: number) { speech.advance(seconds); },
    positionSpeech(id: string, x: number, y: number, visible: boolean) {
      const bubble = bubbles.get(id); if (!bubble) return;
      const text = speech.current(id), hidden = !text || !visible;
      if (bubble.hidden !== hidden) bubble.hidden = hidden;
      if (bubble.hidden) return;
      if (bubble.textContent !== text) bubble.textContent = text!;
      const label = residentLabels.get(id), nameHeight = residentSize(label).height;
      const healthRows = label?.querySelectorAll('.resident-health:not([hidden])').length ?? 0;
      const gap = healthRows ? healthRows * 10 + 11 : 12; // clear the larger bars and 6px speech tail
      const transform = `translate(${x.toFixed(2)}px, ${(y - nameHeight - gap).toFixed(2)}px) translate(-50%, -100%)`;
      if (bubble.style.transform !== transform) bubble.style.transform = transform;
    },
    bindMap(pick:(x:number,y:number)=>void,close:()=>void){onMapPick=pick;onMapClose=close;},
    minimapCanvas: get<HTMLCanvasElement>('minimap'),
    get minimapOpen() { return !minimapPanel.hidden||fullMap.open; },
    get fullMapOpen() { return fullMap.open; },
    get paused() { return loading || backgroundPaused || dialogs.some(dialog => dialog.open); },
    pauseForBackground() { backgroundPaused = true; if (!loading) showBackgroundPause(); },
    bindPause(callback: () => void) { onPauseChange = callback; },
    bindShadows(enabled: boolean, callback: (enabled: boolean) => void) {
      const toggle = get<HTMLInputElement>('shadows-enabled'); toggle.checked = enabled;
      toggle.addEventListener('change', () => { get('graphics-notice').hidden = true; callback(toggle.checked); }, options);
    },
    bindPerformanceMode(initial:PerformanceMode,callback:(mode:PerformanceMode)=>void) {
      const select=get<HTMLSelectElement>('performance-mode');select.value=initial;
      const controls=()=>{get<HTMLInputElement>('shadows-enabled').disabled=select.value==='minimum';get('shadows-enabled').parentElement!.querySelector('small')!.textContent=select.value==='minimum'?'强省电下关闭，切回后恢复开关偏好':'关闭可减轻设备负担';};
      controls();select.addEventListener('change',()=>{controls();callback(select.value as PerformanceMode);},options);
    },
    bindLighting(initial: LightingSettings, callback: (settings: LightingSettings) => void) {
      const environment = get<HTMLInputElement>('environment-light'), sunlight = get<HTMLInputElement>('sunlight'), color = get<HTMLInputElement>('sun-color');
      const show = (value: LightingSettings) => {
        environment.value = String(value.environment); sunlight.value = String(value.sunlight); color.value = value.sunColor;
        get('environment-light-value').textContent = value.environment.toFixed(2);
        get('sunlight-value').textContent = value.sunlight.toFixed(2);
      };
      show(initial);
      const update = () => {
        get('graphics-notice').hidden = true;
        const value = normalizeLighting({ environment: environment.valueAsNumber, sunlight: sunlight.valueAsNumber, sunColor: color.value });
        show(value); callback(value);
      };
      for (const input of [environment, sunlight, color]) input.addEventListener('input', update, options);
      get('reset-lighting').addEventListener('click', () => { get('graphics-notice').hidden = true; show(DEFAULT_LIGHTING); callback({ ...DEFAULT_LIGHTING }); }, options);
    },
    settingsNotice(text: string) {
      const notice = get(graphics.open ? 'graphics-notice' : 'settings-notice');
      notice.textContent = text; notice.hidden = false;
    },
    bindLeadership(callback: (enabled: boolean) => void) {
      const toggle = get<HTMLInputElement>('leader-command-enabled');
      toggle.addEventListener('change', () => { callback(toggle.checked); focusGame(); }, options);
    },
    setLeadership(enabled: boolean) {
      for(const id of ['leader-command-enabled','population-command-enabled'])get<HTMLInputElement>(id).checked=enabled;
    },
    bindLeave(callback: (destination: 'menu' | 'exit') => void) { onLeave = callback; },
    bindDiagnostics(callback: () => unknown) { diagnostics = callback; },
    bindPerformanceRecord(callback: () => string|Promise<string>) { recordPerformance = callback; },
    saveFailed() { get('settings-notice').textContent = '未能保存进度，请检查浏览器存储后重试。当前游戏已保留。'; },
    get discoveredCount() { return discovered.size; },
    bind(id: string, callback: () => void) {
      get(id).addEventListener('click', () => { callback(); focusGame(); }, options);
    },
    confirmDemolition(name:string,description:string,action:()=>void){get('demolish-title').textContent=`拆除${name}`;get('demolish-description').textContent=description;confirmDemolition=action;showDialog(demolition);},
    openRecruitment() { showDialog(recruitment); },
    setNearby(landmark: Landmark | undefined) {
      if (nearby?.id === landmark?.id) return;
      nearby = landmark;
      get('landmark-prompt').hidden = !landmark;
      if (landmark) get('nearby-name').textContent = landmark.name;
    },
    ready() { loading = false; if (backgroundPaused) showBackgroundPause(); onPauseChange(); focusGame(); },
    bindEconomy(action: (id: string) => void, cancel: (id: number) => void) { onAction = action; onCancel = cancel; },
    setHomeStatus(population: number, time: string) {
      get('population').textContent = `人口 ${population}`;
      if (get('game-time').textContent !== time) get('game-time').textContent = time;
    },
    positionResidentLabel(id: string, x: number, y: number) {
      const label = residentLabels.get(id); if (!label) return;
      const transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) translate(-50%, -100%)`;
      if (label.style.transform !== transform) label.style.transform = transform;
    },
    setResources(values: { name: string; amount: number; capacity: number; reserved: number; ground?: number; transit?: number }[]) {
      const key = JSON.stringify(values); if (key === inventoryKey) return; inventoryKey = key;
      get('resource-summary').textContent = values.map(v => `${v.name.slice(0, 1)} ${v.amount}`).join(' · ');
      get('inventory').replaceChildren(...values.map(value => {
        const cell = document.createElement('span');
        cell.textContent = `${value.name} ${value.amount}/${value.capacity}`;
        cell.title = `容量 ${value.capacity}，预留 ${value.reserved}，可用 ${value.amount - value.reserved}`;
        const detail = document.createElement('small'); detail.textContent = `可用 ${value.amount - value.reserved} · 预留 ${value.reserved} · 地面 ${value.ground ?? 0} · 在途 ${value.transit ?? 0}`; cell.append(detail);
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
      card.hidden=!details;objectLabel.hidden=!details;actionsPanel.hidden=!details?.actions?.length;syncSelection();
      if(!details)return;
      card.setAttribute('aria-label', `${details.name}的信息`);
      setText(get('selection-name'),details.name);setText(get('selection-kind'),details.kind);setText(objectName,details.name);
      objectBar.hidden=!details.health;
      if(details.health){const {value,maximum}=details.health;objectFill.style.transform=`scaleX(${Math.max(0,Math.min(1,value/maximum))})`;objectBar.setAttribute('aria-valuenow',String(Math.ceil(value)));objectBar.setAttribute('aria-valuemax',String(maximum));}
      const message = get('selection-hint');
      message.hidden = details.hint==='暂无可用操作';
      if (!message.hidden && message.textContent !== details.hint) message.textContent = details.hint;
      const actions = details.actions ?? [], key = JSON.stringify(actions);
      if (key !== actionsKey) {
        actionsKey = key;residentSizes.delete(actionsPanel);
        get('selection-actions').replaceChildren(...actions.map(action => {
          const button = document.createElement('button'); button.dataset.action = action.id; button.textContent = action.label; button.disabled = !!action.disabled; return button;
        }));
      }

    },
    positionSelection: (x: number, y: number, visible: boolean) => positionOverlay(objectLabel, x, y, visible),
    positionObjectActions:(x:number,y:number,visible:boolean)=>positionOverlay(actionsPanel,x,y,visible),
    setResident(name?: string, canWork = false, leadership?: boolean) {
      residentName=name??'';if(!name)residentInfo=undefined;syncSelection();
      get('resident-name').textContent = name === '农民·领头' ? '领头' : name ?? '';
      get('resident-name').title = name ?? '';
      get('resident-hint').textContent = canWork ? '点空地移动 · 点目标作业' : '点空地指挥移动';
      get('leader-command-control').hidden = leadership === undefined;
      get<HTMLInputElement>('leader-command-enabled').checked = leadership ?? false;syncSelection();
    },
    setResidentInfo(info?: UnitInfo) {
      if(info?.id!==residentInfo?.id)get<HTMLDetailsElement>('unit-details').open=false;
      residentInfo=info;syncSelection();if(!info)return;
      get('resident-selection').dataset.unit = info.id;
      get('resident-selection').classList.toggle('enemy-info',!!info.enemy);
      setText(get('resident-activity'), info.activity);
      const rank=get('resident-level');rank.hidden=!info.progression;setText(rank,info.progression?`${info.progression.level}级`:'');
      const progression=info.progression;
      setText(get('unit-attributes'),`攻击 ${info.attack??'—'} · 防御 ${info.armor??'—'}${progression?` · ${progression.required?`经验 ${Math.floor(progression.progress)} / ${progression.required}`:'已满级'}`:''}`);
      for (const [index, elements] of vitalRows.entries()) {
        const data = info.meters[index]; elements.row.hidden = !data; if (!data) continue;
        const value = Math.max(0, Math.min(data.maximum, data.value)), fraction = value / data.maximum;
        const shown = data.kind === 'health' ? Math.ceil(value) : Math.floor(value);
        setText(elements.value, `${shown}/${data.maximum}`);
        elements.row.dataset.vital = data.id; elements.row.dataset.kind = data.kind;
        elements.row.classList.toggle('low', fraction < .3);
        const transform = `scaleX(${fraction.toFixed(4)})`;
        if (elements.fill.style.transform !== transform) elements.fill.style.transform = transform;
        for (const [name, text] of Object.entries({ 'aria-label': data.label, 'aria-valuenow': String(shown), 'aria-valuemax': String(data.maximum) })) {
          if (elements.meter.getAttribute(name) !== text) elements.meter.setAttribute(name, text);
        }
      }
    },
    setPerformance(sample?: FrameSample, triangles?: number, heapMB: number | null = null) {
      get('fps-value').textContent = sample ? sample.fps.toFixed(1) : '—';
      get('cpu-value').textContent = sample ? sample.cpuMs.toFixed(2) : '—';
      get('triangles-value').textContent = triangles === undefined ? '—'
        : triangles >= 10000 ? `${(triangles / 10000).toFixed(1)}万` : Math.round(triangles).toLocaleString('zh-CN');
      get('memory-value').textContent = heapMB === null ? '—' : heapMB.toFixed(1);
    },
    toast(message: string) {
      clearTimeout(toastTimer);
      get('toast').textContent = message; get('toast').classList.add('visible');
      toastTimer = setTimeout(() => get('toast').classList.remove('visible'), 2200);
    },
    targetHint(message: string, anchor: { x: number; y: number; z: number }, persistent = false) {
      clearTimeout(hintTimer); hintAnchor = { ...anchor }; hintPersistent = persistent;
      if (hint.textContent !== message || hint.hidden) hint.textContent = message;
      if (hint.hidden) hint.style.visibility = 'hidden';
      hint.hidden = false;
      if (!persistent) hintTimer = setTimeout(() => { hint.hidden = true; hintAnchor = undefined; }, 2200);
    },
    clearTargetHint(persistentOnly = false) {
      if (persistentOnly && !hintPersistent) return;
      clearTimeout(hintTimer); hint.hidden = true; hintAnchor = undefined;
    },
    get hintAnchor() { return hintAnchor; },
    positionHint: (x: number, y: number, visible: boolean) => positionOverlay(hint, x, y-(actionsPanel.hidden?0:residentSize(actionsPanel).height+8), visible),
    dispose() { abort.abort(); infoObserver.disconnect();residentSizeObserver.disconnect();mapGestures.dispose(); clearTimeout(toastTimer); clearTimeout(hintTimer); for (const dialog of dialogs) dialog.close(); },
  };
}

export type GameUI = ReturnType<typeof createUI>;
