import {test} from '@playwright/test';
import {checkBuildingsNavigation} from './buildings-navigation-check.ts';
test('building repair and asynchronous group routes on desktop',async({page},info)=>checkBuildingsNavigation(page,info,false));
