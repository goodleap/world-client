import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadingProgress } from '../src/loading-progress.ts';

test('download completion remains separate from processing and real progress resets inactivity', async () => {
  let now = 0;
  const progress = new LoadingProgress(() => now);
  progress.register('file', '模型', 'download');
  progress.begin('file', '模型', 'download');
  progress.bytes('file', 20);
  now = 11000;
  assert.equal(progress.snapshot()[0].idleMs, 11000);
  progress.bytes('file', 20); // repeated notifications are not progress
  assert.equal(progress.snapshot()[0].idleMs, 11000);
  progress.bytes('file', 100, 100); progress.done('file');
  progress.begin('parse', '模型解析');
  assert.deepEqual(progress.snapshot().map(item => item.state), ['done', 'working']);
  now = 15000;
  assert.equal(progress.snapshot()[0].elapsedMs, 11000);
  await assert.rejects(progress.run('parse', '模型解析', () => { throw new Error('invalid GLB'); }));
  assert.equal(progress.snapshot()[1].error, 'invalid GLB');
  await progress.run('parse', '模型解析', () => 1);
  assert.equal(progress.snapshot()[1].state, 'done');
  assert.equal(progress.snapshot()[1].error, undefined);
});
