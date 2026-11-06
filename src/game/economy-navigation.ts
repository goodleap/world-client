import type { Economy } from './economy.ts';
import { economyObstacles,RESOURCE_NODES } from './economy-config.ts';
import { GRID_SIZE,BUILDINGS } from './world-data.ts';
import { immutableObstacles,combineObstacles } from './navigation-geometry.ts';
import type { Obstacle,Point } from './movement.ts';
/** Game work entrances and land permissions are data, independent of meshes. */
export function createEconomyNavigation(economy:Economy){
  let obstacles:readonly Obstacle[]=[],fields:readonly Obstacle[]=[],withFields:readonly Obstacle[]=[];
  function sync(){
    const next=economyObstacles(economy.state.depleted,economy.state.sites,economy.state.buildings);
    const plots=immutableObstacles(economy.state.plots.map(p=>({kind:'box' as const,x:p.x,z:p.z,halfWidth:GRID_SIZE/2,halfDepth:GRID_SIZE/2})),fields);
    if(next===obstacles&&plots===fields)return false;
    obstacles=next;fields=plots;withFields=combineObstacles(obstacles,fields);return true;
  }
  function workPoints(target: string, from?: Point, repair=false): { points: Point[]; target: Point } | undefined {
    if (target === 'warehouse'&&!repair) {
      const doors = economy.warehouseDoors().sort((a, b) => from ? Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z) : 0);
      if(!doors.length)return;
      return { target: doors[0], points: doors.flatMap(door => [door, { x: door.x - .8, z: door.z }, { x: door.x + .8, z: door.z }]) };
    }
    const goods = economy.state.goods.find(g => g.id === target);
    if (goods) return { target: goods, points: [{ x: goods.x, z: goods.z }] };
    const plot = economy.plot(target), node = RESOURCE_NODES.find(n => n.id === target), site = economy.state.sites.find(s => s.id === target)??(repair?BUILDINGS.find(b=>b.id===target):undefined);
    const source = plot ?? node ?? site; if (!source) return;
    if (site) return { target: site, points: [
      { x: site.x, z: site.z - site.depth / 2 - .65 }, { x: site.x - site.width / 2 - .65, z: site.z },
      { x: site.x + site.width / 2 + .65, z: site.z }, { x: site.x, z: site.z + site.depth / 2 + .65 },
    ] };
    const distance = node ? node.radius + .65 : GRID_SIZE / 2 + .12;
    return { target: source, points: Array.from({ length: 8 }, (_, i) => ({ x: source.x + Math.sin(i * Math.PI / 4) * distance, z: source.z + Math.cos(i * Math.PI / 4) * distance })) };
  }
  sync();return {sync,workPoints,obstacles:(avoidFields=false)=>avoidFields?withFields:obstacles};
}
