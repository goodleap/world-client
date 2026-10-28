import { test } from '@playwright/test';
import { checkFarmerPreview } from './farmer-preview-check.ts';
test('farmer model preview loads and returns to the game', async ({ page }) => checkFarmerPreview(page));
