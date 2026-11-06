import type { GameUI } from '../ui.ts';
import type { Game } from './game.ts';
import { Economy } from './economy.ts';
import { ECONOMY_SAVE_KEY } from './economy-storage.ts';
import { loadingProgress } from '../loading-progress.ts';
import { createWorkerChannel } from './worker-channel.ts';
import { browserState } from './browser-platform.ts';
import { MovementInput } from './input.ts';
import { createPlacementControls } from './placement-controls.ts';
import type { PlacementCallbacks } from './placement-controls.ts';
import { createHomeManagement } from './home-management.ts';
import { createDOMOverlayHost } from './overlay-host.ts';
import type { OverlayLabel } from './overlay-host.ts';

type Frame=ReturnType<Game['frameSnapshot']>;
const uiState=(ui:GameUI)=>({paused:ui.paused,minimapOpen:ui.minimapOpen,fullMapOpen:ui.fullMapOpen,hintAnchor:ui.hintAnchor,discoveredCount:ui.discoveredCount});
let prepared:ReturnType<typeof prepareWorker>|undefined;
function prepareWorker(){
  const worker=new Worker(new URL('./render.worker.ts',import.meta.url),{type:'module'}),channel=createWorkerChannel(worker);
  let ui:GameUI|undefined,frame:Frame|undefined,recovery:string|undefined,disposed=false;
  let extra:(method:string,args:unknown[])=>unknown=()=>{throw new Error('Game UI is not ready');};
  const pushState=(kind?:string)=>{if(ui&&!disposed)channel.notify('state',[browserState(ui.canvas),uiState(ui),kind]);};
  channel.handle((method,args)=>{
    if(method==='loading'){for(const item of args[0] as ReturnType<typeof loadingProgress.snapshot>){loadingProgress.items.set(item.id,item);}loadingProgress.notify();return;}
    if(method==='frame'){frame=args[0] as Frame;return;}
    if(method==='checkpoint'){recovery=args[0] as string;return;}
    if(method==='persist'){recovery=args[0] as string;try{localStorage.setItem(ECONOMY_SAVE_KEY,recovery);return true;}catch{return false;}}
    if(method==='preference'){try{localStorage.setItem(args[0] as string,args[1] as string);}catch{ui?.settingsNotice('设置已生效，浏览器未能保存此偏好');}return;}
    if(method==='ui'){
      if(!ui)throw new Error('UI not attached');
      for(const call of args[0] as {method:string;args:unknown[]}[]){
        if(call.method.startsWith('$')){extra(call.method,call.args);continue;}
        const fn=ui[call.method as keyof GameUI];if(typeof fn!=='function')throw new Error(`Unknown UI method ${call.method}`);
        const safe=call.args.map(a=>typeof a==='function'? (...values:unknown[])=>{pushState();return Promise.resolve(a(...values)).catch(error=>{console.error(error);ui?.toast('操作未完成，请重试');});}:a);
        (fn as (...values:unknown[])=>unknown)(...safe);
      }
      pushState();return;
    }
    throw new Error(`Unknown browser request: ${method}`);
  });
  worker.addEventListener('error',event=>{console.error('Render worker failed:',event.message);channel.close(event.message||'Render worker failed');ui?.toast('游戏线程异常，请复制诊断后刷新');});
  const storage:Record<string,string>={};for(const k of ['world-lighting','world-shadows-enabled','world-performance-mode']){try{const v=localStorage.getItem(k);if(v!==null)storage[k]=v;}catch{/* preferences unavailable */}}
  const ready=channel.call('prepare',[{baseURI:document.baseURI,search:location.search,storage}],[],120_000);
  return {worker,channel,ready,pushState,get frame(){return frame;},attach(view:GameUI,handler:typeof extra){ui=view;extra=handler;},
    preserve(){if(recovery)try{localStorage.setItem(ECONOMY_SAVE_KEY,recovery);}catch{}},
    close(){disposed=true;channel.close();worker.terminate();if(prepared===this)prepared=undefined;},
  };
}
export async function preloadGameAssets(){
  if(typeof OffscreenCanvas==='undefined'){await (await import('./game.ts')).preloadGameAssets();return;}
  try{await (prepared??=prepareWorker()).ready;}catch(error){prepared?.close();throw error;}
}
export async function createGame(ui:GameUI,economy:Economy){
  if(!ui.canvas.transferControlToOffscreen||typeof OffscreenCanvas==='undefined'){
    const fallback=await import('./game.ts');const game=await fallback.createGame(ui,economy);
    return {...game,snapshot:async()=>game.snapshot(),diagnosticReport:async()=>game.diagnosticReport(),markPerformance:async()=>game.markPerformance()};
  }
  const runtime=prepared??=prepareWorker();await runtime.ready;
  const abort=new AbortController(),options={signal:abort.signal},labels=new Map<string,HTMLElement>(),overlays=new Map<number,OverlayLabel>();
  const overlay=createDOMOverlayHost(ui.canvas),placement=createPlacementControls(ui);
  let input:MovementInput|undefined,management:ReturnType<typeof createHomeManagement>|undefined;
  const mirror=new Economy(structuredClone(economy.state));
  let keyState:(direction:{x:number;z:number},dragging:boolean)=>unknown=()=>{};
  const updateInput=()=>{if(input)void keyState(input.read(),input.isDragging);};
  runtime.attach(ui,(method,args)=>{
    switch(method){
      case '$labelVisibility':{const label=labels.get(args[0] as string);if(label)label.hidden=!!args[1];return;}
      case '$overlayCreate':overlays.set(args[0] as number,overlay.create(args[1] as string));return;
      case '$overlaySet':{const [id,key,value]=args as [number,string,string|boolean],label=overlays.get(id);if(!label)return;if(key==='textContent')label.textContent=String(value);else if(key==='hidden')label.hidden=!!value;else if(key==='transform'||key==='opacity')label.style[key]=String(value);return;}
      case '$overlayClass':overlays.get(args[0] as number)?.classList.toggle(args[1] as string,args[2] as boolean);return;
      case '$overlayRemove':overlays.get(args[0] as number)?.remove();overlays.delete(args[0] as number);return;
      case '$overlayDispose':overlay.remove();return;
      case '$input':{
        const [zoom,pan,tap,pinch,keys]=args as [...ConstructorParameters<typeof MovementInput> extends [unknown,...infer R]?R:never,(direction:{x:number;z:number},dragging:boolean)=>unknown];
        const wrap=<A extends unknown[]>(fn:(...a:A)=>void)=>(...a:A)=>{runtime.pushState();fn(...a);updateInput();};
        input=new MovementInput(ui.canvas,wrap(zoom),wrap(pan),wrap(tap),wrap(pinch));keyState=keys;return;
      }
      case '$inputReset':input?.reset();updateInput();return;
      case '$inputDispose':input?.dispose();return;
      case '$placementBind':placement.bind(args[0] as PlacementCallbacks);return;
      case '$placementShow':placement.showPalette(!!args[0]);return;
      case '$placementBudget':placement.budget(args[0] as Parameters<typeof placement.budget>[0]);return;
      case '$placementDispose':placement.dispose();return;
      case '$managementBind':management=createHomeManagement(mirror,ui,args[0] as Parameters<typeof createHomeManagement>[2]);return;
      case '$managementState':Object.assign(mirror.state,args[0] as Economy['state']);mirror.revision++;management?.refresh(args[1] as number|undefined);return;
      case '$managementDispose':management?.dispose();return;
    }
    throw new Error(`Unknown control method ${method}`);
  });
  // Keep label ownership in one place, preserving all existing DOM layout code.
  const add=ui.addResidentLabel,remove=ui.removeResidentLabel;
  ui.addResidentLabel=(...args)=>{const label=add(...args);labels.set(args[0],label);return label;};
  ui.removeResidentLabel=id=>{labels.delete(id);remove(id);};
  const observer=new ResizeObserver(()=>runtime.pushState('resize'));observer.observe(ui.canvas);
  for(const name of ['visibilitychange','blur','focus','pagehide','pageshow','freeze','resume']){
    const target=['visibilitychange','freeze','resume'].includes(name)?document:window;
    target.addEventListener(name,()=>{if(['pagehide','freeze'].includes(name))runtime.preserve();runtime.pushState('visibility');},options);
  }
  for(const name of ['click','change','input','keydown','keyup','pointerup','pointercancel'])document.addEventListener(name,()=>queueMicrotask(()=>{runtime.pushState();updateInput();}),options);
  window.addEventListener('keydown',e=>{if(e.code==='Escape')runtime.pushState('escape');},options);
  const canvas=ui.canvas.transferControlToOffscreen(),minimap=ui.minimapCanvas.transferControlToOffscreen();
  try{await runtime.channel.call('start',[canvas,minimap,economy.state,browserState(ui.canvas),uiState(ui)],[canvas,minimap],120_000);}catch(error){abort.abort();observer.disconnect();runtime.close();throw error;}
  const invoke=<K extends keyof Game>(name:K)=>runtime.channel.call('game',[name]) as Promise<Awaited<ReturnType<Game[K]>>>;
  return {
    save:()=>invoke('save'),diagnosticReport:()=>invoke('diagnosticReport'),markPerformance:()=>invoke('markPerformance'),snapshot:()=>invoke('snapshot'),
    frameSnapshot:()=>runtime.frame!,
    dispose(){abort.abort();observer.disconnect();input?.dispose();placement.dispose();management?.dispose();overlay.remove();
      ui.addResidentLabel=add;ui.removeResidentLabel=remove;runtime.preserve();void invoke('dispose').catch(()=>{}).finally(()=>runtime.close());},
  };
}
export type WorkerGame=Awaited<ReturnType<typeof createGame>>;
