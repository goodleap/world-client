import test from 'node:test';
import assert from 'node:assert/strict';
import { Autosave } from '../src/game/autosave.ts';

test('simulation changes are coalesced to five seconds and explicit saves reset the interval', () => {
  const clock = new Autosave(); let writes = 0;
  for (let i = 0; i < 600; i++) { clock.advance(.05); if (clock.due()) { writes++; clock.attempted(); } }
  assert.ok(writes >= 5 && writes <= 6, 'hundreds of state changes must not become hundreds of writes');
  clock.advance(4); clock.attempted(); clock.advance(1); assert.equal(clock.due(), false);
  clock.advance(4); assert.equal(clock.due(), true);
  clock.attempted(); assert.equal(clock.due(), false, 'failed writes also back off');
  clock.advance(0); assert.equal(clock.due(), false, 'paused time does not advance autosave');
});
