'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {normalizeSignupProvisioningPayload,buildProvisioningResourceName}=require('../../server/signupProvisioning');
const {contextStoreKey}=require('../../server/signupProvisioningContext');
const {provisioningStateKey}=require('../../server/provisioningState');
const {buildSignupAssistantConfig}=require('../../server/signupAssistantTemplate');
const {fingerprintAssistantContent}=require('../../server/signupAssistantVerification');
const {createConnectionTransport}=require('../../server/signupConnectionTransport');
const {createConnectionControl,registerConnectionControl,journalKey}=require('../../server/signupConnectionControl');
const {atomicCommitAssociationFile,createAssociationFence,digest}=require('../../server/signupAssociationRepair');
const {PATH:pendingPath,pendingGateProof,pendingServer,registerPendingSetupGate}=require('../../server/signupPendingConnection');
const clone=structuredClone;
function memoryPrisma(){
 const rows=new Map(),attempts=new Map();
 const matches=(r,w)=>Object.entries(w).every(([k,v])=>k==='OR'?v.some(x=>matches(r,x)):v&&typeof v==='object'&&!(v instanceof Date)
  ?'not'in v?r[k]!==v.not:'in'in v?v.in.includes(r[k]):false:r[k] instanceof Date&&v instanceof Date?r[k].getTime()===v.getTime():r[k]===v);
 const view=(r,s)=>r?clone(s?Object.fromEntries(Object.keys(s).map(k=>[k,r[k]])):r):null;
 function db(staged=new Map(),stagedAttempts=new Map()){
  const get=k=>staged.has(k)?staged.get(k):rows.get(k),getAttempt=k=>stagedAttempts.has(k)?stagedAttempts.get(k):attempts.get(k);
  return {$queryRaw:async()=>[], $executeRaw:async()=>0,
   runtimeStore:{findUnique:async({where,select})=>view(get(where.key),select),
    create:async({data})=>{if(get(data.key))throw Error('synthetic unique conflict');staged.set(data.key,clone(data));return clone(data);},
    update:async({where,data})=>{const value={...get(where.key),...clone(data)};staged.set(where.key,value);return clone(value);},
    upsert:async({where,create,update})=>{const value=get(where.key)?{...get(where.key),...clone(update)}:clone(create);staged.set(where.key,value);return clone(value);},
    deleteMany:async({where})=>{let count=0;for(const[k,v]of rows)if(matches(v,where)){rows.delete(k);count++;}return{count};},
    count:async({where})=>[...rows.values()].filter(x=>matches(x,where)).length},
   signupAttempt:{findUnique:async({where,select})=>view(getAttempt(where.eventKey),select),
    findMany:async({where,select})=>[...attempts.values()].filter(x=>matches(x,where)).map(x=>view(x,select)),
    create:async({data})=>{const value={...clone(data),id:data.id||'fixture'+crypto.randomBytes(10).toString('hex'),assignedPhone:null,vapiAssistantId:null,vapiPhoneNumberId:null,rejectedAt:null,updatedAt:new Date()};stagedAttempts.set(value.eventKey,value);return clone(value);},
    updateMany:async({where,data})=>{let count=0;for(const[rk,r]of attempts)if(matches(r,where)){stagedAttempts.set(rk,{...clone(r),...clone(data),updatedAt:new Date()});count++;}return{count};},
    deleteMany:async({where})=>{let count=0;for(const[k,v]of attempts)if(matches(v,where)){attempts.delete(k);count++;}return{count};},
    count:async({where})=>[...attempts.values()].filter(x=>matches(x,where)).length},
   vapiBusinessMapping:{findMany:async()=>[]},};
 }
 const root=db(rows,attempts);
 root.$transaction=async fn=>{const r=new Map(),a=new Map(),value=await fn(db(r,a));for(const[k,v]of r)rows.set(k,v);for(const[k,v]of a)attempts.set(k,v);return value;};
 return root;
}
async function fixture({prisma=memoryPrisma(),imported=false,pending=false,fileStore=false,fence=createAssociationFence()}={}){
 const state={now:Date.now(),enabled:true,apply:true,actor:null,imports:0,fileWrites:0,requests:[],hook:null,lost:false,wrong:false,failFile:false};
 state.pendingGate={url:'https://fixture.invalid'+pendingPath,secret:'invented-pending-gate-secret-not-live-0000'};
 const secret='invented-signing-key-not-live',number='+13655550123',aid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',pid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const raw={business:{name:'Fictitious '+crypto.randomUUID(),services:'Invented roof repair'},owner:{name:'Invented Owner',email:'owner@example.invalid',phone:'+19055550123'},aiAssistant:{businessType:'Roofing',serviceArea:'Fictitious region'}};
 const payload=normalizeSignupProvisioningPayload(raw,{signingSecret:secret}),key=payload.provisioning.idempotencyKey,id='signup_'+crypto.randomBytes(16).toString('hex');
 const config=buildSignupAssistantConfig(payload,{assignedPhone:number,resourceName:buildProvisioningResourceName('vapi-assistant',key)});
 const attempt=await prisma.signupAttempt.create({data:{eventKey:id,publicId:crypto.randomUUID(),statusTokenHash:'fixture-no-login',businessName:raw.business.name,ownerEmail:raw.owner.email,ownerPhone:raw.owner.phone,payload:raw,status:'setup_error',stage:'needs_attention',lastErrorCode:'SYNTHETIC_OLD_ERROR',expiresAt:new Date(state.now+600000)}});
 const target={attemptRowId:attempt.id,attemptId:id,idempotencyKey:key,contextHash:payload.provisioning.contextHash,number,twilioSid:'PN'+'1'.repeat(32),assistantId:aid,release:'b'.repeat(40),configFingerprint:crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex')};
 const context={signupEventKey:id,contextHash:target.contextHash,idempotencyKey:key,payload};
 const phone={id:pid,number,assistantId:aid,name:buildProvisioningResourceName('vapi-phone',key),smsEnabled:false};
 if(pending){delete phone.assistantId;Object.assign(phone,{provider:'twilio',twilioAccountSid:'AC'+'2'.repeat(32),server:pendingServer(state.pendingGate)});}
 const importResult=pending?{...clone(phone),assistantId:aid,attachedAssistantId:null,routeMode:'setup-pending',pendingGate:pendingGateProof(state.pendingGate)}:clone(phone);
 if(pending)delete importResult.server;
 state.phones=imported?[clone(phone)]:[];state.assistant={...clone(config),id:aid};
 const data=[context,{status:'completed',contextHash:target.contextHash,result:{twilioPhoneNumber:number,twilioSid:target.twilioSid}},
  {status:'completed',contextHash:target.contextHash,result:{assistantId:aid,contentFingerprint:fingerprintAssistantContent(config)}},
  ...imported?[{status:'completed',contextHash:target.contextHash,result:importResult}]:[]];
 const keys=[contextStoreKey(key),provisioningStateKey('twilio-number',key),provisioningStateKey('vapi-assistant',key),...imported?[provisioningStateKey('vapi-import',key)]:[]];
 for(let i=0;i<keys.length;i++)await prisma.runtimeStore.create({data:{key:keys[i],data:data[i]}});
 let store={original:{signupAttemptId:id,businessName:raw.business.name,ownerEmail:raw.owner.email,ownerPhone:raw.owner.phone,status:'setup_error',identityVerified:true,
  trialStartAt:new Date(state.now-3600000).toISOString(),trialEndAt:new Date(state.now+86400000).toISOString(),agentTestStatus:'failed',history:['preserve original failure']},
  other:{signupAttemptId:'signup_'+crypto.randomBytes(16).toString('hex'),businessName:'Unrelated invented record',status:'archived',history:['preserve']}};
 if(pending){delete store.original.trialStartAt;delete store.original.trialEndAt;}
 let directory,file;
 if(fileStore){directory=fs.mkdtempSync(path.join(os.tmpdir(),'connection-fixture-'));file=path.join(directory,'dashboard.json');fs.writeFileSync(file,JSON.stringify(store));}
 const readStore=()=>file?JSON.parse(fs.readFileSync(file,'utf8')):clone(store);
 const writeFixture=next=>{if(file)fs.writeFileSync(file,JSON.stringify(next));else store=clone(next);};
 const sessionSecret='invented-auth-session-key',sessionPayload=Buffer.from(JSON.stringify({exp:state.now+300000})).toString('base64url');
 const token=sessionPayload+'.'+crypto.createHmac('sha256',sessionSecret).update(sessionPayload).digest('hex');
 const actor=crypto.createHash('sha256').update('signup-no-send-connection-session:v1\0').update(token).digest('hex');state.actor=actor;
 state.policy={version:1,policyId:'c'.repeat(64),operatorSessionHash:actor,release:target.release,target,operation:imported?'associate':pending?'stage':'connect',expiresAt:new Date(state.now+600000).toISOString()};
 const provider=async(url,options={})=>{
  const method=options.method||'GET';state.requests.push({method,url});await state.hook?.({url,method});
  if(options.redirect!=='error')throw Error('redirect policy missing');
  let body;
  if(method==='GET'&&url.startsWith('https://api.twilio.com/2010-04-01/Accounts/'))body={next_page_uri:null,incoming_phone_numbers:[{sid:target.twilioSid,phone_number:number,account_sid:'AC'+'2'.repeat(32),friendly_name:buildProvisioningResourceName('twilio-number',key),capabilities:{voice:true,sms:true},voice_url:'https://fixture.invalid/voice'}]};
  else if(method==='GET'&&url==='https://api.vapi.ai/assistant?limit=1000')body=[{id:aid,name:config.name}];
  else if(method==='GET'&&url==='https://api.vapi.ai/assistant/'+aid)body=state.assistant;
  else if(method==='GET'&&url==='https://api.vapi.ai/phone-number?limit=1000')body=state.phones;
  else if(method==='GET'&&url==='https://api.vapi.ai/phone-number/'+pid)body=state.phones[0];
  else if(method==='POST'&&url==='https://api.vapi.ai/phone-number/import/twilio'){
   const sent=JSON.parse(options.body);if(sent.twilioPhoneNumber!==number||sent.assistantId!==aid||sent.smsEnabled!==false)throw Error('wrong synthetic scope');
   state.imports++;state.phones=[{...clone(phone),...(state.wrong?{assistantId:'foreign'}:{})}];
   if(state.lost)throw Object.assign(Error('Invented lost acknowledgement'),{code:'ETIMEDOUT'});body={id:pid};
  }else if(method==='POST'&&url==='https://api.vapi.ai/phone-number'){
   const sent=JSON.parse(options.body);if(sent.provider!=='twilio'||sent.number!==number||sent.twilioPhoneNumber!==undefined||sent.smsEnabled!==false
    ||sent.assistantId||sent.squadId||sent.workflowId||sent.fallbackDestination||sent.server?.url!==state.pendingGate.url
    ||sent.server?.secret!==undefined||sent.server?.headers?.['x-vapi-secret']!==state.pendingGate.secret)throw Error('wrong synthetic pending scope');
   state.imports++;state.phones=[{id:pid,number,name:sent.name,provider:'twilio',twilioAccountSid:sent.twilioAccountSid,smsEnabled:false,server:clone(sent.server),...(state.wrong?{assistantId:'foreign'}:{})}];
   if(state.lost)throw Object.assign(Error('Invented lost acknowledgement'),{code:'ETIMEDOUT'});body={id:pid};
  }else throw Error('Refused unexpected transport: no provider/sender/purchase/Make escape');
  return {ok:true,json:async()=>clone(body)};
 };
 const transport=createConnectionTransport({fetchImpl:provider,getVapiKey:()=> 'invented-vapi-key',getPendingGate:()=>state.pendingGate,getTwilioCredentials:()=>({accountSid:'AC'+'2'.repeat(32),authToken:'4'.repeat(32)})});
 const options={prisma,fence,readStore,commitStore:project=>{state.fileWrites++;if(state.failFile)throw Error('Invented file failure');if(file)atomicCommitAssociationFile(file,project);else store=project(clone(store));},
  transport,getPendingGate:()=>state.pendingGate,getSigningSecret:()=>secret,getRelease:()=>target.release,getPolicy:()=>state.policy,enabled:()=>state.enabled,applyEnabled:()=>state.apply,singleWriter:()=>true,now:()=>state.now};
 const make=()=>createConnectionControl(options),service=make(),auth={actorHash:actor,reauthorize:()=>state.actor};
 const preview=svc=>(svc||service).execute({action:'preview',policyId:state.policy.policyId},auth);
 const approve=plan=>{state.policy.approvedPlanDigest=plan.planDigest;return {action:'apply',policyId:state.policy.policyId,planDigest:plan.planDigest,confirmation:'NO_SEND_'+state.policy.operation.toUpperCase()};};
 async function cleanup(){
  await prisma.runtimeStore.deleteMany({where:{key:{in:[...keys,provisioningStateKey('vapi-import',key),journalKey('connect',target),journalKey('associate',target)]}}});
  await prisma.signupAttempt.deleteMany({where:{eventKey:id}});
  if(directory){const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('connection-fixture-')||fs.lstatSync(resolved).isSymbolicLink())throw Error('Refuse unowned cleanup');fs.rmSync(resolved,{recursive:true});}
 }
 return {state,target,attempt,context,keys,prisma,options,make,service,auth,preview,approve,readStore,writeFixture,cleanup,directory,file,token,sessionSecret};
}
function registerFixtureHttp(app,f){
 const source=fs.readFileSync(require.resolve('../../server/index'),'utf8').replace(/\r\n/g,'\n');
 const extract=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<=a)throw Error('auth source boundary changed');return source.slice(a,b);};
 const ctx={crypto,Buffer,Date:{now:()=>f.state.now},ADMIN_SESSION_COOKIE:'fixture_session',ADMIN_TOTP_SECRET:'fixture-required',
  signAdminSessionPayload:p=>crypto.createHmac('sha256',f.sessionSecret).update(p).digest('hex'),hasValidAdminPassword:()=>false};
 vm.createContext(ctx);vm.runInContext(extract('function parseCookies(','\nfunction getAdminPassword(')
  +extract('function hasValidAdminSession(','\nfunction setAdminSessionCookie(')
  +extract('function requireAdmin(','\nfunction getAdminActorHash('),ctx);
 const actorHash=req=>ctx.hasValidAdminSession(req)?crypto.createHash('sha256').update('signup-no-send-connection-session:v1\0').update(ctx.parseCookies(req).fixture_session).digest('hex'):'';
 registerConnectionControl({app,requireAdmin:ctx.requireAdmin,limiter:(_req,_res,next)=>next(),isAllowedOrigin:o=>o==='https://fixture.invalid',actorHash,service:f.service});
 const webhook={getVapiWebhookSecret:()=>f.state.pendingGate.secret,safeEqualString:(a,b)=>a===b};vm.createContext(webhook);
 vm.runInContext(extract('function hasValidVapiWebhookKey(','\nfunction getPublicBaseUrl(')
  +extract('function requireVapiWebhookKey(','\nconst captureProvisioningAuthFailure='),webhook);
 registerPendingSetupGate({app,authenticate:webhook.requireVapiWebhookKey,limiter:(_req,_res,next)=>next()});
}
module.exports={fixture,memoryPrisma,registerFixtureHttp};
