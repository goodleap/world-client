import { test } from '@playwright/test';
import { checkSelection } from './selection-check.ts';

test('residents, buildings, trees, individual crops and scenery can be inspected', async ({ page }, info) => {
  test.setTimeout(180_000);
  await checkSelection(page, info, false);
});
