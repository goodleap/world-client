/** Only text/visibility/placement crosses the render boundary, never DOM nodes. */
export interface OverlayLabel {
  textContent:string|null;hidden:boolean|string;
  style:{transform:string;opacity:string};
  classList:{toggle:(name:string,on:boolean)=>unknown};
  remove():void;
}
export interface OverlayHost{create(className:string):OverlayLabel;remove():void}
export function createDOMOverlayHost(canvas:HTMLCanvasElement):OverlayHost{
  const host=document.createElement('div');host.className='damage-numbers';host.setAttribute('aria-hidden','true');canvas.parentElement!.append(host);
  return {create(className){const node=document.createElement('span');node.className=className;node.hidden=true;host.append(node);return node;},remove:()=>host.remove()};
}
