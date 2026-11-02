import {test} from '@playwright/test';
import {checkHomeManagement} from './home-management-check.ts';
test('home center recruits, groups issue mixed movement and saves retain both',async({page},info)=>{test.setTimeout(240000);await checkHomeManagement(page,info,false);});
