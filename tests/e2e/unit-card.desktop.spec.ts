import { test } from '@playwright/test';
import { checkUnitCard } from './unit-card-check.ts';
test('unit vitals and horizontal build choices coexist without changing orders',async({page},info)=>{
  test.setTimeout(240000); await checkUnitCard(page,info,false);
});
