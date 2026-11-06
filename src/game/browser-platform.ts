import type { GameUI } from '../ui.ts';
import type { GamePlatform,PlatformState } from './game-platform.ts';
import { MovementInput } from './input.ts';
import { createPlacementControls } from './placement-controls.ts';
import { createHomeManagement } from './home-management.ts';
import { createDOMOverlayHost } from './overlay-host.ts';
import { ECONOMY_SAVE_KEY } from './economy-storage.ts';
export function browserState(canvas:HTMLCanvasElement):PlatformState{
  const r=canvas.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,top:r.top,dpr:devicePixelRatio||1,
    mobile:matchMedia('(pointer: coarse)').matches,background:document.hidden||!document.hasFocus()};
}
export function createBrowserPlatform(ui:GameUI):GamePlatform{
  return {canvas:ui.canvas,get state(){return browserState(ui.canvas);},thread:'main',
    input:(...args)=>new MovementInput(...args),placement:createPlacementControls,management:createHomeManagement,
    overlay:()=>createDOMOverlayHost(ui.canvas),async persist(text){try{localStorage.setItem(ECONOMY_SAVE_KEY,text);return true;}catch{return false;}},checkpoint(){},flush(){},
    subscribe(kind,callback){
      const abort=new AbortController(),options={signal:abort.signal};
      if(kind==='resize'){const observer=new ResizeObserver(callback);observer.observe(ui.canvas);return ()=>observer.disconnect();}
      if(kind==='escape')window.addEventListener('keydown',e=>{if(e.code==='Escape')callback();},options);
      else for(const name of ['visibilitychange','blur','focus','pagehide','pageshow','freeze','resume']){
        const target=['visibilitychange','freeze','resume'].includes(name)?document:window;target.addEventListener(name,callback,options);
      }
      return ()=>abort.abort();
    },
  };
}
