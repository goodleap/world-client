import { test } from '@playwright/test';
import { checkSelection } from './selection-check.ts';

test('touch selects crops, trees and animals with a persistent readable name', async ({ page }, info) => {
  test.setTimeout(180_000);
  await checkSelection(page, info, true);
});
