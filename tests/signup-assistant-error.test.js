'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {assistantErrorEvidence,readAssistantError,assistantFailure,privateStrings}=require('../server/signupAssistantError');
const {recordSignupBug,listSignupBugs,safelyRecordSignupBug}=require('../server/signupBugHistory');
const {fixture}=require('./helpers/signup-bug-memory-db');
const {projectSetup,readSetupEvidence}=require('../server/adminSignupSetup');
const {trackerRow}=require('../server/adminSignupTracker');
const {controlRoomModel,progressSummary}=require('../src/signupControlRoomModel');
const {normalizeSignupProvisioningPayload}=require('../server/signupProvisioning');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const {provisioningStateKey}=require('../server/provisioningState');
const failure={status:'setup_error',identityVerified:true,smsVerified:true,makeFailedStage:'VAPI_ASSISTANT_CREATE',makeProviderCode:'PROVIDER_REQUEST_FAILED'};
const evidence=(extra={})=>assistantErrorEvidence({phase:'create',contextHash:'b'.repeat(64),error:{code:'ETIMEDOUT',statusCode:504,message:'Upstream assistant request timed out'},env:{},...extra});

test('bounded redacted error retains technical detail, code, HTTP and checkpoint, never raw request or secrets',()=>{
 const secret='unknown-test-credential',name='Entire Fixture Name';
 const e=evidence({privateValues:privateStrings({name}),env:{VAPI_API_KEY:secret},error:{code:'ETIMEDOUT',statusCode:504,message:`voice.provider failed for ${name}; ${secret}; fixture@example.invalid +19055550123 https://private.test/secret-route?token=hidden Authorization: Bearer abcdefghijklmnop`}});
 assert.equal(e.code,'ETIMEDOUT');assert.equal(e.httpStatus,504);assert.equal(e.phase,'create');assert.match(e.detail,/voice.provider failed/);
 assert.doesNotMatch(JSON.stringify(e),/Entire Fixture|unknown-test|fixture@example|5550123|private.test|secret-route|abcdefghijklmnop/);assert.equal(readAssistantError(e).detail,e.detail);
 assert.equal(e.retryAllowed,false);assert.equal(e.providerOutcome,'uncertain_inspect_receipts');assert.equal(evidence({error:{message:'x'.repeat(5000)}}).detail.length<=600,true);
});
test('unknown codes are not published as credentials; reference distinguishes messages and future phases refuse',()=>{
 const one=evidence({error:{code:'private-key-value',message:'one'}}),two=evidence({error:{code:'private-key-value',message:'two'}});
 assert.equal(one.code,null);assert.notEqual(one.errorReference,two.errorReference);assert.doesNotMatch(JSON.stringify(one),/private-key-value/);
 assert.doesNotMatch(JSON.stringify(evidence({error:{code:'private-key-value',message:'Failed with private-key-value'}})),/private-key-value/);
 assert.equal(evidence({phase:'future-private'}),null);assert.equal(readAssistantError({...one,retryAllowed:true}),null);assert.equal(readAssistantError({...one,contextHash:'foreign'}),null);
 assert.deepEqual(readAssistantError({...one,headers:{authorization:'not-publishable'},stack:'not-publishable'}),one,'Stored optional metadata must not expand the public projection');
});

test('redaction covers short customer labels and case-changed echoes without matching inside ordinary words',()=>{
 const e=evidence({privateValues:privateStrings({name:'Bo',business:'Fixture Electrical'}),env:{},error:{code:'ETIMEDOUT',message:'Body rejected for Bo at fixture electrical; status unknown'}});
 assert.doesNotMatch(e.detail,/\bBo\b|fixture electrical/i);
 assert.match(e.detail,/Body rejected/);
 const literal=evidence({privateValues:privateStrings({name:'A+',business:'AC[ME]'}),env:{},error:{message:'Body rejected for A+ at ac[me]; status unknown'}});
 assert.doesNotMatch(literal.detail,/A\+|ac\[me\]/i);assert.match(literal.detail,/Body rejected/);
});
test('durable journal preserves exact redacted assistant error idempotently and rechecks attribution',async()=>{
 const f=fixture(),target=f.add(),eventId=crypto.randomUUID(),e=evidence();
 const input={prisma:f.prisma,listSignups:f.listSignups,stage:'assistant-create',attemptId:target.attemptId,eventId,assistantFailure:e,error:{code:'ETIMEDOUT',statusCode:504}};
 await Promise.all([recordSignupBug(input),recordSignupBug(input)]);assert.equal(f.rows.size,1);
 let out=await listSignupBugs({prisma:f.prisma,listSignups:f.listSignups,attemptId:target.attemptId});assert.deepEqual(out.events[0].assistantFailure,e);assert.equal(out.readOnly,true);assert.equal(out.ready,false);
 const before=JSON.stringify([...f.rows]);f.setRecords([]);out=await listSignupBugs({prisma:f.prisma,listSignups:f.listSignups});assert.equal(out.events[0].signupAttemptId,null);assert.equal(JSON.stringify([...f.rows]),before);
});
test('untrusted request identity never links a saved assistant error to another tenant',async()=>{
 const f=fixture(),target=f.add();await recordSignupBug({prisma:f.prisma,listSignups:f.listSignups,stage:'assistant-create',assistantFailure:evidence(),error:{code:'ETIMEDOUT'}});
 const out=await listSignupBugs({prisma:f.prisma,listSignups:f.listSignups});assert.equal(out.events[0].signupAttemptId,null);
 assert.equal((await listSignupBugs({prisma:f.prisma,listSignups:f.listSignups,attemptId:target.attemptId})).events.length,0);
});
test('stalled legacy signup points to recorded assistant failure, never inventing number assignment or Vapi rejection',()=>{
 const r={...failure,signupAttemptId:'signup_'+'a'.repeat(32)},row=trackerRow(r),setup=projectSetup(r),model=controlRoomModel(row,setup),summary=progressSummary(row,setup);
 assert.match(row.currentStep,/Assistant creation/);assert.equal(row.completedSteps,1);assert.match(summary.reason,/underlying error is unavailable/);
 assert.equal(model.stations.find(x=>x.id==='assistant').current,true);assert.equal(model.stations.find(x=>x.id==='number').state,'pending');
 assert.equal(setup.groups[1].checks[0].state,'blocked');assert.equal(setup.assistantFailure.resumeAllowed,false);assert.equal(setup.timeline.some(e=>e.id==='assistant-request-failed'),false);
 for(const status of ['setup_ready','archived','pending_verification'])assert.equal(assistantFailure({...r,status}),null);
});
test('tracker reader uses only matching context and still-verified subject; reads never write or dispatch',async()=>{
 const f=fixture(),target=f.add(),payload=normalizeSignupProvisioningPayload(target.payload,{signingSecret:'synthetic-reader-signing-secret'}),context={payload,contextHash:payload.provisioning.contextHash,signupEventKey:target.attemptId};
 const record={...target.record,...failure};f.setRecords([record]);
 f.rows.set(contextStoreKey(payload.provisioning.idempotencyKey),{data:context});
 f.rows.set(provisioningStateKey('twilio-number',payload.provisioning.idempotencyKey),{data:{contextHash:context.contextHash,status:'completed',result:{twilioSid:'PN'+'1'.repeat(32),twilioPhoneNumber:'+12895550123'}}});
 // Fixture iterator includes only journal rows; these two are reader-only rows.
 for(const[key,row]of f.rows)row.key=key;
 const capture=hash=>recordSignupBug({prisma:f.prisma,listSignups:f.listSignups,stage:'assistant-create',attemptId:target.attemptId,error:{code:'ETIMEDOUT'},assistantFailure:evidence({contextHash:hash})});
 await capture('c'.repeat(64));let setup=await readSetupEvidence({prisma:f.prisma,record,listSignups:f.listSignups});assert.equal(setup.assistantFailure.evidence,null);
 const originalRead=f.prisma.runtimeStore.findMany;f.prisma.runtimeStore.findMany=async query=>{const rows=await originalRead(query);return Array.from({length:51},()=>rows[0]);};
 setup=await readSetupEvidence({prisma:f.prisma,record,listSignups:f.listSignups});assert.equal(setup.assistantFailure.errorRead,'partial_history');assert.match(setup.groups[1].checks[0].detail,/Older history remains unread/);f.prisma.runtimeStore.findMany=originalRead;
 await capture(context.contextHash);const writes=f.writes;setup=await readSetupEvidence({prisma:f.prisma,record,listSignups:f.listSignups});
 assert.equal(setup.assistantFailure.errorRead,'exact_context_captured_error');assert.equal(setup.assistantFailure.evidence.phase,'create');assert.match(setup.groups[1].checks[0].detail,/HTTP 504/);assert.ok(setup.timeline.some(e=>e.id==='assistant-request-failed'));assert.equal(f.writes,writes);
 f.setRecords([]);setup=await readSetupEvidence({prisma:f.prisma,record,listSignups:f.listSignups});assert.equal(setup.assistantFailure.evidence,null);
 f.prisma.runtimeStore.findMany=async()=>{throw Error('private storage failure');};setup=await readSetupEvidence({prisma:f.prisma,record,listSignups:f.listSignups});assert.equal(setup.assistantFailure.errorRead,'unavailable');assert.equal(setup.groups[1].checks[0].state,'blocked');
});
test('failed or uncertain diagnostic persistence never retries or grants recovery',async()=>{
 let writes=0,finish;const prisma={$transaction:()=>{writes++;return new Promise(r=>{finish=r;});}};
 const result=await safelyRecordSignupBug({prisma,listSignups:()=>[],stage:'assistant-create',assistantFailure:evidence(),error:{code:'ETIMEDOUT'}},{budgetMs:5});assert.equal(result.recorded,false);assert.equal(writes,1);finish({recorded:true});await new Promise(r=>setImmediate(r));assert.equal(writes,1);assert.equal(evidence().retryAllowed,false);
});
