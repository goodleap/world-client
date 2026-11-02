import {test} from '@playwright/test';
import {checkPerformanceTower} from './performance-tower-check.ts';
test('performance modes and tower garrison persist without changing game time',async({page},info)=>{test.setTimeout(240000);await checkPerformanceTower(page,info,false);});
