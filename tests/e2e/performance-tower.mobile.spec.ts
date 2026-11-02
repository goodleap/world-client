import {test} from '@playwright/test';
import {checkPerformanceTower} from './performance-tower-check.ts';
test('phone performance modes and native tower picking, garrison and exit',async({page},info)=>{test.setTimeout(240000);await checkPerformanceTower(page,info,true);});
