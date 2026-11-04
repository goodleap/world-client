/** The full map owns its transform; these gestures never touch the world camera. */
export function createMapGestures(viewport:HTMLElement,canvas:HTMLCanvasElement,options:AddEventListenerOptions) {
  let zoom=1,x=0,y=0,width=0,height=0,size=0;
  const pointers=new Map<number,{x:number;y:number}>();
  const draw=()=>{
    const maxX=Math.max(0,(size*zoom-width)/2),maxY=Math.max(0,(size*zoom-height)/2);
    x=Math.max(-maxX,Math.min(maxX,x));y=Math.max(-maxY,Math.min(maxY,y));
    canvas.style.transform=`translate(${x}px,${y}px) scale(${zoom})`;
    viewport.dataset.zoom=zoom.toFixed(3);
  };
  const resize=()=>{const r=viewport.getBoundingClientRect();width=r.width;height=r.height;size=Math.min(width,height);if(size)canvas.style.width=`${size}px`;draw();};
  const observer=new ResizeObserver(resize);observer.observe(viewport);
  const center=()=>{const ps=[...pointers.values()];return {x:ps.reduce((s,p)=>s+p.x,0)/ps.length,y:ps.reduce((s,p)=>s+p.y,0)/ps.length,d:ps.length>1?Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y):0};};
  const changeZoom=(next:number,px:number,py:number)=>{next=Math.max(1,Math.min(4,next));const ratio=next/zoom;x=px-(px-x)*ratio;y=py-(py-y)*ratio;zoom=next;};
  const local=(event:PointerEvent)=>{const r=viewport.getBoundingClientRect();return {x:event.clientX-r.left-width/2,y:event.clientY-r.top-height/2};};
  viewport.addEventListener('pointerdown',event=>{if(event.button!==0||pointers.size>=2)return;event.preventDefault();pointers.set(event.pointerId,local(event));viewport.setPointerCapture(event.pointerId);},options);
  viewport.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;event.preventDefault();
    const before=center();pointers.set(event.pointerId,local(event));const after=center();
    if(before.d>1&&after.d>1)changeZoom(zoom*after.d/before.d,before.x,before.y);
    x+=after.x-before.x;y+=after.y-before.y;draw();
  },options);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(event,e=>{pointers.delete((e as PointerEvent).pointerId);},options);
  viewport.addEventListener('wheel',event=>{
    event.preventDefault();const r=viewport.getBoundingClientRect();
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?height:1);
    changeZoom(zoom*Math.exp(-delta*.002),event.clientX-r.left-width/2,event.clientY-r.top-height/2);draw();
  },{...options,passive:false});
  return {reset(){pointers.clear();zoom=1;x=y=0;canvas.style.transform='';canvas.style.width='';resize();},dispose(){observer.disconnect();pointers.clear();}};
}
