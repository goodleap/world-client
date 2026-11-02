import { Economy, initialEconomy } from '../../src/game/economy.ts';
import { newWolf } from '../../src/game/raid-state.ts';
export function raidFixture() {
  const e = new Economy(initialEconomy(391)); e.setLeadership(false); e.state.seconds = 241;
  e.state.raids = { ...e.state.raids, phase: 'raid', wave: 1, startedAt: 241, origin: { x: -10, z: -5 }, notice: '西侧传来狼嚎 · 2只灰狼正在接近', noticeUntil: 260,
    wolves: [newWolf('wolf-1-0', { x: -5, z: -4 }), newWolf('wolf-1-1', { x: -7, z: -5 })] };
  for (const w of e.state.raids.wolves) { w.home = { x: -45, z: 25 }; w.cooldown = 1; }
  for (const u of e.state.combat.units.filter(u => u.team === 'home')) { u.order = 'hold'; u.cooldown = 8; e.state.vitals[u.id].manualUntil = 250; }
  e.state.combat.units.find(u => u.id === 'infantry')!.position = { x: -2, z: -4 };
  return e;
}
