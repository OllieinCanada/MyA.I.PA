'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildSignupRecoveryGuidance:build}=require('../server/signupRecoveryGuidance');
const report=checks=>({readOnly:true,groups:[{checks}]});
test('every missing step stays unknown and no evidence can authorize replay or writes',()=>{
 const r=build();assert.equal(r.steps.length,7);assert.ok(r.steps.every(s=>s.state==='unknown'));
 for(const k of ['ready','applyAllowed','automaticRetryAllowed','providerReplayAllowed','verificationWriteAllowed'])assert.equal(r[k],false);
 const all=build({live:report(['context','number','make','assistant','route','owner-practice','trial'].map(id=>({id,state:'verified'})))});
 assert.equal(all.ready,false);assert.equal(all.applyAllowed,false);
});
test('live failure overrides saved success; observed acceptance never counts as delivery',()=>{
 const input={setup:report([{id:'script',state:'verified'}]),live:report([{id:'assistant',state:'failed'},{id:'owner-practice',state:'observed'}])};
 const before=JSON.stringify(input),r=build(input);assert.equal(JSON.stringify(input),before);
 assert.equal(r.steps.find(s=>s.id==='assistant').state,'failed');assert.equal(r.steps.find(s=>s.id==='delivery').state,'unknown');
 assert.match(r.steps.find(s=>s.id==='delivery').next,/Accepted is not delivered/);
});
for(const code of ['P2028','P2024','MAKE_SIGNUP_TIMEOUT','PROVIDER_TIMEOUT','ETIMEDOUT','HTTP_TIMEOUT'])test(code+' holds external actions for receipt inspection',()=>{
 const r=build({reasonCode:code});assert.equal(r.requiresReceiptInspection,true);assert.match(r.nextAction,/committed work first/);assert.equal(r.providerReplayAllowed,false);
});
test('uncertain purchase, opt-out and access problems have distinct safe instructions',()=>{
 assert.match(build({uncertainPurchase:true}).nextAction,/Do not replay/);
 assert.match(build({reasonCode:'21610'}).nextAction,/Respect the opt-out/);
 assert.match(build({reasonCode:'PROVIDER_ACCESS_DENIED'}).nextAction,/Settings changes require approval/);
});
test('arbitrary provider text and private fields are not echoed; untrusted reports cannot certify checks',()=>{
 const input={reasonCode:'SECRET private@example.test',live:{readOnly:false,groups:[{checks:[{id:'number',state:'verified',detail:'secret'}]}]}};
 const r=build(input);assert.ok(r.steps.every(s=>s.state==='unknown'));assert.doesNotMatch(JSON.stringify(r),/SECRET|private@example/);
});
