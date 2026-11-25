'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {provisioningErrorEvidence:build,readProvisioningError,purchaseFailure,createProvisioningAuthFailureCapture}=require('../server/signupProvisioningError');
const {recordSignupBug,listSignupBugs}=require('../server/signupBugHistory');
const {fixture:memory}=require('./helpers/signup-bug-memory-db');
const {projectSetup,readSetupEvidence}=require('../server/adminSignupSetup');
const {trackerRow}=require('../server/adminSignupTracker');
const {controlRoomModel,progressSummary}=require('../src/signupControlRoomModel');
const {normalizeSignupProvisioningPayload}=require('../server/signupProvisioning');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const failure={status:'setup_error',identityVerified:true,smsVerified:true,makeFailedStage:'TWILIO_NUMBER_PURCHASE',makeProviderCode:'PROVIDER_REQUEST_FAILED'};
const evidence=(extra={})=>build({operation:'purchase',phase:'purchase',contextHash:'b'.repeat(64),env:{},error:{code:'ETIMEDOUT',statusCode:504,message:'Synthetic purchase timeout; outcome unknown'},...extra});
test('purchase errors preserve checkpoint/code/status and redact secrets, contacts, URLs and arbitrary metadata',()=>{
 const e=evidence({privateValues:['Fixture Owner','private-header-value'],env:{TWILIO_AUTH_TOKEN:'synthetic-secret'},error:{code:'ETIMEDOUT',statusCode:504,message:'Purchase failed for Fixture Owner private-header-value synthetic-secret fixture@example.invalid +19055550123 https://private.test/?token=hidden'}});
 assert.equal(e.phaseLabel,'Search for and purchase the requested number');assert.equal(e.httpStatus,504);assert.equal(e.code,'ETIMEDOUT');assert.equal(e.requestOutcome,'uncertain_inspect_receipts');assert.equal(e.retryAllowed,false);
 assert.doesNotMatch(JSON.stringify(e),/Fixture Owner|private-header-value|synthetic-secret|fixture@example|5550123|private.test/);
 assert.deepEqual(readProvisioningError({...e,headers:{authorization:'secret'},stack:'secret'}),e);
 assert.equal(evidence({error:{message:'x'.repeat(10000)}}).detail.length<=600,true);
 assert.equal(readProvisioningError({...e,retryAllowed:true}),null);assert.equal(readProvisioningError({...e,requestOutcome:'request_not_dispatched'}),null);
 assert.equal(build({operation:'assistant-create',phase:'purchase'}),null);
});
test('authentication metadata cannot retain a caller-supplied context hash',()=>{
 const e=evidence({phase:'key-auth',error:{code:'PROVISIONING_AUTH_INVALID',statusCode:401,message:'Invalid provisioning key.'}});
 assert.equal(e.contextHash,null);assert.equal(e.requestOutcome,'request_not_dispatched');
 assert.equal(readProvisioningError({...e,contextHash:'a'.repeat(64)}),null);
 assert.doesNotMatch(JSON.stringify(evidence({error:{code:'private-error-value',message:'Failure private-error-value'}})),/private-error-value/);
});
test('anonymous authentication reports are bounded, unlinked and safe on concurrent or uncertain storage failure',async()=>{
 let time=100,writes=0,received;const capture=createProvisioningAuthFailureCapture({now:()=>time,record:async input=>{writes++;received=input;throw Error('synthetic unknown write');}});
 const req={method:'POST',path:'/api/integrations/twilio/purchase-number',body:{signupAttemptId:'signup_'+'a'.repeat(32),contextHash:'b'.repeat(64)},headers:{authorization:'private-header-value'}};
 const error={code:'PROVISIONING_AUTH_INVALID',statusCode:401,message:'Invalid provisioning key.'};
 await Promise.all(Array.from({length:30},()=>capture(req,'key-auth',error)));assert.equal(writes,1);assert.equal(received.attemptId,undefined);assert.equal(received.stage,'authorization');assert.equal(received.provisioningFailure.contextHash,null);
 assert.doesNotMatch(JSON.stringify(received),/private-header-value|signup_|bbbbbbbb/);
 time=99;assert.equal((await capture(req,'key-auth',error)).suppressed,true);time=60100;await capture(req,'key-auth',error);assert.equal(writes,2,'A later request may supply a new sample; there is no storage retry loop');
 await capture({...req,method:'GET'},'key-auth',error);await capture({...req,path:'/api/admin/signups'},'key-auth',error);assert.equal(writes,2);
});
test('journal stores exact purchase metadata once and forces authentication reports unlinked even with an injected ID',async()=>{
 const f=memory(),target=f.add(),input={prisma:f.prisma,listSignups:f.listSignups,attemptId:target.attemptId,stage:'purchase',eventId:crypto.randomUUID(),error:{code:'ETIMEDOUT'},provisioningFailure:evidence()};
 await Promise.all([recordSignupBug(input),recordSignupBug(input)]);assert.equal(f.rows.size,1);
 let history=await listSignupBugs({prisma:f.prisma,listSignups:f.listSignups,attemptId:target.attemptId});assert.deepEqual(history.events[0].provisioningFailure,evidence());
 await recordSignupBug({...input,eventId:crypto.randomUUID(),stage:'authorization',provisioningFailure:evidence({phase:'signature-auth',error:{code:'PROVISIONING_AUTHORIZATION_INVALID'}})});
 history=await listSignupBugs({prisma:f.prisma,listSignups:f.listSignups});assert.equal(history.events[0].signupAttemptId,null);
 assert.equal((await listSignupBugs({prisma:f.prisma,listSignups:f.listSignups,attemptId:target.attemptId})).events.length,1);
 const row=[...f.rows.values()][0];row.data.provisioningFailure.retryAllowed=true;
 await assert.rejects(()=>listSignupBugs({prisma:f.prisma,listSignups:f.listSignups}),{code:'BUG_HISTORY_ROW_INVALID'});
});
test('legacy purchase failure is visible without fabricating a receipt, Twilio cause, timestamp or recovery eligibility',()=>{
 const record={...failure,signupAttemptId:'signup_'+'a'.repeat(32)},row=trackerRow(record),setup=projectSetup(record);
 assert.match(row.currentStep,/Number purchase request/);assert.equal(setup.groups[0].checks.find(c=>c.id==='purchase-failure').state,'blocked');
 assert.match(progressSummary(row,setup).reason,/underlying error was not retained/);assert.equal(setup.number.stage.status,'unknown');assert.equal(setup.purchaseEvidence.outcome,'unknown');assert.equal(setup.purchaseFailure.resumeAllowed,false);assert.equal(setup.timeline.some(e=>e.id==='purchase-request-failed'),false);
 assert.equal(controlRoomModel(row,setup).stations.find(s=>s.id==='number').current,true);
 const auth=projectSetup({...record,makeProviderCode:'PROVISIONING_AUTHORIZATION_INVALID'});assert.match(auth.purchaseFailure.label,/authentication failed/);assert.match(auth.groups[0].checks.find(c=>c.id==='purchase-failure').detail,/signed provisioning request was rejected/);
 for(const status of ['setup_ready','archived','pending_verification'])assert.equal(purchaseFailure({...record,status}),null);
});
test('tracker reads only matching exact-context verified purchase reports and keeps missing/unavailable history unknown',async()=>{
 const f=memory(),target=f.add(),payload=normalizeSignupProvisioningPayload(target.payload,{signingSecret:'synthetic-reader-secret'}),context={payload,contextHash:payload.provisioning.contextHash,signupEventKey:target.attemptId};
 const record={...target.record,...failure};f.setRecords([record]);f.rows.set(contextStoreKey(payload.provisioning.idempotencyKey),{key:contextStoreKey(payload.provisioning.idempotencyKey),data:context});
 const capture=hash=>recordSignupBug({prisma:f.prisma,listSignups:f.listSignups,attemptId:target.attemptId,stage:'purchase',error:{code:'ETIMEDOUT'},provisioningFailure:evidence({contextHash:hash})});
 await capture('c'.repeat(64));let setup=await readSetupEvidence({prisma:f.prisma,listSignups:f.listSignups,record});assert.equal(setup.purchaseFailure.evidence,null);
 const originalRead=f.prisma.runtimeStore.findMany;f.prisma.runtimeStore.findMany=async query=>{const rows=await originalRead(query);return Array.from({length:51},()=>rows[0]);};
 setup=await readSetupEvidence({prisma:f.prisma,listSignups:f.listSignups,record});assert.equal(setup.purchaseFailure.errorRead,'partial_history');assert.match(setup.groups[0].checks.find(c=>c.id==='purchase-failure').detail,/Older history remains unread/);f.prisma.runtimeStore.findMany=originalRead;
 await capture(context.contextHash);const writes=f.writes;setup=await readSetupEvidence({prisma:f.prisma,listSignups:f.listSignups,record});
 assert.equal(setup.purchaseFailure.errorRead,'exact_context_captured_error');assert.match(progressSummary(trackerRow(record),setup).reason,/HTTP 504/);assert.equal(f.writes,writes);assert.ok(setup.timeline.some(e=>e.id==='purchase-request-failed'));
 f.setRecords([]);setup=await readSetupEvidence({prisma:f.prisma,listSignups:f.listSignups,record});assert.equal(setup.purchaseFailure.evidence,null);
 f.prisma.runtimeStore.findMany=async()=>{throw Error('synthetic inaccessible history');};setup=await readSetupEvidence({prisma:f.prisma,listSignups:f.listSignups,record});assert.equal(setup.purchaseFailure.errorRead,'unavailable');assert.match(setup.groups[0].checks.find(c=>c.id==='purchase-failure').detail,/could not be read/);
});
