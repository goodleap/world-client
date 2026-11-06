import type { GameUI } from '../ui.ts';
import type { MovementInput } from './input.ts';
import type { createHomeManagement } from './home-management.ts';
import type { OverlayHost } from './overlay-host.ts';
import type { PlacementControls } from './placement-controls.ts';
export interface PlatformState{width:number;height:number;left:number;top:number;dpr:number;mobile:boolean;background:boolean}
export interface GamePlatform {
  readonly canvas:HTMLCanvasElement|OffscreenCanvas;
  readonly state:PlatformState;
  readonly thread:'main'|'render-worker';
  input(...args:Parameters<typeof MovementInputFactory>):Pick<MovementInput,'read'|'reset'|'dispose'|'isDragging'>;
  placement(ui:GameUI):PlacementControls;
  management(...args:Parameters<typeof createHomeManagement>):ReturnType<typeof createHomeManagement>;
  overlay():OverlayHost;
  persist(text:string):Promise<boolean>;
  checkpoint(text:string):void;
  subscribe(kind:'resize'|'visibility'|'escape',callback:()=>void):()=>void;
  flush():void;
}
// Extract constructor arguments without loading browser input code in a worker.
declare function MovementInputFactory(...args:ConstructorParameters<typeof MovementInput>):void;
