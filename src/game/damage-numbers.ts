export interface DamageNumber { target:string; amount:number; team:'home'|'enemy'; point:{x:number;y:number;z:number} }

/** A bounded DOM overlay, projected by Babylon's existing camera. No meshes,
 * textures or independent timer; the caller supplies the paused visual clock. */
export function createDamageNumbers(host:HTMLElement) {
  const limit=32,duration=.7;
  const slots:{node:HTMLElement;hit:DamageNumber;start:number;lift:number;width:number;x:number;y:number;placed:boolean}[]=[];
  let shown=0;
  return {
    add(hit:DamageNumber,time:number,visible:boolean){
      if(!visible||!Number.isFinite(hit.amount)||hit.amount<=0)return;
      let slot=slots.find(s=>s.node.hidden);
      if(!slot&&slots.length<limit){
        const node=document.createElement('span');node.className='damage-number';node.hidden=true;host.append(node);
        slot={node,hit,start:time,lift:0,width:0,x:0,y:0,placed:false};slots.push(slot);
      }
      slot??=slots.reduce((a,b)=>a.start<b.start?a:b);
      slot.hit=hit;slot.start=time;slot.lift=0;slot.placed=false;shown++;
      const rounded=Math.round(hit.amount*10)/10;
      slot.node.textContent=rounded?String(rounded):'<0.1';slot.width=slot.node.textContent.length*11+4;
      slot.node.classList.toggle('home-damage',hit.team==='home');slot.node.hidden=false;
    },
    update(time:number,project:(point:DamageNumber['point'])=>{x:number;y:number;visible:boolean}){
      for(const s of slots){
        if(s.node.hidden)continue;
        const elapsed=Math.max(0,time-s.start);
        if(elapsed>=duration){s.node.hidden=true;continue;}
        const p=project(s.hit.point);
        if(!p.visible){s.node.hidden=true;continue;}
        if(!s.placed){
          // Choose a vertical offset once, so simultaneous nearby hits remain
          // legible without jumping when another number expires. The bound is
          // conservative for the fixed 18px font; no DOM layout reads needed.
          let bottom=p.y-30;
          const blockers=slots.filter(other=>other!==s&&!other.node.hidden&&other.placed&&Math.abs(other.x-p.x)<(other.width+s.width)/2).sort((a,b)=>b.y-a.y);
          for(const other of blockers)if(Math.abs(bottom-other.y)<22)bottom=other.y-22;
          s.lift=p.y-30-bottom;s.placed=true;
        }
        s.x=p.x;s.y=p.y-30-s.lift-elapsed*44;
        s.node.style.transform=`translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px) translate(-50%,-100%)`;
        s.node.style.opacity=String(Math.min(1,(duration-elapsed)/.25));
      }
    },
    snapshot:()=>({shown,active:slots.filter(s=>!s.node.hidden).length,allocated:slots.length}),
    dispose(){for(const s of slots)s.node.remove();slots.length=0;},
  };
}
