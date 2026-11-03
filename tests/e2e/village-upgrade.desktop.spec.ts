import { test } from '@playwright/test';
import { checkVillageUpgrade } from './village-upgrade-check.ts';
test('soldier levels, fitted picking and automatic repair persist in the real game',async({page},info)=>checkVillageUpgrade(page,info,false));
