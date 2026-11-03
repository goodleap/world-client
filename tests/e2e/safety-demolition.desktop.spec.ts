import{test}from'@playwright/test';import{checkSafetyDemolition}from'./safety-demolition-check.ts';
test('building picking, safe demolition and mounted movement',async({page},info)=>checkSafetyDemolition(page,info,false));
