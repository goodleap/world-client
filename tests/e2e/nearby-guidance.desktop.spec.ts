import { test } from '@playwright/test';
import { checkNearbyGuidance } from './nearby-guidance-check.ts';
test('nearby destination, fixed ground arrows, pause and reload on desktop',async({page},info)=>{
  test.setTimeout(240000);await checkNearbyGuidance(page,info,false);
});
