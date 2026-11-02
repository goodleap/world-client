import {test} from '@playwright/test';
import {checkHomeManagement} from './home-management-check.ts';
test('mobile recruitment and centered compact group card at narrow and short sizes',async({page},info)=>{test.setTimeout(240000);await checkHomeManagement(page,info,true);});
