import { createWorkerChannel } from './worker-channel.ts';
import type { ChannelTransport } from './worker-channel.ts';
import { setRuntimeContext } from './runtime-context.ts';
import { loadingProgress } from '../loading-progress.ts';
import type { GameUI } from '../ui.ts';
import type { GamePlatform,PlatformState } from './game-platform.ts';
import type { Game } from './game.ts';
import type { OverlayHost,OverlayLabel } from './overlay-host.ts';
import { Economy } from './economy.ts';
import { applyHomeAction } from './home-actions.ts';
import type { HomeAction } from './home-actions.ts';

type UIState=Pick<GameUI,'paused'|'minimapOpen'|'fullMapOpen'|'hintAnchor'|'discoveredCount'>;
const channel=createWorkerChannel(self as unknown as ChannelTransport);
let state:PlatformState,uiState:UIState,game:Game|undefined;
const listeners=new Map<string,Set<()=>void>>();
let modulePromise:Promise<typeof import('./game.ts')>|undefined;
let progressTimer:ReturnType<typeof setTimeout>|undefined;
loadingProgress.subscribe(()=>{progressTimer??=setTimeout(()=>{progressTimer=undefined;channel.notify('loading',[loadingProgress.snapshot()]);},50);});
const prepare=()=>modulePromise??=import('./game.ts');
let pending:{method:string;args:unknown[]}[]=[],flushQueued=false;
function flush(){flushQueued=false;if(!pending.length)return;const calls=pending;pending=[];channel.notify('ui',[calls]);}
function callUI(method:string,...args:unknown[]){pending.push({method,args});if(!flushQueued){flushQueued=true;queueMicrotask(flush);}}
let overlayId=0;
const overlay:OverlayHost={create(className){
  const id=++overlayId;callUI('$overlayCreate',id,className);
  const values={textContent:'',hidden:true,transform:'',opacity:''};
  const update=(key:keyof typeof values,value:string|boolean)=>{if(values[key]===value)return;Object.assign(values,{[key]:value});callUI('$overlaySet',id,key,value);};
  return {get textContent(){return values.textContent;},set textContent(v){update('textContent',v??'');},get hidden(){return values.hidden;},set hidden(v){update('hidden',!!v);},
    style:{get transform(){return values.transform;},set transform(v){update('transform',v);},get opacity(){return values.opacity;},set opacity(v){update('opacity',v);}},
    classList:{toggle(name,on){callUI('$overlayClass',id,name,on);}},remove(){callUI('$overlayRemove',id);}} satisfies OverlayLabel;
},remove(){callUI('$overlayDispose');}};
channel.handle(async(method,args)=>{
  if(method==='prepare'){
    const [context]=args as [{baseURI:string;search:string;storage:Record<string,string>}];
    const values=context.storage;
    setRuntimeContext({...context,storage:{getItem:k=>values[k]??null,setItem(k,v){values[k]=v;channel.notify('preference',[k,v]);}}});
    const m=await prepare();await m.preloadGameAssets();return;
  }
  if(method==='state'){
    const [next,ui,kind]=args as [PlatformState,UIState,string|undefined];state=next;uiState=ui;
    if(kind)for(const listener of listeners.get(kind)??[])listener();return;
  }
  if(method==='start'){
    const [canvas,minimap,economyState,initial,initialUI]=args as [OffscreenCanvas,OffscreenCanvas,Economy['state'],PlatformState,UIState];
    state=initial;uiState=initialUI;
    const surface={get clientWidth(){return state.width;},get clientHeight(){return state.height;},
      getBoundingClientRect(){return {left:state.left,top:state.top,width:state.width,height:state.height};}};
    const ui=new Proxy({} as GameUI,{get(_target,name:string){
      if(name==='canvas')return surface;if(name==='minimapCanvas')return minimap;
      if(Object.hasOwn(uiState,name))return uiState[name as keyof UIState];
      if(name==='addResidentLabel')return (id:string,label:string,leader:boolean)=>{
        callUI(name,id,label,leader);let hidden=false;return {get hidden(){return hidden;},set hidden(value:boolean){if(hidden===value)return;hidden=value;callUI('$labelVisibility',id,hidden);}};
      };
      return (...values:unknown[])=>callUI(name,...values);
    }});
    const platform:GamePlatform={canvas,get state(){return state;},thread:'render-worker',overlay:()=>overlay,
      persist:async text=>!!await channel.call('persist',[text]),checkpoint:text=>channel.notify('checkpoint',[text]),
      subscribe(kind,callback){let set=listeners.get(kind);if(!set)listeners.set(kind,set=new Set());set.add(callback);return ()=>set.delete(callback);},
      input(_canvas,zoom,pan,tap,pinch){
        let keys={x:0,z:0},dragging=false;
        callUI('$input',zoom,pan,tap,pinch,(direction:{x:number;z:number},drag:boolean)=>{keys=direction;dragging=drag;});
        return {read:()=>keys,get isDragging(){return dragging;},reset(){keys={x:0,z:0};dragging=false;callUI('$inputReset');},dispose(){callUI('$inputDispose');}};
      },
      placement(){return {bind(callbacks){callUI('$placementBind',callbacks);},showPalette:show=>callUI('$placementShow',show),budget:rows=>callUI('$placementBudget',rows),dispose:()=>callUI('$placementDispose')};},
      management(e,view,callbacks){
        let previous='';
        const refresh=(selected?:number)=>{
          const key=JSON.stringify([e.state.groups,selected]);
          if(!view.paused&&key===previous)return;previous=key;
          callUI('$managementState',e.state,selected);
        };
        callUI('$managementBind',{...callbacks,action:async(a:HomeAction)=>{const message=callbacks.action?await callbacks.action(a):applyHomeAction(e,a);previous='';refresh();flush();return message;}});
        return {refresh,open(){previous='';refresh();view.openRecruitment();},dispose:()=>callUI('$managementDispose')};
      },
      flush(){flush();if(game){channel.notify('frame',[game.frameSnapshot()]);}},
    };
    game=await (await prepare()).createGame(ui,new Economy(economyState),platform);flush();
    channel.notify('frame',[game.frameSnapshot()]);return;
  }
  if(method==='game'){
    if(!game)throw new Error('Game is not ready');
    const [name]=args as [keyof Game];
    if(!['save','snapshot','diagnosticReport','markPerformance','dispose'].includes(name))throw new Error('Unknown game method');
    const result=await game[name]();flush();return result;
  }
  throw new Error(`Unknown render request: ${method}`);
});
