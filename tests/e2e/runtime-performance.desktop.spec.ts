import { test } from '@playwright/test';
import { checkRuntimePerformance } from './runtime-performance-check.ts';
test('runtime costs, compact log and pause saves on desktop', async ({ page }, info) => {
  test.setTimeout(180000); await checkRuntimePerformance(page, info, false);
});
