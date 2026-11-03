import { isBlocked } from './movement.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { inBounds, segmentIsClear } from './wander.ts';

export const PATH_CELL_SIZE = .5;

/** Stable binary min-heap: long routes must not scan the entire frontier for
 * every expanded cell. Entries superseded by a better score are discarded. */
class Frontier {
  private entries:{id:number;score:number;priority:number;order:number}[]=[];
  get length(){return this.entries.length;}
  private before(a:typeof this.entries[number],b:typeof this.entries[number]){return a.priority<b.priority||a.priority===b.priority&&a.order<b.order;}
  push(entry:typeof this.entries[number]){
    const a=this.entries;let i=a.length;a.push(entry);
    while(i){const p=(i-1)>>1;if(!this.before(entry,a[p]))break;a[i]=a[p];i=p;}a[i]=entry;
  }
  pop(){
    const a=this.entries,first=a[0],last=a.pop()!;if(!a.length)return first;
    let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&this.before(a[child+1],a[child]))child++;
      if(!this.before(a[child],last))break;a[i]=a[child];i=child;}a[i]=last;return first;
  }
}

/** Grid is only used for planning; the resulting waypoints are continuous world coordinates. */
export function findPath(start: Point, goal: Point, radius: number, bounds: Bounds, obstacles: readonly Obstacle[], cell = PATH_CELL_SIZE): Point[] | undefined {
  return findPathToGoals(start, [goal], radius, bounds, obstacles, cell);
}

/** Goals are ranked by the caller. Alternatives lie on this planner's grid.
 * One failed search already visits the entire reachable component: reuse its
 * parents for the nearest reachable alternative instead of running A* for
 * every candidate around a wall or disconnected patch of land. */
export function findPathToGoals(start: Point, goals: readonly Point[], radius: number, bounds: Bounds, obstacles: readonly Obstacle[], cell = PATH_CELL_SIZE): Point[] | undefined {
  const goal = goals[0]; if (!goal) return;
  if (!inBounds(goal, radius, bounds) || isBlocked(goal, radius, obstacles)) return undefined;
  const clear = (a: Point, b: Point) => segmentIsClear(a, b, radius, bounds, obstacles);
  if (clear(start, goal)) return [goal];
  const width = Math.floor((bounds.maxX - bounds.minX) / cell) + 1;
  const height = Math.floor((bounds.maxZ - bounds.minZ) / cell) + 1;
  const point = (id: number): Point => ({ x: bounds.minX + (id % width) * cell, z: bounds.minZ + Math.floor(id / width) * cell });
  const idOf = (p: Point) => Math.round((p.z - bounds.minZ) / cell) * width + Math.round((p.x - bounds.minX) / cell);
  const startId = idOf(start), endId = idOf(goal), total = width * height;
  if (startId < 0 || startId >= total || endId < 0 || endId >= total) return undefined;
  const scores = new Float64Array(total); scores.fill(Infinity); scores[startId] = 0;
  const parent = new Int32Array(total); parent.fill(-1);
  const closed = new Uint8Array(total),order=new Uint32Array(total);let serial=0;
  const open = new Frontier();
  const heuristic = (id: number) => Math.hypot(point(id).x - goal.x, point(id).z - goal.z);
  open.push({id:startId,score:0,priority:heuristic(startId),order:0});
  const routeTo = (current: number, destination: Point) => {
    const chain: Point[] = [destination];
    for (let id = current; id !== startId && id >= 0; id = parent[id]) chain.push(point(id));
    chain.reverse();
    const path: Point[] = []; let anchor = start;
    for (let i = 0; i < chain.length;) {
      let furthest = i;
      while (furthest + 1 < chain.length && segmentIsClear(anchor, chain[furthest + 1], radius, bounds, obstacles)) furthest++;
      anchor = chain[furthest]; path.push(anchor); i = furthest + 1;
    }
    return path;
  };
  while (open.length) {
    const entry=open.pop(),current=entry.id;
    if(closed[current]||entry.score!==scores[current])continue;
    closed[current] = 1;
    const here = current === startId ? start : point(current);
    if (clear(here, goal)) {
      return routeTo(current, goal);
    }
    const x = current % width, z = Math.floor(current / width);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      const next = nz * width + nx;
      if (closed[next]) continue;
      const dest = point(next);
      if (!clear(here, dest)) continue;
      const score = scores[current] + Math.hypot(dest.x - here.x, dest.z - here.z);
      if (score < scores[next]) {
        if(!order[next])order[next]=++serial;
        scores[next] = score; parent[next] = current;
        open.push({id:next,score,priority:score+heuristic(next),order:order[next]});
      }
    }
  }
  for (const candidate of goals.slice(1)) {
    const id = idOf(candidate);
    if (id < 0 || id >= total || !closed[id]) continue;
    const from = id === startId ? start : point(id);
    if (clear(from, candidate)) return routeTo(id, candidate);
  }
  return undefined;
}
