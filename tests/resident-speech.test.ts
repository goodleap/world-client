import test from 'node:test';
import assert from 'node:assert/strict';
import { ResidentSpeech } from '../src/game/resident-speech.ts';
test('different leaders have independent queues and pause preserves readable speech', () => {
  const s = new ResidentSpeech(); s.say('steward', '去播种', 3); s.say('steward', '运送仓库', 3); s.say('captain', '前往目标', 2);
  s.advance(0); assert.equal(s.current('steward'), '去播种');
  s.advance(2); assert.equal(s.current('captain'), undefined); assert.equal(s.current('steward'), '去播种');
  s.advance(1); assert.equal(s.current('steward'), '运送仓库');
  s.advance(2.9); assert.equal(s.current('steward'), '运送仓库');
  s.advance(.2); assert.equal(s.current('steward'), undefined);
});
