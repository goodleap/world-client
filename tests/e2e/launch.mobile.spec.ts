import { test } from '@playwright/test';
import { checkLaunch } from './launch-check.ts';

test('portrait phone can load the menu and enter the map', async ({ page }, info) => {
  test.setTimeout(150_000);
  await checkLaunch(page, info);
});
