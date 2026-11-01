import { test } from '@playwright/test';
import { checkSingleSoldierMovement } from './single-soldier-check.ts';
test('single soldiers move to repeated mouse destinations and resume a saved route', async ({ page }, info) => {
  test.setTimeout(180_000);
  await checkSingleSoldierMovement(page, info, false);
});
