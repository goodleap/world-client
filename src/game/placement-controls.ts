import type { GameUI } from '../ui.ts';
import type { BuildingKind } from './construction.ts';
export interface PlacementCallbacks {
  toggle():void;cancel():void;begin(kind:BuildingKind):void;
  preview(x:number,y:number,overCanvas:boolean):void;place(x:number,y:number,overCanvas:boolean):void;
}
export interface PlacementControls {
  bind(callbacks:PlacementCallbacks):void;showPalette(show:boolean):void;
  budget(rows:{kind:BuildingKind;shortage:string}[]):void;dispose():void;
}
/** DOM capture/native scrolling stays on the browser thread. */
export function createPlacementControls(ui:GameUI):PlacementControls{
  const {toggle,palette,choices,cancel}=ui.constructionControls,abort=new AbortController(),options={signal:abort.signal};
  const costs=choices.map(c=>c.querySelector<HTMLElement>('.building-cost')!),labels=costs.map(c=>c.textContent!);
  let callbacks:PlacementCallbacks|undefined;
  let pointer:{id:number;x:number;y:number;scrollLeft:number;touch:boolean;mode:'pending'|'scroll'|'place'}|undefined;
  const over=(x:number,y:number)=>document.elementFromPoint(x,y)===ui.canvas;
  const showPalette=(show:boolean)=>{palette.hidden=!show;toggle.setAttribute('aria-expanded',String(show));};
  toggle.addEventListener('click',()=>{callbacks?.toggle();ui.canvas.focus({preventScroll:true});},options);
  cancel.addEventListener('click',()=>callbacks?.cancel(),options);
  for(const choice of choices){
    const kind=choice.dataset.building as BuildingKind;
    choice.addEventListener('pointerdown',e=>{
      if(e.button!==0||ui.paused||choice.disabled)return;
      if(e.pointerType!=='touch')e.preventDefault();choice.setPointerCapture(e.pointerId);
      pointer={id:e.pointerId,x:e.clientX,y:e.clientY,scrollLeft:palette.scrollLeft,touch:e.pointerType==='touch',mode:'pending'};
    },options);
    choice.addEventListener('pointermove',e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
      if(pointer.mode==='pending'&&Math.hypot(dx,dy)>=8){
        pointer.mode=(pointer.touch||palette.scrollWidth>palette.clientWidth)&&Math.abs(dx)>Math.abs(dy)?'scroll':'place';
        if(pointer.mode==='place')callbacks?.begin(kind);
      }
      if(pointer.mode==='scroll'&&!pointer.touch)palette.scrollLeft=pointer.scrollLeft-dx;
      if(pointer.mode==='place')callbacks?.preview(e.clientX,e.clientY,over(e.clientX,e.clientY));
    },options);
    choice.addEventListener('pointerup',e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      const mode=pointer.mode;pointer=undefined;if(mode==='scroll')return;
      if(mode==='place')callbacks?.place(e.clientX,e.clientY,over(e.clientX,e.clientY));else callbacks?.begin(kind);
      showPalette(false);ui.canvas.focus({preventScroll:true});
    },options);
    choice.addEventListener('pointercancel',()=>{if(pointer?.mode==='place')callbacks?.cancel();pointer=undefined;},options);
    choice.addEventListener('click',e=>{if(e.detail===0){callbacks?.begin(kind);showPalette(false);}},options);
  }
  window.addEventListener('pointermove',e=>{if(!pointer)callbacks?.preview(e.clientX,e.clientY,over(e.clientX,e.clientY));},options);
  window.addEventListener('blur',()=>{pointer=undefined;callbacks?.cancel();},options);
  return {bind(value){callbacks=value;},showPalette,budget(rows){
    for(const [i,choice]of choices.entries()){
      const shortage=rows.find(r=>r.kind===choice.dataset.building)?.shortage??'';
      choice.disabled=!!shortage;choice.title=shortage;costs[i].textContent=shortage?shortage.replace('、','\n'):labels[i];
    }
  },dispose(){abort.abort();}};
}
