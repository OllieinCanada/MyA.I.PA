'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {dispatchUrlFromSuppressionUrl,assertDispatchEnvironment,verifyDispatchReadiness}=require('../server/smsDispatchReadiness');
const {dispatchReadinessHandler}=require('../server/smsNotificationDispatch');
const {toolPatch,refreshJobTypes}=require('../scripts/refresh-vapi-job-type');
const {applyPlans}=require('../scripts/rollout-signup-assistant-policy');
const {buildIsolatedToolPayload,provisionIsolatedSmsRouting,inspectIsolatedConfiguration}=require('../server/vapiIsolatedSmsProvisioning');
const fs=require('node:fs'),path=require('node:path');
const env=()=>[
 {name:'CALL_ID',value:'{{ call.id }}'},
 {name:'SMS_SUPPRESSION_CHECK_URL',value:'https://api.example.test/api/integrations/sms/suppression/check'},
 {name:'SMS_NOTIFICATION_DISPATCH_URL',value:'https://api.example.test/api/integrations/sms/dispatch'},
 {name:'SMS_SUPPRESSION_API_KEY',value:'synthetic-key'},
 {name:'UNRELATED',value:'preserve'},
];
test('dispatch URL is derived only from a credential-free HTTPS suppression URL',()=>{
 assert.equal(dispatchUrlFromSuppressionUrl(env()[1].value),env()[2].value);
 for(const raw of ['http://example.test/check','https://user:pass@example.test/check','https://example.test/check?token=x','https://example.test/check#x','broken'])assert.throws(()=>dispatchUrlFromSuppressionUrl(raw));
});
test('legacy, duplicate, untrusted or redirected dispatch configuration blocks compilation',()=>{
 const base=env();assert.equal(assertDispatchEnvironment(base).CALL_ID,'{{ call.id }}');
 for(const name of ['CALL_ID','SMS_SUPPRESSION_CHECK_URL','SMS_NOTIFICATION_DISPATCH_URL','SMS_SUPPRESSION_API_KEY']){
  assert.throws(()=>assertDispatchEnvironment(base.filter(v=>v.name!==name)));
  assert.throws(()=>assertDispatchEnvironment([...base,{...base.find(v=>v.name===name)}]));
 }
 assert.throws(()=>assertDispatchEnvironment(base.map(v=>v.name==='CALL_ID'?{...v,value:'model-supplied'}:v)));
 assert.throws(()=>assertDispatchEnvironment(base.map(v=>v.name==='SMS_NOTIFICATION_DISPATCH_URL'?{...v,value:'https://elsewhere.test/dispatch'}:v)));
 assert.throws(()=>toolPatch({function:{},environmentVariables:[]}),/reviewed migration/);
});
test('payload builder and configuration audit use the same custom endpoint derivation',()=>{
 const payload=buildIsolatedToolPayload({aiNumber:'+12025550100',ownerNumber:'+12025550101',twilioAccountSid:'AC_TEST',twilioAuthToken:'SYNTHETIC',suppressionCheckUrl:'https://api.example.test/custom/check',suppressionApiKey:'synthetic-key'});
 assert.equal(payload.environmentVariables.find(v=>v.name==='SMS_NOTIFICATION_DISPATCH_URL').value,'https://api.example.test/custom/check/dispatch');
 assert.equal(inspectIsolatedConfiguration({assistant:{model:{}},tool:payload,aiNumber:'+12025550100',ownerNumber:'+12025550101'}).checks.durableDispatchProtected,true);
});
test('healthy reuse rejects stale nonempty confirmation plans',()=>{
 const tool=buildIsolatedToolPayload({aiNumber:'+12025550100',ownerNumber:'+12025550101',twilioAccountSid:'AC_TEST',twilioAuthToken:'SYNTHETIC',suppressionCheckUrl:env()[1].value,suppressionApiKey:'synthetic-key'});
 const inspect=()=>inspectIsolatedConfiguration({assistant:{model:{}},tool,aiNumber:'+12025550100',ownerNumber:'+12025550101'}).checks.toolConfirmationRejectionInstalled;
 assert.equal(inspect(),true);tool.rejectionPlan={conditions:[{type:'regex',regex:'^yes$'}]};assert.equal(inspect(),false);
});
test('publisher readiness uses GET, does not follow redirects and never posts a claim',async()=>{
 const variables=env(),before=structuredClone(variables),seen=[];
 const result=await verifyDispatchReadiness({environmentVariables:variables,fetchImpl:async(url,options)=>{
  seen.push({url,options});return{ok:true,json:async()=>({schemaVersion:1,ready:true,durableStore:true})};
 }});
 assert.equal(result.ready,true);assert.deepEqual(variables,before);assert.equal(seen.length,1);
 assert.equal(seen[0].url,env()[2].value+'/readiness');assert.equal(seen[0].options.method,'GET');
 assert.equal(seen[0].options.redirect,'error');assert.equal(seen[0].options.body,undefined);
});
test('disabled, missing, malformed and unreachable backend readiness fail closed',async()=>{
 for(const body of [{},{schemaVersion:1,ready:false},{schemaVersion:1,ready:true},{schemaVersion:2,ready:true,durableStore:true}]){
  await assert.rejects(verifyDispatchReadiness({environmentVariables:env(),fetchImpl:async()=>({ok:true,json:async()=>body})}),/unready/);
 }
 await assert.rejects(verifyDispatchReadiness({environmentVariables:env(),fetchImpl:async()=>{throw Error('network');}}),/unverified/);
});
function response(){return{statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
test('readiness endpoint authenticates first and disabled backend never accesses storage',async()=>{
 let reads=0;const prisma={runtimeStore:{findUnique:async()=>{reads++;return null;}},$transaction:async()=>{}};
 for(const [authenticated,enabled,status]of[[false,'true',401],[false,'false',401],[true,'false',503]]){
  const res=response();await dispatchReadinessHandler({prisma,env:{SMS_NOTIFICATION_DISPATCH_ENABLED:enabled},authenticate:()=>authenticated})({},res);
  assert.equal(res.statusCode,status);assert.equal(res.body.ready,false);
 }assert.equal(reads,0);
});
test('ready endpoint reads the durable table without creating, deleting or claiming rows',async()=>{
 const requests=[],res=response();const prisma={$transaction:async()=>{},runtimeStore:{findUnique:async q=>{requests.push(q);return null;},create:()=>assert.fail('no writes'),update:()=>assert.fail('no writes'),delete:()=>assert.fail('no writes')}};
 await dispatchReadinessHandler({prisma,env:{SMS_NOTIFICATION_DISPATCH_ENABLED:'true'},authenticate:()=>true})({},res);
 assert.deepEqual(res.body,{schemaVersion:1,ready:true,durableStore:true});assert.equal(requests.length,1);
 assert.equal(requests[0].where.key,'sms-dispatch-readiness:v1');
 const failed=response();prisma.runtimeStore.findUnique=async()=>{throw Error('offline');};
 await dispatchReadinessHandler({prisma,env:{SMS_NOTIFICATION_DISPATCH_ENABLED:'true'},authenticate:()=>true})({},failed);
 assert.equal(failed.statusCode,503);assert.equal(failed.body.ready,false);
});
test('owned rollout checks every tool before backup or any provider mutation',async()=>{
 let writes=0,backups=0,checks=0;
 const plan={tool:{environmentVariables:env()},nextTool:{code:'candidate'}};
 await assert.rejects(applyPlans({io:{api:async()=>{writes++;}},plans:[plan,plan],recheck:async()=>{},backup:async()=>{backups++;},verifyDispatchReady:async()=>{if(++checks===2)throw Error('backend disabled');return{ready:true};}}),/backend disabled/);
 assert.equal(writes,0);assert.equal(backups,0);assert.equal(checks,2);
 await assert.rejects(applyPlans({io:{api:async()=>{writes++;}},plans:[{...plan,tool:{environmentVariables:[]}}],backup:async()=>{backups++;}}),/reviewed migration/);
 assert.equal(writes,0);assert.equal(backups,0);
});
test('content refresh refuses an unready backend with zero provider writes',async()=>{
 const tool={id:'tool',type:'code',function:{name:'send_call_summaries_0123_12345678_v2'},environmentVariables:env()};
 const assistant={id:'assistant',model:{toolIds:['tool'],messages:[{role:'system',content:'Keep business facts.'}]}};
 let writes=0;
 const request=async(endpoint,options={})=>{if(options.method){writes++;assert.fail('no provider writes');}return structuredClone(endpoint.startsWith('/tool?')?[tool]:endpoint.startsWith('/assistant?')?[assistant]:endpoint.startsWith('/tool/')?tool:assistant);};
 await assert.rejects(refreshJobTypes({request,apply:true,verifyDispatchReady:async()=>({ready:false})}),/unverified/);assert.equal(writes,0);
 tool.environmentVariables=tool.environmentVariables.filter(v=>v.name!=='SMS_NOTIFICATION_DISPATCH_URL');
 await assert.rejects(refreshJobTypes({request,apply:true}),/reviewed migration/);assert.equal(writes,0);
});
test('new provisioning refuses backend unavailability before all tool and assistant mutations',async()=>{
 let writes=0;
 await assert.rejects(provisionIsolatedSmsRouting({assistant:{model:{messages:[]}},tools:[],aiNumber:'+12025550100',ownerNumber:'+12025550101',twilioAccountSid:'AC_TEST',twilioAuthToken:'SYNTHETIC',suppressionCheckUrl:env()[1].value,suppressionApiKey:'synthetic-key',verifyDispatchReady:async()=>({ready:false}),createTool:async()=>{writes++;},patchTool:async()=>{writes++;},patchAssistant:async()=>{writes++;}}),/unverified/);
 assert.equal(writes,0);
 const payload=buildIsolatedToolPayload({aiNumber:'+12025550100',ownerNumber:'+12025550101',twilioAccountSid:'AC_TEST',twilioAuthToken:'SYNTHETIC',suppressionCheckUrl:env()[1].value,suppressionApiKey:'synthetic-key'});
 assert.doesNotThrow(()=>assertDispatchEnvironment(payload.environmentVariables));
});
test('direct publishers contain readiness checks before their mutation blocks',()=>{
 const read=name=>fs.readFileSync(path.join(__dirname,'../scripts',name),'utf8');
 const first=read('configure-first-class-rentals-vapi.js');assert.ok(first.indexOf('await require(\'../server/smsDispatchReadiness\').verifyDispatchReadiness')<first.indexOf('await request(`/assistant/${encodeURIComponent(assistantId)}`, {'));
 const owner=read('set-grimsby-owner-sms.js');assert.ok(owner.indexOf('verifyDispatchReadiness')<owner.indexOf('await request(`/tool/${encodeURIComponent(toolId)}`, { method: "PATCH"'));
 const dean=read('provision-dean-allison-private-demo.js');assert.ok(dean.indexOf('verifyDispatchReadiness')<dean.indexOf('assistant = await vapiRequest("/assistant", { method: "POST"'));
 const pilot=read('repair-vapi-pilot-sms.js');assert.equal((pilot.match(/await require\('\.\.\/server\/smsDispatchReadiness'\)\.verifyDispatchReadiness/g)||[]).length,2);
});
test('unknown notification result has an explicit no-success/no-retry instruction',()=>{
 const {callerNumberFallbackPrompt}=require('../server/compositeCallNotifications');
 const prompt=callerNumberFallbackPrompt('synthetic_tool');assert.match(prompt,/missing, malformed or absent complete/);assert.match(prompt,/A completed tool call is not completed submission/);assert.match(prompt,/unverified result[\s\S]*Do not retry/);
});
test('isolated full signup fixture checks real readiness only through its local server',()=>{
 const source=fs.readFileSync(path.join(__dirname,'helpers/signup-setup-chain-worker.js'),'utf8');
 assert.match(source,/SMS_NOTIFICATION_DISPATCH_ENABLED:'true'/);
 assert.match(source,/uri\.hostname==='api\.myaipa\.test'&&uri\.pathname==='\/api\/integrations\/sms\/dispatch\/readiness'&&method==='GET'/);
 assert.match(source,/return nativeFetch\(baseUrl\+uri\.pathname,options\)/);
 assert.match(source,/External traffic forbidden/);
});
