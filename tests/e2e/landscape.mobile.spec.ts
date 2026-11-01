import { test } from '@playwright/test';
import { checkLandscape } from './landscape-check.ts';
test.use({ viewport: { width: 393, height: 754 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
checkLandscape(true);
