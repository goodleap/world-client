import type { Obstacle, Point } from './movement.ts';
import { WORLD_BOUNDS } from './world-data.ts';

export const DANGER_CONFIG = { interval: .5, safeSeconds: 10, buffer: 2, cellSize: 4 } as const;
export interface DangerZone extends Point { id: string; radius: number; safeSince?: number }
export interface AreaThreat extends Point { id: string; radius: number; fixed?: boolean }

/** Shared spatial memory, independent of worker/task identity and line of sight.
 * Fixed camps keep their territory. Moving threats leave short-lived area marks,
 * so switching jobs, walking behind a tree or fleeing briefly cannot clear it. */
export function updateDangerZones(zones: DangerZone[], threats: readonly AreaThreat[], seconds: number) {
  let cleared = false;
  const byId = new Map(zones.map(z => [z.id, z]));
  const active = new Set<string>();
  const fixed = threats.filter(t=>t.fixed);
  for (const threat of threats) {
    if (!threat.fixed && fixed.some(t=>Math.hypot(t.x-threat.x,t.z-threat.z)+threat.radius<=t.radius)) continue;
    const step = DANGER_CONFIG.cellSize;
    const x = threat.fixed ? threat.x : Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, Math.round(threat.x / step) * step));
    const z = threat.fixed ? threat.z : Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, Math.round(threat.z / step) * step));
    const id = threat.fixed ? threat.id : `area:${x}:${z}`;
    const radius = threat.radius + (threat.fixed ? 0 : Math.SQRT2 * step / 2);
    const zone = byId.get(id);
    if (zone) { zone.radius = Math.max(zone.radius, radius); zone.safeSince = undefined; }
    else { const added = { id, x, z, radius }; zones.push(added); byId.set(id, added); }
    active.add(id);
  }
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i];
    // Current threats already own their full alert areas. Only their actual
    // presence in this old mark (plus its edge buffer) renews its memory.
    if (active.has(zone.id) || threats.some(t => !t.fixed && Math.hypot(t.x-zone.x,t.z-zone.z) <= zone.radius+DANGER_CONFIG.buffer)) {
      zone.safeSince = undefined; continue;
    }
    zone.safeSince ??= seconds;
    if (seconds - zone.safeSince >= DANGER_CONFIG.safeSeconds) { zones.splice(i, 1); cleared = true; }
  }
  return cleared;
}

export function pathInDanger(zones: readonly DangerZone[], points: readonly Point[]) {
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i-1)], b = points[i], dx=b.x-a.x, dz=b.z-a.z, length=dx*dx+dz*dz;
    for (const zone of zones) {
      const t=length?Math.max(0,Math.min(1,((zone.x-a.x)*dx+(zone.z-a.z)*dz)/length)):0;
      if ((a.x+dx*t-zone.x)**2+(a.z+dz*t-zone.z)**2 <= zone.radius**2) return true;
    }
  }
  return false;
}
export const dangerObstacles = (zones: readonly DangerZone[]): Obstacle[] => zones.map(z => ({ kind:'circle', x:z.x, z:z.z, radius:z.radius }));

export function decodeDangerZones(raw: unknown, seconds: number): DangerZone[] {
  if (!Array.isArray(raw) || raw.length > 4096 || new Set(raw.map(z=>z?.id)).size!==raw.length
    || raw.some(z=>!z||typeof z.id!=='string'||!z.id.startsWith('camp:')&&!/^area:-?[\d.]+:-?[\d.]+$/.test(z.id)
      || !Number.isFinite(z.x)||!Number.isFinite(z.z)||z.x<WORLD_BOUNDS.minX||z.x>WORLD_BOUNDS.maxX||z.z<WORLD_BOUNDS.minZ||z.z>WORLD_BOUNDS.maxZ
      || !Number.isFinite(z.radius)||z.radius<=0||z.radius>50
      || z.safeSince!==undefined&&(!Number.isFinite(z.safeSince)||z.safeSince<0||z.safeSince>seconds))) throw new Error('危险区域存档无效');
  return raw.map(z=>({id:z.id,x:z.x,z:z.z,radius:z.radius,...z.safeSince!==undefined?{safeSince:z.safeSince}:{}}));
}
