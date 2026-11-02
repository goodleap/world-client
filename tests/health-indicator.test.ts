import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthIndicator } from '../src/game/health-indicator.ts';

test('health feedback ignores initial/restored values, appears for damage and healing, and expires on game time', () => {
  const bar = new HealthIndicator();
  bar.update(60, 100, 80); assert.equal(bar.visible, false);
  bar.update(60, 100, 81); assert.equal(bar.visible, false);
  bar.update(40, 100, 82); assert.equal(bar.visible, true); assert.equal(bar.fraction, .4);
  // Repeated render/selection refreshes during a pause cannot extend or expire it.
  for (let i = 0; i < 100; i++) bar.update(40, 100, 82);
  bar.update(40, 100, 85.99); assert.equal(bar.visible, true);
  bar.update(40, 100, 86); assert.equal(bar.visible, false);
  bar.update(42, 100, 90); assert.equal(bar.visible, true);
  bar.update(100, 100, 91); assert.equal(bar.fraction, 1);
  bar.update(100, 100, 95); assert.equal(bar.visible, false);
});

test('rider and mount feedback remains independent and zero health keeps an empty track', () => {
  const rider = new HealthIndicator(), horse = new HealthIndicator();
  rider.update(100, 100, 0); horse.update(160, 160, 0);
  rider.update(0, 100, 1); horse.update(160, 160, 1);
  assert.equal(rider.visible, true); assert.equal(rider.fraction, 0); assert.equal(horse.visible, false);
  rider.update(0, 100, 6); horse.update(80, 160, 6);
  assert.equal(rider.visible, false); assert.equal(horse.visible, true); assert.equal(horse.fraction, .5);
});
