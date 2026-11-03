import{test}from'@playwright/test';import{checkFeedbackPanels}from'./feedback-panels-check.ts';
test('stable panels, two-step recruitment and formation-center guidance',async({page},info)=>checkFeedbackPanels(page,info,false));
