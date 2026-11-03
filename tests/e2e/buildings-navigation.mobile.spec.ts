import {test} from '@playwright/test';
import {checkBuildingsNavigation} from './buildings-navigation-check.ts';
test.use({deviceScaleFactor:3});
test('building repair and asynchronous touch group routes at DPR 3',async({page},info)=>checkBuildingsNavigation(page,info,true));
