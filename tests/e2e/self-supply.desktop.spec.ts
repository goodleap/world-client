import { test } from '@playwright/test';
import { checkSelfSupply } from './self-supply-check.ts';
test('hungry infantry carries warehouse supplies and resumes the same cargo after reload', async ({ page }, info) => {
  test.setTimeout(240_000); await checkSelfSupply(page, info, 'infantry', false);
});
