'use strict';
// Actual application HTTP handlers and domain code, injected in-memory Prisma,
// loopback-only fake provider. NOT SQL, PSTN, model or delivery proof.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {before,beforeEach,after}=test;
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-supervised-pilot-'));
// No inherited credential/configuration is used by this fixture process.
const keep=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','NODE_PATH','NODE_TEST_CONTEXT'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,keep,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',DATABASE_URL:'',DATA_DIR:directory,
 SECURITY_STATE_FORCE_DATABASE:'false',ADMIN_PASSWORD:'fixture-admin-secret',ADMIN_TOTP_SECRET:'',
 VAPI_WEBHOOK_SECRET:'fixture-webhook-secret',VAPI_API_KEY:'',VAPI_BUSINESS_MAP:'{}',VAPI_REQUIRE_BUSINESS_MAPPING:'true',
 TRIAL_REMINDER_DISABLE:'true',VAPI_AUTO_SYNC_ENABLED:'false',MISSED_CALL_ALERT_ENABLED:'false',DAILY_DIGEST_ENABLED:'false',
 SIGNUP_SETUP_WORKER_PAUSED:'true',TRIAL_USAGE_LIMIT_ENABLED:'true',LEAD_ACK_SECRET:'fixture-ack-secret',
 STORE_CALL_TRANSCRIPTS:'false',STORE_CALL_RECORDING_URLS:'false'});
const tables=Object.fromEntries(['caller','call','lead','leadHandoff','leadNotificationAttempt','leadNotificationEvent','vapiToolExecution','runtimeStore'].map(k=>[k,new Map()]));
const pilotEvidence={scope:'actual-http-inmemory-loopback',happyPath:false,concurrentDuplicate:false,findings:[],findingDetails:{},realProviderActions:0,realCalls:0,realTexts:0,sqlProof:false,physicalReceiptProof:false,osSandboxProven:false,cleanup:false};
let seq=0,revision=0,failLead=false,failReceipt=0,failAllAttemptWrites=false,admissionHook,fallbackBusinesses=[],providerMode='accept',providerPosts=[],providerEntered,providerRelease;
const copy=x=>x==null?x:structuredClone(x),find=(name,where)=>[...tables[name].values()].find(r=>Object.entries(where).every(([k,v])=>r[k]===v));
const matches=(row,where)=>Object.entries(where).every(([key,value])=>key==='OR'?value.some(w=>matches(row,w)):key==='AND'?value.every(w=>matches(row,w)):key==='NOT'?!matches(row,value):
 value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value).every(([op,arg])=>op==='in'?arg.includes(row[key]):op==='lte'?row[key]!=null&&row[key]<=arg:op==='startsWith'?String(row[key]||'').startsWith(arg):false):row[key]===value);
const db={};
for(const name of Object.keys(tables))db[name]={
 findUnique:async({where,include})=>{const row=copy(find(name,where));if(row&&include&&name==='leadHandoff'){
  row.lead=copy(tables.lead.get(row.leadId));row.attempts=[...tables.leadNotificationAttempt.values()].filter(r=>r.handoffId===row.id).map(copy);}
  if(row&&include&&name==='leadNotificationAttempt')row.handoff=copy(tables.leadHandoff.get(row.handoffId));
  return row||null;},
 create:async({data})=>{if(name==='lead'&&failLead)throw Object.assign(Error('Fixture DB failure'),{code:'FIXTURE_DB_FAILURE'});
  const unique=name==='vapiToolExecution'?'idempotencyKey':name==='leadHandoff'?'sourceEventId':null;
  if(unique&&data[unique]&&find(name,{[unique]:data[unique]}))throw Object.assign(Error('Fixture unique collision'),{code:'P2002'});
  if(name==='leadNotificationAttempt'&&find(name,{handoffId:data.handoffId,recipientRole:data.recipientRole,attemptNumber:data.attemptNumber}))throw Object.assign(Error('Fixture attempt unique collision'),{code:'P2002'});
  const id=['caller','call','lead'].includes(name)?++seq:'fixture-'+name+'-'+(++seq);
  const row={id,retryCount:0,maxRetries:2,updatedAt:++revision,...(name==='leadHandoff'?{status:'PENDING',acknowledgedAt:null,nextActionAt:null,lastErrorCode:null}:{}),...copy(data)};tables[name].set(row.id,row);return copy(row);},
 update:async({where,data})=>{if(name==='leadNotificationAttempt'&&(failAllAttemptWrites||data.status==='ACCEPTED'&&failReceipt-->0))throw Error('Fixture accepted-receipt persistence failure');const row=find(name,where);assert.ok(row);Object.assign(row,copy(data),{updatedAt:++revision});return copy(row);},
 updateMany:async({where,data})=>{if(admissionHook){const hook=admissionHook;admissionHook=null;await hook();}let count=0;for(const row of tables[name].values())if(matches(row,where)){Object.assign(row,copy(data),{updatedAt:++revision});count++;}return{count};},
 upsert:async({where,create,update})=>{let row=find(name,where);if(row)Object.assign(row,copy(update));else{row={id:++seq,...copy(create)};tables[name].set(row.id,row);}return copy(row);},
 findMany:async({where={}}={})=>[...tables[name].values()].filter(r=>matches(r,where)).map(copy)
};
db.business={findUnique:async({where})=>[37,38].includes(where.id)?{id:where.id,name:'Fictitious Pilot '+where.id,phone:where.id===37?'+15555550100':'+15555550199',settings:{}}:null,
 findMany:async()=>copy(fallbackBusinesses)};
db.settings={findUnique:async({where})=>({businessId:where.businessId,ownerPhone:where.businessId===37?'+15555550100':'+15555550199',leadAckSlaMinutes:2})};
db.forwardingVerificationAttempt={findUnique:async({where})=>{assert.equal(where.inboundVapiCallId,'fixture-call');return null;}};
let mappings=[{matchValue:'fixture-assistant',businessId:37},{matchValue:'fixture-phone',businessId:37}];
let mappingFailure=false;
db.vapiBusinessMapping={findMany:async({where})=>{if(mappingFailure)throw Error('Fixture mapping read unavailable');return copy(mappings.filter(r=>where.matchValue.in.includes(r.matchValue)));}};
db.runtimeStore.findMany=async({where})=>(where.key?.in||[]).map(key=>find('runtimeStore',{key})).filter(Boolean).map(copy);
db.runtimeStore.deleteMany=async({where})=>{assert.equal(typeof where.key,'string');let count=0;for(const [id,row]of tables.runtimeStore)if(row.key===where.key){tables.runtimeStore.delete(id);count++;}return{count};};
db.call.aggregate=async()=>({_sum:{durationSec:0},_count:{_all:0}});
db.$queryRaw=async(query,...values)=>{const sql=(query.strings||query).join('?');
 if(sql.includes('AS "usedSeconds"'))return[{data:copy(find('runtimeStore',{key:values[0]})?.data)||null,usedSeconds:'0'}];
 if(!sql.includes('FOR UPDATE'))return[];const v=[...(query.values||values)],clauses=[];
 if(sql.includes('c.id ='))clauses.push({id:v.shift()});if(sql.includes('c."externalProvider" ='))clauses.push({externalProvider:v.shift(),externalId:v.shift()});
 if(sql.includes('c."twilioCallSid" ='))clauses.push({twilioCallSid:v.shift()});return db.call.findMany({where:{OR:clauses}});};
db.$executeRaw=async(strings,...values)=>{for(let i=0;i<values.length;i+=2)await db.runtimeStore.upsert({where:{key:values[i]},create:{key:values[i],data:JSON.parse(values[i+1])},update:{data:JSON.parse(values[i+1])}});return values.length/2;};
db.$transaction=async fn=>fn(db);
global.__myAiPaPrisma=new Proxy(db,{get:(target,key)=>key in target?target[key]:key==='then'?undefined:new Proxy({},{get:()=>async()=>{throw Error('Unexpected fixture database access '+String(key));}})});
const {app,__test}=require('../server/index');
let server,provider,base,guard;
before(async()=>{
 provider=require('node:http').createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;
  assert.equal(req.url,'/chat');providerPosts.push(JSON.parse(text));if(providerMode==='wait')await new Promise(resolve=>{providerRelease=resolve;providerEntered();});
  if(providerMode==='uncertain'){req.socket.destroy();return;}
  res.writeHead(providerMode==='reject'?400:200,{'content-type':'application/json'});res.end(JSON.stringify(providerMode==='reject'?{code:'FIXTURE_REJECTED'}:{id:'fixture-request',messageId:'fixture-message'}));
 });provider.listen(0,'127.0.0.1');await new Promise(r=>provider.once('listening',r));
 Object.assign(process.env,{VAPI_API_BASE_URL:'http://127.0.0.1:'+provider.address().port,VAPI_SMS_ASSISTANT_ID:'fixture-sms-assistant',VAPI_SMS_PHONE_NUMBER_ID:'fixture-sms-phone',VAPI_API_KEY:'fixture-inert-key'});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 guard=require('../scripts/local-staging-egress').install({ports:[server.address().port,provider.address().port]});
});
beforeEach(()=>{for(const rows of Object.values(tables))rows.clear();seq=0;revision=0;failLead=false;failReceipt=0;failAllAttemptWrites=false;admissionHook=null;providerMode='accept';providerPosts=[];providerRelease=null;
 mappingFailure=false;fallbackBusinesses=[];process.env.VAPI_BUSINESS_MAP='{}';mappings=[{matchValue:'fixture-assistant',businessId:37},{matchValue:'fixture-phone',businessId:37}];
 const gate={status:'active',businessId:37,assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',phoneNumber:'+15555550101',subscriptionId:'fixture-subscription',signupAttemptId:'fixture-signup',assistantMaxSeconds:300,fallbackPhone:'+15555550100'};
 for(const key of ['trial-voice-gate:phone-id:fixture-phone','trial-voice-gate:number:+15555550101'])tables.runtimeStore.set(++seq,{id:seq,key,data:copy(gate)});
 __test.upsertSignupDashboardRecord({signupAttemptId:'fixture-signup',businessId:37,businessName:'Fictitious Pilot',ownerEmail:'pilot@example.invalid',ownerPhone:'+15555550100',businessPhone:'+15555550100',twilioPhoneNumber:'+15555550101',vapiPhoneNumberId:'fixture-phone',vapiAssistantId:'fixture-assistant',subscriptionId:'fixture-subscription',subscriptionStatus:'trialing',status:'setup_ready',trialStartAt:Date.now()-60000,trialEndAt:Date.now()+86400000});
});
after(async()=>{providerRelease?.();for(const s of [server,provider]){s.closeAllConnections?.();await new Promise(r=>s.close(r));}
 assert.equal(guard.status().unexpectedOutboundAttempts,0);assert.equal(path.dirname(fs.realpathSync(directory)),fs.realpathSync(os.tmpdir()));assert.match(path.basename(directory),/^myaipa-supervised-pilot-/);
 fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);
 pilotEvidence.cleanup=true;pilotEvidence.unexpectedOutboundAttempts=guard.status().unexpectedOutboundAttempts;
 console.log('PILOT_JOURNEY_EVIDENCE '+JSON.stringify(pilotEvidence));
});
const call={id:'fixture-call',assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',customer:{number:'+15555550102'},transport:{forwardedFrom:'+15555550100'}};
const args={businessId:38,ownerNumber:'+15555550199',name:'Fictitious Tester',rawPhoneNumber:'+15555550102',jobDetails:'Replace a fictitious lamp',intent:'QUOTE',bestCallbackTime:'After 2 PM'};
async function request(message,authenticated=true){const r=await fetch(base+'/api/webhooks/voice',{method:'POST',headers:{'content-type':'application/json',...(authenticated?{'x-vapi-secret':'fixture-webhook-secret'}:{})},body:JSON.stringify({message}),signal:AbortSignal.timeout(10000)});return{status:r.status,body:await r.json()};}
const tools=(id='fixture-tool',parameters=args,route=call)=>request({type:'tool-calls',call:route,toolCallList:[{id,function:{name:'record_lead_and_notify_owner',arguments:typeof parameters==='string'?parameters:JSON.stringify(parameters)}}]});
const output=r=>JSON.parse(r.body.results[0].result);
test('actual HTTP answering -> captured lead -> exact owner-only mock acceptance -> canonical post-call record',async()=>{
 const answer=await request({type:'assistant-request',call});assert.deepEqual(answer.body,{assistantId:'fixture-assistant'});
 const result=await tools();assert.equal(output(result).ok,true);assert.equal(tables.lead.size,1);assert.equal(providerPosts.length,1);assert.equal(providerPosts[0].transport.customer.number,'+15555550100');
 assert.equal([...tables.lead.values()][0].businessId,37);const execution=[...tables.vapiToolExecution.values()][0];assert.equal(execution.callExternalId,call.id);assert.equal(execution.result.leadId,[...tables.lead.values()][0].id);
 const ended={...call,status:'ended',startedAt:'2030-01-01T12:00:00Z',endedAt:'2030-01-01T12:01:00Z',endedReason:'customer-ended-call'};
 const saved=await request({type:'end-of-call-report',call:ended,analysis:{summary:'Fictitious lamp request'}});assert.ok([200,201].includes(saved.status),JSON.stringify(saved.body));
 const replay=await request({type:'end-of-call-report',call:ended});assert.ok([200,201].includes(replay.status));assert.equal(tables.call.size,1);assert.equal([...tables.call.values()][0].businessId,37);assert.equal(providerPosts.length,1);
 assert.equal([...tables.leadNotificationAttempt.values()][0].status,'ACCEPTED');assert.equal([...tables.leadHandoff.values()][0].deliveredAt,undefined,'acceptance is not delivery');
 assert.ok([...tables.runtimeStore.values()].every(row=>!row.data?.reservations?.[call.id]),'terminal call releases its reservation');
 pilotEvidence.happyPath=true;
});
test('unauthenticated, malformed and missing-route requests do not capture or notify',async()=>{
 assert.equal((await request({type:'tool-calls',call,toolCallList:[]},false)).status,401);
 assert.equal(output(await tools('malformed','{')).actionAttempted,false);mappings=[];assert.equal((await tools('unrouted')).status,422);assert.equal(tables.lead.size,0);assert.equal(providerPosts.length,0);
});
test('concurrent and completed tool replays retain one lead and one owner request',async()=>{
 let entered;const waiting=new Promise(r=>entered=r);providerEntered=entered;providerMode='wait';const first=tools();await waiting;
 const overlap=await tools();assert.equal(output(overlap).duplicate,true);assert.equal(output(overlap).status,'PROCESSING');providerRelease();await first;
 assert.equal(output(await tools()).duplicate,true);assert.equal(providerPosts.length,1);assert.equal(tables.lead.size,1);
 pilotEvidence.concurrentDuplicate=true;
});
test('database capture failure cannot dispatch and same tool replay cannot repeat',async()=>{failLead=true;assert.equal((await tools()).status,500);assert.equal(providerPosts.length,0);failLead=false;assert.equal(output(await tools()).duplicate,true);assert.equal(tables.lead.size,0);});
test('HTTP rejection without a supported non-acceptance guarantee is held, never reported accepted',async()=>{providerMode='reject';const r=await tools();assert.equal(providerPosts.length,1);assert.equal(output(r).ok,false);assert.equal(output(r).executionState,'uncertain');assert.equal([...tables.leadHandoff.values()][0].nextActionAt,null);assert.equal(output(await tools()).duplicate,true);assert.equal(providerPosts.length,1);});
test('ambiguous transport is held and neither worker nor reloaded dispatcher resends',async()=>{providerMode='uncertain';const r=await tools();const handoff=[...tables.leadHandoff.values()][0];assert.equal(providerPosts.length,1);assert.equal(handoff.status,'FAILED');assert.equal(handoff.lastErrorCode,'OWNER_NOTIFICATION_UNCERTAIN');assert.equal(handoff.nextActionAt,null);assert.equal(output(r).ok,false);assert.equal(output(r).executionState,'uncertain');
 const helpers=require('../server/leadHandoffs');assert.equal((await helpers.processDueLeadHandoffs()).checked,0);assert.equal((await helpers.dispatchLeadHandoff(handoff.id)).requiresInspection,true);
 delete require.cache[require.resolve('../server/leadHandoffs')];assert.equal((await require('../server/leadHandoffs').dispatchLeadHandoff(handoff.id)).requiresInspection,true);
 assert.equal(output(await tools()).duplicate,true);assert.equal(providerPosts.length,1);pilotEvidence.uncertainOutcomeHeld=true;
});
test('provider acceptance followed by local receipt failure retains IDs and forbids another send',async()=>{failReceipt=1;const r=await tools();assert.equal(output(r).ok,false);assert.equal(output(r).executionState,'uncertain');const handoff=[...tables.leadHandoff.values()][0],attempt=[...tables.leadNotificationAttempt.values()][0];assert.equal(attempt.providerRequestId,'fixture-request');assert.equal(attempt.providerMessageId,'fixture-message');
 assert.equal((await require('../server/leadHandoffs').dispatchLeadHandoff(handoff.id)).requiresInspection,true);assert.equal(providerPosts.length,1);});
test('persistent receipt database failure leaves durable requested hold, not retry permission',async()=>{failAllAttemptWrites=true;assert.equal((await tools()).status,500);assert.equal(providerPosts.length,1);
 const handoff=[...tables.leadHandoff.values()][0];assert.equal(handoff.status,'SEND_REQUESTED');assert.equal(handoff.nextActionAt,null);failAllAttemptWrites=false;
 const helpers=require('../server/leadHandoffs');assert.equal((await helpers.processDueLeadHandoffs()).checked,0);assert.equal((await helpers.dispatchLeadHandoff(handoff.id)).requiresInspection,true);assert.equal(output(await tools()).duplicate,true);assert.equal(providerPosts.length,1);
});
test('direct concurrent owner and backup dispatchers share one durable handoff admission',async()=>{
 const lead=await db.lead.create({data:{businessId:37,name:'Fictitious tester',callbackNumber:'+15555550102',summary:'Fictitious request'}});
 const handoff=await db.leadHandoff.create({data:{leadId:lead.id,businessId:37,ownerPhone:'+15555550100',backupPhone:'+15555550199',acknowledgementKey:'fixture-ack',acknowledgementSlaMinutes:2}});
 const helpers=require('../server/leadHandoffs'),results=await Promise.all([helpers.dispatchLeadHandoff(handoff.id,'OWNER'),helpers.dispatchLeadHandoff(handoff.id,'BACKUP')]);
 assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(results.filter(r=>r.requiresInspection).length,1);assert.equal(tables.leadNotificationAttempt.size,1);assert.equal(providerPosts.length,1);
});
test('late failed receipt cannot remove uncertain hold or re-enable worker replay',async()=>{failReceipt=1;await tools();const attempt=[...tables.leadNotificationAttempt.values()][0],helpers=require('../server/leadHandoffs');
 await helpers.applyProviderEvent({eventId:'fixture-late-failed',attemptId:attempt.id,status:'FAILED',errorCode:'fixture-failure'});
 assert.equal(tables.leadNotificationAttempt.get(attempt.id).errorCode,'OWNER_NOTIFICATION_UNCERTAIN');assert.equal((await helpers.processDueLeadHandoffs()).checked,0);assert.equal((await helpers.dispatchLeadHandoff(attempt.handoffId)).requiresInspection,true);assert.equal(providerPosts.length,1);
});
test('contradictory assistant/phone routes refuse before claims, leads or transport, regardless of row order',async()=>{
 mappings[1].businessId=38;for(const reverse of [false,true]){if(reverse)mappings.reverse();const r=await tools();assert.equal(r.status,422);assert.equal(tables.vapiToolExecution.size,0);assert.equal(tables.lead.size,0);assert.equal(providerPosts.length,0);}
 pilotEvidence.routeConflictRefused=true;
});
test('override/database disagreement and unavailable mapping evidence refuse without transport',async()=>{
 process.env.VAPI_BUSINESS_MAP=JSON.stringify({'fixture-assistant':38});assert.equal((await tools()).status,422);assert.equal(tables.vapiToolExecution.size,0);
 process.env.VAPI_BUSINESS_MAP=JSON.stringify({'fixture-assistant':37});mappingFailure=true;assert.equal((await tools()).status,500);assert.equal(providerPosts.length,0);
});
test('same-tenant override and both durable aliases remain an allowed route',async()=>{process.env.VAPI_BUSINESS_MAP=JSON.stringify({'fixture-assistant':37});assert.equal(output(await tools()).ok,true);assert.equal(providerPosts.length,1);});
for(const [name,route]of [
 ['missing assistant ID',{...call,assistantId:undefined}],['missing phone ID',{...call,phoneNumberId:undefined}]
])test(name+' uses the remaining trusted match, not a requirement for both IDs',async()=>{assert.equal(output(await tools('fixture-edge',args,route)).ok,true);assert.equal([...tables.lead.values()][0].businessId,37);assert.equal(providerPosts.length,1);});
for(const [name,route]of [
 ['known assistant plus unknown phone',{...call,phoneNumberId:'fixture-unknown-phone'}],['unknown assistant plus known phone',{...call,assistantId:'fixture-unknown-assistant'}]
])test(name+' refuses supplied unknown identity before claims, capture or sends',async()=>{assert.equal((await tools('fixture-unknown',args,route)).status,422);assert.equal(tables.vapiToolExecution.size,0);assert.equal(tables.lead.size,0);assert.equal(providerPosts.length,0);});
test('no trusted match and no called-number fallback refuses before capture',async()=>{const r=await tools('fixture-none',args,{id:call.id,assistantId:'unknown-a',phoneNumberId:'unknown-p',customer:call.customer});assert.equal(r.status,422);assert.equal(tables.lead.size,0);assert.equal(providerPosts.length,0);});
test('unchanged called-number fallback still works with both IDs absent, but duplicate businesses now refuse',async()=>{
 fallbackBusinesses=[{id:37,phone:'+15555550101'}];const route={id:call.id,to:'+15555550101',customer:call.customer};assert.equal(output(await tools('fixture-fallback',args,route)).ok,true);
 fallbackBusinesses.push({id:38,phone:'+15555550101'});const r=await tools('fixture-fallback-conflict',args,route);assert.equal(r.status,422);assert.equal(providerPosts.length,1);assert.equal(tables.lead.size,1);
});
test('supplied malformed provider IDs cannot masquerade as absent optional fields',async()=>{for(const field of ['assistantId','phoneNumberId'])for(const value of [0,false,[],{},42])assert.equal((await tools('fixture-malformed',args,{...call,[field]:value})).status,422);assert.equal(tables.vapiToolExecution.size,0);assert.equal(providerPosts.length,0);});
test('unknown supplied ID cannot use called-number fallback; caller metadata alone supplies no tenant authority',async()=>{
 fallbackBusinesses=[{id:37,phone:'+15555550101'}];assert.equal((await tools('fixture-unknown-fallback',args,{id:call.id,assistantId:'unknown',to:'+15555550101',customer:call.customer})).status,422);
 assert.equal((await tools('fixture-metadata',args,{id:call.id,metadata:{businessId:37},customer:call.customer})).status,422);assert.equal(tables.lead.size,0);assert.equal(providerPosts.length,0);
});
test('changed handoff ownership after read invalidates dispatch CAS before transport',async()=>{
 const lead=await db.lead.create({data:{businessId:37,name:'Fictitious tester',callbackNumber:'+15555550102',summary:'Fictitious request'}});
 const handoff=await db.leadHandoff.create({data:{leadId:lead.id,businessId:37,ownerPhone:'+15555550100',acknowledgementKey:'fixture-ack'}});
 admissionHook=()=>db.leadHandoff.update({where:{id:handoff.id},data:{ownerPhone:'+15555550199'}});
 assert.equal((await require('../server/leadHandoffs').dispatchLeadHandoff(handoff.id)).requiresInspection,true);assert.equal(providerPosts.length,0);assert.equal(tables.leadNotificationAttempt.size,0);
});
