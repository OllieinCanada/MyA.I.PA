const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {collectProviderNotifications}=require('../server/providerNotificationSources');
test('independent website monitor remains five-minute and provider sources hourly',()=>{
  assert.match(fs.readFileSync('.github/workflows/production-monitor.yml','utf8'),/cron: "\*\/5 \* \* \* \*"/);
  assert.match(fs.readFileSync('server/providerNotificationRoutes.js','utf8'),/>=3600000/);
});
test('backup includes failures between hourly checks without inflating short-window spend',async()=>{
  const now=Date.now();
  const result=await collectProviderNotifications({now,env:{VAPI_API_KEY:'test',PROVIDER_VAPI_WINDOW_SPEND_USD:'5'},fetchImpl:async()=>({ok:true,json:async()=>[{id:'older-failure',cost:20,createdAt:new Date(now-40*60000).toISOString(),endedAt:new Date(now-35*60000).toISOString(),status:'ended',endedReason:'worker-died'}]})});
  assert.equal(result.events.length,1);assert.equal(result.events[0].type,'call_failed');
});
