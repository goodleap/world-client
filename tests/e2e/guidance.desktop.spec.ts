import { test } from '@playwright/test';
import { checkGuidance } from './guidance-check.ts';
test('selected route, accepted attack feedback and civilian death on desktop', async ({ page }, info) => {
  test.setTimeout(240000); await checkGuidance(page, info, false);
});
