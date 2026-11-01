import { test } from '@playwright/test';
import { checkSelfSupply } from './self-supply-check.ts';
test('mounted rider supplies an empty fire and both rider and horse eat on mobile', async ({ page }, info) => {
  test.setTimeout(240_000); await checkSelfSupply(page, info, 'cavalry', true);
});
