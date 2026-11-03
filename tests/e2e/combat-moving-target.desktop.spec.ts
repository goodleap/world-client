import { test } from '@playwright/test';
import { checkReturningTargets } from './combat-moving-target-check.ts';
for (const role of ['infantry', 'cavalry', 'archer'] as const) test(`${role} hits a returning enemy and pause freezes combat`, async ({ page }, info) => {
  test.setTimeout(150000); await checkReturningTargets(page, info, role);
});
