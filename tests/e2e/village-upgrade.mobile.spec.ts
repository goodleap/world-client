import { test } from '@playwright/test';
import { checkVillageUpgrade } from './village-upgrade-check.ts';
test('mobile levels, cylinder picking and repair controls fit narrow and landscape screens',async({page},info)=>checkVillageUpgrade(page,info,true));
