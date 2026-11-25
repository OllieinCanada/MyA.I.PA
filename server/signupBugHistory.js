'use strict';
// Append-only technical reports, separate from active incident TTL/acknowledgement.
// No raw errors, contacts, transcripts, provider bodies, sends or repair actions.
// Assistant requests additionally retain bounded, redacted technical detail
// and their server-selected checkpoint; never a request body or stack trace.
const crypto=require('node:crypto');
const {signupDiagnosticError}=require('./signupDiagnosticError');
const {signupBusinessKey}=require('./signupBusinessIdentity');
const {readAssistantError}=require('./signupAssistantError');
const {readProvisioningError}=require('./signupProvisioningError');
const PREFIX='application-bug-history:v1:';
const STAGES=Object.freeze({authorization:'Signup authorization',handoff:'Make handoff',purchase:'Number purchase',
 'assistant-create':'Assistant creation','assistant-import':'Number import','provider-readback':'Provider resource inspection',
 trial:'Trial activation',forwarding:'Forwarding preparation',completion:'Completion notification',verification:'Contact verification',worker:'Setup worker',runtime:'Application runtime'});
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validAttempt=value=>typeof value==='string'&&/^signup_[a-f0-9]{32}$/.test(value);
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(code,statusCode=409)=>{throw Object.assign(new Error('Bug history could not be verified.'),{code,statusCode});};
// Diagnostic storage must not add transactions to the answering safeguard or
// turn a read-only request into a write. Existing incident/log paths remain.
function shouldCaptureRuntimeBug(context={}){
 return context.readOnly!==true&&context.area!=='AI call setup'&&!['GET','HEAD','OPTIONS'].includes(String(context.method||'').toUpperCase());
}
function runtimeBugStage({stage,route}={}){
 if(Object.hasOwn(STAGES,stage))return stage;
 return ({'/api/integrations/twilio/purchase-number':'purchase','/api/integrations/vapi/create-signup-assistant':'assistant-create',
  '/api/integrations/vapi/import-twilio-number':'assistant-import','/api/integrations/verify-signup-contact':'verification',
  '/api/integrations/verify-signup-email':'verification'})[route]||'runtime';
}
function targetProof(attemptId,attempt,records){
 if(!validAttempt(attemptId)||attempt?.eventKey!==attemptId)return null;
 const matches=records.filter(record=>record.signupAttemptId===attemptId);
 if(matches.length!==1)return null;
 const businessKey=signupBusinessKey(matches[0]);
 return businessKey&&signupBusinessKey(attempt.payload)===businessKey?{attemptId,businessKey}:null;
}
function nextAction(diagnostic){
 if(diagnostic.code==='21610'||diagnostic.code==='SMS_SUPPRESSED')return 'Respect the opt-out. Do not bypass suppression or resend.';
 if(['P2028','P2024'].includes(diagnostic.code))return 'Inspect database timing and the exact saved receipts. Do not repeat a provider action with an uncertain outcome.';
 if(diagnostic.httpStatus===401||diagnostic.httpStatus===403||diagnostic.code==='EAUTH')return 'Check the relevant account access/configuration without exposing credentials. Any live test needs separate approval.';
 return 'Inspect this operation and its existing receipts. No automatic resend, purchase, billing action or repair is authorized by this report.';
}
async function recordSignupBug({prisma,listSignups,error={},assistantFailure,provisioningFailure,stage='runtime',attemptId,eventId=crypto.randomUUID(),source='runtime',release='',now=Date.now}){
 if(typeof eventId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(eventId))fail('BUG_HISTORY_EVENT_ID_INVALID',400);
 stage=Object.hasOwn(STAGES,stage)?stage:'runtime';
 source=['runtime','worker'].includes(source)?source:'runtime';
 const diagnostic=signupDiagnosticError(error),key=PREFIX+hash(eventId);
 const assistant=stage==='assistant-create'?readAssistantError(assistantFailure):null;
 const checkedProvisioning=readProvisioningError(provisioningFailure);
 const provisioning=checkedProvisioning&&(checkedProvisioning.operation===stage||stage==='authorization'&&['key-auth','signature-auth'].includes(checkedProvisioning.phase))?checkedProvisioning:null;
 if(provisioning&&['key-auth','signature-auth'].includes(provisioning.phase))attemptId=undefined;
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
  let target=null,association=attemptId?'unverified':'none';
  if(validAttempt(attemptId)){
   // Attribution is server-owned. Never match by a name, phone or request-body ID.
   const attempt=await tx.signupAttempt.findUnique({where:{eventKey:attemptId}});
   let records=[];try{records=listSignups();}catch{/* Save an unlinked report instead of guessing from contacts or a damaged file. */}
   target=targetProof(attemptId,attempt,Array.isArray(records)?records:[]);if(target)association='verified_at_capture';
  }
  const signature={stage,code:diagnostic.code,httpStatus:diagnostic.httpStatus,reference:diagnostic.reference,...(assistant?{assistant}: {}),...(provisioning?{provisioning}: {})};
  const issueId=hash([target||'unattributed',signature]);
  const identity=hash([target,association,signature,source]);
  const previous=await tx.runtimeStore.findUnique({where:{key}});
  if(previous){if(previous.data?.version!==1||previous.data.identity!==identity)fail('BUG_HISTORY_EVENT_CONFLICT');return {recorded:true,replayed:true};}
  const data={version:1,identity,issueId,target,attemptHash:target?hash(target.attemptId):null,association,stage,source,
   diagnostic:{code:diagnostic.code,httpStatus:diagnostic.httpStatus,reference:diagnostic.reference},
   ...(assistant?{assistantFailure:assistant}:{}),
   ...(provisioning?{provisioningFailure:provisioning}:{}),
   capturedAt:new Date(now()).toISOString(),release:/^[a-f0-9]{40}$/.test(release)?release:null};
  await tx.runtimeStore.create({data:{key,data}});
  return {recorded:true,replayed:false};
 },{maxWait:2000,timeout:3000});
}
async function safelyRecordSignupBug(input,{budgetMs=300}={}){
 let timer;try{return await Promise.race([recordSignupBug(input),new Promise(resolve=>{timer=setTimeout(()=>resolve({recorded:false,unavailable:true}),budgetMs);})]);}
 catch{return {recorded:false,unavailable:true};}finally{clearTimeout(timer);}
 // An admitted DB write can finish after the budget. Never automatically retry.
}
async function listSignupBugs({prisma,listSignups,attemptId,issueId,cursor,limit=30}){
 if(attemptId!==undefined&&!validAttempt(attemptId)||issueId!==undefined&&!validHash(issueId)||cursor!==undefined&&!validHash(cursor))fail('BUG_HISTORY_FILTER_INVALID',400);
 const filters=[{key:{startsWith:PREFIX}}];
 if(attemptId)filters.push({data:{path:['attemptHash'],equals:hash(attemptId)}});
 if(issueId)filters.push({data:{path:['issueId'],equals:issueId}});
 if(cursor){const row=await prisma.runtimeStore.findUnique({where:{key:PREFIX+cursor}});
  if(!row||attemptId&&row.data?.attemptHash!==hash(attemptId)||issueId&&row.data?.issueId!==issueId)fail('BUG_HISTORY_CURSOR_INVALID',400);}
 const size=Math.max(1,Math.min(50,Number.isSafeInteger(limit)?limit:30));
 const rows=await prisma.runtimeStore.findMany({where:{AND:filters},orderBy:[{createdAt:'desc'},{key:'desc'}],take:size+1,
  ...(cursor?{cursor:{key:PREFIX+cursor},skip:1}:{})});
 const page=rows.slice(0,size),ids=[...new Set(page.map(row=>row.data?.target?.attemptId).filter(validAttempt))];
 const records=ids.length?listSignups():[];
 const attempts=ids.length?await prisma.signupAttempt.findMany({where:{eventKey:{in:ids}},select:{eventKey:true,payload:true}}):[];
 const events=page.map(row=>{
  const data=row.data;if(data?.version!==1||!validHash(data.issueId)||!Object.hasOwn(STAGES,data.stage)||!Number.isFinite(Date.parse(data.capturedAt)))fail('BUG_HISTORY_ROW_INVALID',503);
  if(attemptId&&(data.target?.attemptId!==attemptId||data.attemptHash!==hash(attemptId))||issueId&&data.issueId!==issueId)fail('BUG_HISTORY_ROW_INVALID',503);
  const proof=data.target?targetProof(data.target.attemptId,attempts.find(attempt=>attempt.eventKey===data.target.attemptId),records):null;
  const verified=proof&&proof.businessKey===data.target.businessKey;
  const diagnostic=signupDiagnosticError(data.diagnostic||{});
  const assistant=data.assistantFailure===undefined?null:readAssistantError(data.assistantFailure);
  if(data.assistantFailure!==undefined&&!assistant)fail('BUG_HISTORY_ROW_INVALID',503);
  const provisioning=data.provisioningFailure===undefined?null:readProvisioningError(data.provisioningFailure);
  if(data.provisioningFailure!==undefined&&(!provisioning||!(provisioning.operation===data.stage||data.stage==='authorization'&&['key-auth','signature-auth'].includes(provisioning.phase))))fail('BUG_HISTORY_ROW_INVALID',503);
  if(provisioning&&['key-auth','signature-auth'].includes(provisioning.phase)&&data.target)fail('BUG_HISTORY_ROW_INVALID',503);
  return {eventRef:row.key.slice(PREFIX.length),issueId:data.issueId,reference:'BUG-'+data.issueId.slice(0,8).toUpperCase(),
   stage:data.stage,operation:STAGES[data.stage],diagnostic,...(assistant?{assistantFailure:assistant}:{}),...(provisioning?{provisioningFailure:provisioning}:{}),capturedAt:data.capturedAt,release:/^[a-f0-9]{40}$/.test(data.release||'')?data.release:null,
   signupAttemptId:verified?proof.attemptId:null,association:verified?'verified':data.target?'historical_unverified':'unattributed',
   status:'needs_investigation',confirmedSoftwareBug:false,nextAction:nextAction(diagnostic)};
 });
 const groups=new Map();for(const event of events){const group=groups.get(event.issueId)||{issueId:event.issueId,reference:event.reference,operation:event.operation,reportsOnPage:0};group.reportsOnPage++;groups.set(event.issueId,group);}
 return {readOnly:true,ready:false,events,groups:[...groups.values()],hasMore:rows.length>size,nextCursor:rows.length>size?page.at(-1).key.slice(PREFIX.length):null,
  limitation:'Counts describe captured reports on this page, not proven distinct failures or root causes. Matching signatures are grouped, not diagnosed by a model. Historical/unknown associations stay unlinked. No automatic expiry or incident acknowledgement deletes this journal; storage failure, backups and an explicit future retention policy remain separate concerns. Provisioning reports may include bounded redacted technical detail, never raw payloads or stacks. Unauthenticated refusals are sampled per route/checkpoint per process; missing samples do not prove no failure.'};
}
function registerSignupBugRoutes({app,requireAdmin,prisma,listSignups}){
 app.get('/api/admin/signup-bugs',requireAdmin,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{const query=req.query||{};res.json(await listSignupBugs({prisma,listSignups,attemptId:query.attemptId,issueId:query.issueId,cursor:query.cursor}));}
  catch(error){res.status(error.statusCode===400?400:503).json({error:'Bug history is unavailable or the filter is invalid. A missing history read is not proof that no bugs occurred.'});}
 });
}
module.exports={PREFIX,recordSignupBug,safelyRecordSignupBug,listSignupBugs,registerSignupBugRoutes,runtimeBugStage,shouldCaptureRuntimeBug};
