import type { Obstacle } from './movement.ts';

/** Authored set pieces and their actual solid parts. Arch openings and bridge
 * decks are walkable; scenery never silently adds a different collision hull. */
export function createMapLandmarks(grid:number) {
  const props=[
    {kind:'arch' as const,x:23*grid,z:29*grid},
    {kind:'wall' as const,x:26*grid,z:30*grid},
    {kind:'mine' as const,x:-40*grid,z:-12*grid},
    {kind:'tent' as const,x:18*grid,z:44*grid},
    {kind:'lookout' as const,x:20*grid,z:40*grid},
    {kind:'palisade' as const,x:18*grid,z:46*grid},
  ];
  const obstacles:Obstacle[]=props.flatMap(p=>{
    const box=(x:number,z:number,halfWidth:number,halfDepth:number):Obstacle=>({kind:'box',x,z,halfWidth,halfDepth});
    if(p.kind==='arch')return [-1,1].map(side=>box(p.x+side*1.45,p.z,.36,.46));
    if(p.kind==='mine')return [box(p.x,p.z+1.3,3,2)];
    const sizes={wall:[2.2,.38],tent:[2,1.9],lookout:[1.2,1.2],palisade:[4,.2]}[p.kind];
    return [box(p.x,p.z,sizes[0],sizes[1])];
  });
  return {props,obstacles};
}
