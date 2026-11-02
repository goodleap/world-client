import { test } from '@playwright/test';
import { checkUnitCard } from './unit-card-check.ts';
test('touch building rail scrolls while the compact unit card stays readable',async({page},info)=>{
  test.setTimeout(240000); await checkUnitCard(page,info,true);
});
