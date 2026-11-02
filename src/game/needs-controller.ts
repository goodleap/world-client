import type { Economy } from './economy.ts';
import type { Combat } from './combat.ts';
import type { createResidents } from './residents.ts';
import { RESIDENTS, ENEMIES, canResidentSupply } from './resident-data.ts';
import { CAMPFIRE_CONFIG as F, fireIsLit } from './campfire.ts';
import { VITAL_CONFIG as V, bodiesFor, health, maxHealth, needsFood, eat } from './vitals.ts';
import type { Vital } from './vitals.ts';
import type { Point } from './movement.ts';
import { GRID_SIZE } from './world-data.ts';

type Residents = Pick<ReturnType<typeof createResidents>, 'needsStatus' | 'setResting' | 'command' | 'releaseFarmerWork'>;
type Rest = NonNullable<Vital['rest']>;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const allResidents = [...RESIDENTS, ...ENEMIES];

/** Meals and personal supplies share economy reservations, goods and game time.
 * Movement still uses the existing crowd routes; manual orders always interrupt. */
export function createNeedsController(e: Economy, residents: Residents, combat: Combat,
  storageUse: (from: Point) => void = () => {}) {
  const notes = new Map<string, string>();
  const status = (id: string) => residents.needsStatus(id);
  const position = (id: string) => combat.unit(id)?.position ?? status(id).position;
  const needs = (id: string) => bodiesFor(id).some(body => needsFood(e.state, body, V.stopAt));
  const hungry = (id: string) => bodiesFor(id).some(body => needsFood(e.state, body, V.eatAt));
  const available = (id: string) => e.state.campfires.filter(f => f.enabled
    && (f.cooking || f.meals > 0 || bodiesFor(id).some(b => e.state.vitals[b].meal))
    && distance(position(id), e.state.sites.find(s => s.id === f.id)!) <= V.foodRadiusCells * GRID_SIZE);
  const free = (id: string) => {
    const u = combat.unit(id), v = e.state.vitals[id];
    return e.state.seconds >= v.manualUntil && e.state.seconds >= v.retryAt && e.state.seconds >= v.hurtUntil
      && !e.active(id) && !status(id).moving && !u?.attack && !u?.target && u?.order !== 'move' && u?.order !== 'retreat';
  };
  function move(id: string, points: Point[]) {
    for (const point of points) {
      const u = combat.unit(id);
      if (u ? combat.move([id], point, false, true) > 0 : residents.command(point, id, true)) {
        const goal = u?.goal ?? status(id).goal ?? point;
        return { x: goal.x, z: goal.z };
      }
    }
  }
  function finish(id: string, stop = true) {
    const v = e.state.vitals[id];
    if (e.active(id)?.kind === 'supply') e.interrupt(position(id), id);
    v.rest = undefined; v.retryAt = e.state.seconds + V.retrySeconds;
    residents.setResting(id, false); notes.delete(id);
    if (stop) {
      const u = combat.unit(id);
      if (u?.order === 'rest') { u.order = 'hold'; u.goal = undefined; u.route = []; }
      else if (!u) residents.releaseFarmerWork(id);
    }
  }
  function request(id: string, preferred?: string) {
    if (!RESIDENTS.some(r => r.id === id)) return { ok: false, message: '请选择我方人物或动物' };
    if (!hungry(id) || !free(id)) return { ok: false, message: '尚无需休整或正在执行指令' };
    const candidates = available(id).filter(f => !preferred || f.id === preferred).sort((a, b) =>
      distance(position(id), e.state.sites.find(s => s.id === a.id)!) - distance(position(id), e.state.sites.find(s => s.id === b.id)!));
    for (const fire of candidates) {
      const site = e.state.sites.find(s => s.id === fire.id)!;
      for (let i = 0; i < F.seats; i++) {
        const angle = (i + .5) * Math.PI * 2 / F.seats;
        const point = { x: site.x + Math.cos(angle) * F.seatRadius, z: site.z + Math.sin(angle) * F.seatRadius };
        if (Object.entries(e.state.vitals).some(([other, v]) => other !== id && v.rest && distance(v.rest.goal, point) < 2.4)) continue;
        const goal = move(id, [point]); if (!goal) continue;
        e.state.vitals[id].rest = { camp: fire.id, goal };
        residents.setResting(id, true); notes.delete(id); e.revision++;
        return { ok: true, message: '前往火堆进食休整' };
      }
    }
    return { ok: false, message: '需要可到达、已开启的供餐火堆' };
  }
  function supplyPoints(id: string, rest: Rest) {
    const task = e.state.tasks.find(t => t.id === rest.supply);
    if (!task) return [];
    if (task.status === 'delivering') return [rest.goal];
    const goods = e.state.goods.find(g => g.id === task.cargo);
    if (goods) return [{ x: goods.x, z: goods.z }];
    // Mounted bodies need a little more clearance in front of the same door.
    const extra = id === 'cavalry' ? .8 : 0;
    return e.warehouseDoors().sort((a, b) => distance(position(id), a) - distance(position(id), b))
      .flatMap(door => [0, -.8, .8].map(dx => ({ x: door.x + dx, z: door.z - extra })));
  }
  function routeSupply(id: string, rest: Rest) {
    rest.supplyGoal = move(id, supplyPoints(id, rest));
    if (rest.supplyGoal) return true;
    e.defer(rest.supply!, '补给道路不通，稍后重试', position(id));
    rest.supply = undefined; e.state.vitals[id].retryAt = e.state.seconds + V.retrySeconds;
    notes.set(id, '补给道路不通'); move(id, [rest.goal]); return false;
  }
  function startSupply(id: string, rest: Rest) {
    if (!canResidentSupply(id)) { notes.set(id, '等待补给'); return; }
    if (e.state.seconds < e.state.vitals[id].retryAt) return;
    const task = e.requestFireSupply(rest.camp);
    if (!task) { notes.set(id, '等待仓库补料'); e.state.vitals[id].retryAt = e.state.seconds + V.retrySeconds; return; }
    if (task.status !== 'waiting' || task.retryAt > e.state.seconds) { notes.set(id, '等待补给'); return; }
    if (!e.assign(task.id, id).ok) {
      notes.set(id, task.reason || '等待补给'); e.state.vitals[id].retryAt = e.state.seconds + V.retrySeconds; return;
    }
    rest.supply = task.id; routeSupply(id, rest);
  }
  function updateSupply(id: string, rest: Rest) {
    const task = e.state.tasks.find(t => t.id === rest.supply);
    if (!task || task.worker !== id || !['travelling', 'delivering'].includes(task.status)) {
      rest.supply = undefined; rest.supplyGoal = undefined; move(id, [rest.goal]); return;
    }
    e.updateCargo(position(id), id);
    notes.set(id, task.status === 'delivering' ? '运送补给' : '去取补给');
    if (!rest.supplyGoal) { routeSupply(id, rest); return; }
    if (distance(position(id), rest.supplyGoal) > .2) {
      if (!moving(id) && e.state.seconds >= e.state.vitals[id].retryAt) {
        e.state.vitals[id].retryAt = e.state.seconds + V.retrySeconds; routeSupply(id, rest);
      }
      return;
    }
    const pickup = task.status === 'travelling' && !task.cargo;
    e.arrive(task.id); e.updateCargo(position(id), id);
    if (pickup && task.cargo) storageUse(position(id));
    if (e.active(id)) routeSupply(id, rest);
    else { rest.supply = undefined; rest.supplyGoal = undefined; notes.delete(id); move(id, [rest.goal]); }
  }
  const moving = (id: string) => combat.unit(id) ? !!combat.unit(id)!.route.length : status(id).moving;
  for (const r of RESIDENTS) if (e.state.vitals[r.id].rest) residents.setResting(r.id, true);
  return {
    manual(id: string) {
      // Called after an accepted click, so preserve the newly installed route.
      finish(id, false); e.state.vitals[id].manualUntil = e.state.seconds + V.manualGrace;
    },
    canTakeWork(id: string) { return combat.unit(id)?.life !== 'defeated' && !e.state.vitals[id].rest && !(free(id) && hungry(id) && available(id).length); },
    update(seconds: number) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      for (const r of allResidents) {
        const u = combat.unit(r.id); if (u?.life === 'defeated') continue;
        const state = status(r.id), vital = e.state.vitals[r.id];
        const rate = vital.rest && !(u ? u.speed > .08 : state.moving) ? 0 : u?.attack || u?.target ? V.combatDrain : state.working ? V.workDrain : state.speed > .08 ? V.movingDrain : V.idleDrain;
        for (const id of bodiesFor(r.id)) e.state.vitals[id].stamina = Math.max(0, e.state.vitals[id].stamina - rate * seconds);
        if (u?.team === 'enemy') continue;
        if (!vital.rest) {
          residents.setResting(r.id, false); notes.delete(r.id);
          if (free(r.id) && hungry(r.id)) {
            if (!request(r.id).ok) vital.retryAt = e.state.seconds + V.retrySeconds;
          }
          continue;
        }
        const rest = vital.rest, fire = e.campfire(rest.camp);
        if (!fire?.enabled || !fire.cooking && !fire.meals && !bodiesFor(r.id).some(b => e.state.vitals[b].meal)) { finish(r.id); continue; }
        if (rest.supply !== undefined) { updateSupply(r.id, rest); continue; }
        const ready = fireIsLit(fire) && (fire.meals > 0 || bodiesFor(r.id).some(b => e.state.vitals[b].meal)
          || fire.cooking && (fire.food > 0 || fire.cook > 0));
        if (!ready) { startSupply(r.id, rest); if (rest.supply !== undefined) continue; }
        if (distance(position(r.id), rest.goal) > .2) {
          const goal = u?.goal ?? state.goal;
          if ((!moving(r.id) || !goal || distance(goal, rest.goal) > .1) && e.state.seconds >= vital.retryAt) {
            const ok = move(r.id, [rest.goal]); vital.retryAt = e.state.seconds + V.retrySeconds;
            if (!ok) notes.set(r.id, '进食位置被占用');
          }
          continue;
        }
        if (!fireIsLit(fire) || vital.hurtUntil > e.state.seconds) continue;
        let eating = false;
        for (const body of bodiesFor(r.id)) {
          const v = e.state.vitals[body]; if (!needsFood(e.state, body, V.stopAt)) continue;
          if (!v.meal && fire.meals > 0) { fire.meals--; v.meal = { remaining: V.mealSeconds }; e.revision++; }
          if (v.meal) { eat(e.state, body, seconds); eating = true; }
        }
        if (eating) notes.delete(r.id);
        if (!needs(r.id)) finish(r.id);
      }
    },
    label(id: string) {
      const v = e.state.vitals[id], u = combat.unit(id);
      const suffix = v.rest ? notes.get(id) ?? (bodiesFor(id).some(b => e.state.vitals[b].meal) ? '进食' : '去休整') : u?.life === 'defeated' ? '死亡' : '';
      return `${Math.ceil(health(e.state, id))}/${maxHealth(id)} · 体${Math.floor(v.stamina)}${id === 'cavalry' ? ` · 马${Math.ceil(health(e.state, 'horse'))}/160 体${Math.floor(e.state.vitals.horse.stamina)}` : ''}${suffix ? ` · ${suffix}` : ''}`;
    },
  };
}
