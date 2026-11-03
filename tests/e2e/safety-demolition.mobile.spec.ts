import{test}from'@playwright/test';import{checkSafetyDemolition}from'./safety-demolition-check.ts';
test.use({viewport:{width:390,height:754},deviceScaleFactor:3});
test('touch building picking, safe demolition and mounted movement',async({page},info)=>checkSafetyDemolition(page,info,true));
