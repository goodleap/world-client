import type { Economy } from './economy.ts';
import type { Combat } from './combat.ts';
import type { createResidents } from './residents.ts';
import { RESIDENTS, ENEMIES } from './resident-data.ts';
import { CAMPFIRE_CONFIG as F, fireIsLit } from './campfire.ts';
import { VITAL_CONFIG as V, bodiesFor, health, maxHealth, needsFood, eat } from './vitals.ts';
import type { Point } from './movement.ts';

type Residents = Pick<ReturnType<typeof createResidents>, 'needsStatus' | 'setResting' | 'command' | 'releaseFarmerWork'>;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Food is reserved once per body, then eaten over active game time.
 * Rest movement uses the same crowd routes and manual orders always interrupt. */
export function createNeedsController(e: Economy, residents: Residents, combat: Combat) {
  const status = (id: string) => residents.needsStatus(id);
  const needs = (id: string, threshold = V.eatAt) => bodiesFor(id).some(body => needsFood(e.state, body, threshold));
  const available = (id: string) => e.state.campfires.filter(f => fireIsLit(f) && (f.meals > 0 || f.cooking && (f.food > 0 || f.cook > 0) || bodiesFor(id).some(b => e.state.vitals[b].meal)));
  const free = (id: string) => {
    const u = combat.unit(id), v = e.state.vitals[id];
    return e.state.seconds >= v.manualUntil && e.state.seconds >= v.retryAt && e.state.seconds >= v.hurtUntil
      && !e.active(id) && !status(id).moving && !u?.attack && !u?.target && u?.order !== 'move' && u?.order !== 'retreat';
  };
  function finish(id: string) {
    const v = e.state.vitals[id]; v.rest = undefined; v.retryAt = e.state.seconds + V.retrySeconds;
    residents.setResting(id, false);
    const u = combat.unit(id); if (u?.order === 'rest') { u.order = 'hold'; u.goal = undefined; u.route = []; }
  }
  function request(id: string, preferred?: string, manual = true) {
    if (!RESIDENTS.some(r => r.id === id)) return { ok: false, message: '请选择我方人物或动物' };
    if (!needs(id, V.stopAt)) return { ok: false, message: '体力充足，生命完好' };
    const candidates = available(id).filter(f => !preferred || f.id === preferred).sort((a, b) => {
      const p = status(id).position;
      return distance(p, e.state.sites.find(s => s.id === a.id)!) - distance(p, e.state.sites.find(s => s.id === b.id)!);
    });
    for (const fire of candidates) {
      const site = e.state.sites.find(s => s.id === fire.id)!;
      for (let i = 0; i < F.seats; i++) {
        const angle = (i + .5) * Math.PI * 2 / F.seats;
        const point = { x: site.x + Math.cos(angle) * F.seatRadius, z: site.z + Math.sin(angle) * F.seatRadius };
        if (Object.entries(e.state.vitals).some(([other, v]) => other !== id && v.rest && distance(v.rest.goal, point) < 2.4)) continue;
        const fighter = combat.unit(id);
        const ok = fighter ? combat.move([id], point, false, true) > 0 : residents.command(point, id, true);
        if (!ok) continue;
        if (manual && e.active(id)) { e.interrupt(status(id).position, id); residents.releaseFarmerWork(id); if (!fighter) residents.command(point, id, true); }
        e.state.vitals[id].rest = { camp: fire.id, goal: { ...(fighter?.goal ?? status(id).goal ?? point) } };
        residents.setResting(id, true); e.revision++; return { ok: true, message: '前往火堆进食休整' };
      }
    }
    return { ok: false, message: '需要可到达、有食物且已点燃的火堆' };
  }
  // A saved rest destination is resumed, not turned into an ordinary move.
  for (const r of RESIDENTS) if (e.state.vitals[r.id].rest) residents.setResting(r.id, true);
  return {
    request,
    manual(id: string) { e.state.vitals[id].rest = undefined; e.state.vitals[id].manualUntil = e.state.seconds + V.manualGrace; residents.setResting(id, false); },
    canTakeWork(id: string) { return !e.state.vitals[id].rest && !(free(id) && needs(id) && available(id).length); },
    update(seconds: number) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      for (const r of [...RESIDENTS, ...ENEMIES]) {
        const u = combat.unit(r.id); if (u?.life === 'defeated') continue;
        const state = status(r.id), vital = e.state.vitals[r.id];
        const rate = vital.rest && !(u ? u.speed > .08 : state.moving) ? 0 : u?.attack || u?.target ? V.combatDrain : state.working ? V.workDrain : state.speed > .08 ? V.movingDrain : V.idleDrain;
        for (const id of bodiesFor(r.id)) e.state.vitals[id].stamina = Math.max(0, e.state.vitals[id].stamina - rate * seconds);
        if (u?.team === 'enemy') continue;
        if (!vital.rest) {
          residents.setResting(r.id, false);
          if (free(r.id) && needs(r.id)) {
            if (!request(r.id, undefined, false).ok) vital.retryAt = e.state.seconds + V.retrySeconds;
          }
          continue;
        }
        const fire = e.campfire(vital.rest.camp);
        if (!fire || !fireIsLit(fire)) { finish(r.id); continue; }
        const position = u?.position ?? state.position;
        if (distance(position, vital.rest.goal) > .6) {
          const moving = u ? !!u.route.length : state.moving;
          if (!moving && e.state.seconds >= vital.retryAt) {
            const ok = u ? combat.move([r.id], vital.rest.goal, false, true) > 0 : residents.command(vital.rest.goal, r.id, true);
            vital.retryAt = e.state.seconds + V.retrySeconds;
            if (!ok) finish(r.id);
          }
          continue;
        }
        // Recent damage delays eating; it must not stop the trip to safety.
        if (vital.hurtUntil > e.state.seconds) continue;
        let eating = false;
        for (const body of bodiesFor(r.id)) {
          const v = e.state.vitals[body]; if (!needsFood(e.state, body, V.stopAt)) continue;
          if (!v.meal && fire.meals > 0) { fire.meals--; v.meal = { remaining: V.mealSeconds }; e.revision++; }
          if (v.meal) { eat(e.state, body, seconds); eating = true; }
        }
        if (!needs(r.id, V.stopAt) || !eating && (!fire.cooking || !fire.food && !fire.cook && !fire.meals)) finish(r.id);
      }
    },
    label(id: string) {
      const v = e.state.vitals[id], u = combat.unit(id);
      const suffix = v.rest ? bodiesFor(id).some(b => e.state.vitals[b].meal) ? '进食' : '去休整' : u?.life === 'injured' ? '重伤' : u?.order === 'retreat' ? '撤退' : '';
      return `${Math.ceil(health(e.state, id))}/${maxHealth(id)} · 体${Math.floor(v.stamina)}${id === 'cavalry' ? ` · 马${Math.ceil(health(e.state, 'horse'))}/160 体${Math.floor(e.state.vitals.horse.stamina)}` : ''}${suffix ? ` · ${suffix}` : ''}`;
    },
  };
}
