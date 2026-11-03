import{test}from'@playwright/test';import{checkFeedbackPanels}from'./feedback-panels-check.ts';
test.use({deviceScaleFactor:3});
test('mobile panels and touch formation-center guidance',async({page},info)=>checkFeedbackPanels(page,info,true));
