import { test } from '@playwright/test';
import { checkRuntimePerformance } from './runtime-performance-check.ts';
test.use({ viewport: { width: 393, height: 754 }, deviceScaleFactor: 3 });
test('runtime costs, compact log and pause saves on phone', async ({ page }, info) => {
  test.setTimeout(180000); await checkRuntimePerformance(page, info, true);
});
