import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSHeapMB } from '../src/game/heap-memory.ts';

test('optional browser heap counter distinguishes measured MB from unavailable data', () => {
  assert.equal(readJSHeapMB({ memory: { usedJSHeapSize: 123_456_789 } }), 123.456789);
  assert.equal(readJSHeapMB({ memory: { usedJSHeapSize: 0 } }), 0);
  for (const source of [{}, { memory: null }, { memory: {} }, ...[NaN, Infinity, -1, '123'].map(usedJSHeapSize => ({ memory: { usedJSHeapSize } }))]) {
    assert.equal(readJSHeapMB(source), null);
  }
  assert.equal(readJSHeapMB({ get memory() { throw new Error('unavailable'); } }), null);
});
