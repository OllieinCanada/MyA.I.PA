'use strict';
// Child of the sealed CI controller only. Actual HTTP/application/Prisma;
// no application workers and no provider transport beyond a loopback mock.
const assert=require('node:assert/strict'),path=require('node:path');
const dbName=process.env.PILOT_SQL_DATABASE;
assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.match(dbName||'',/^myaipa_pilot_[a-f0-9]{12}$/);
assert.equal(process.env.RUN_PILOT_SAFETY_SQL,'1');
const data=process.env.DATA_DIR;
assert.ok(path.isAbsolute(data)&&path.basename(path.dirname(data)).startsWith('myaipa-pilot-sql-'));
const providerPort=Number(process.env.PILOT_MOCK_PORT);assert.ok(Number.isInteger(providerPort)&&providerPort>0&&providerPort<65536);
const keep=Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const requireMapping=process.env.PILOT_REQUIRE_MAPPING!=='false';
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,keep,{NODE_ENV:'test',CI:'true',DISABLE_LOCAL_ENV_FILES:'1',DATA_DIR:data,DATABASE_URL:'',
 SECURITY_STATE_FORCE_DATABASE:'false',ADMIN_PASSWORD:'fixture-only-admin',VAPI_WEBHOOK_SECRET:'fixture-only-webhook',
 VAPI_API_KEY:'fixture-only-key',VAPI_SMS_ASSISTANT_ID:'fixture-sms-assistant',VAPI_SMS_PHONE_NUMBER_ID:'fixture-sms-phone',
 VAPI_API_BASE_URL:'http://127.0.0.1:'+providerPort,VAPI_BUSINESS_MAP:'{}',VAPI_REQUIRE_BUSINESS_MAPPING:String(requireMapping),VAPI_DEFAULT_BUSINESS_ID:'37',
 TRIAL_REMINDER_DISABLE:'true',VAPI_AUTO_SYNC_ENABLED:'false',MISSED_CALL_ALERT_ENABLED:'false',DAILY_DIGEST_ENABLED:'false',
 SIGNUP_SETUP_WORKER_PAUSED:'true',TRIAL_USAGE_LIMIT_ENABLED:'true',LEAD_ACK_SECRET:'fixture-only-acknowledgement',
 STORE_CALL_TRANSCRIPTS:'false',STORE_CALL_RECORDING_URLS:'false'});
const {PrismaClient}=require('@prisma/client');
const prisma=new PrismaClient({datasources:{db:{url:'postgresql://pilot_fixture:synthetic-ci-only@127.0.0.1:5432/'+dbName+'?connection_limit=3'}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
let mode='',remaining=0,server,guard,releaseReceiptRead;
const wrapped=new Proxy(prisma,{get(target,key){
 if(key==='leadNotificationAttempt')return new Proxy(target[key],{get(model,method){if(method==='update')return async arg=>{
  if(mode==='permanent')throw Error('FIXTURE_RECEIPT_PERSISTENCE');
  if(['once','ack-lost'].includes(mode)&&arg.data.status==='ACCEPTED'&&remaining>0){remaining--;if(mode==='ack-lost')await model.update(arg);throw Error('FIXTURE_RECEIPT_PERSISTENCE');}
  return model.update(arg);
 };if(method==='findUnique')return async arg=>{const row=await model.findUnique(arg);if(mode==='pause-receipt-read'){mode='';process.send({type:'receipt-read-paused'});await new Promise(resolve=>{releaseReceiptRead=resolve;});}return row;};const v=model[method];return typeof v==='function'?v.bind(model):v;}});
 const value=target[key];return typeof value==='function'?value.bind(target):value;
}});
global.__myAiPaPrisma=wrapped;
async function main(){
 await prisma.$connect();const {app,__test}=require('../server/index');
 __test.upsertSignupDashboardRecord({signupAttemptId:'fixture-sql-signup',businessId:37,businessName:'Fictitious SQL Pilot',ownerEmail:'fixture@example.invalid',ownerPhone:'+15555550100',businessPhone:'+15555550100',twilioPhoneNumber:'+15555550101',vapiPhoneNumberId:'fixture-sql-phone',vapiAssistantId:'fixture-sql-assistant',subscriptionId:'fixture-subscription',subscriptionStatus:'trialing',status:'setup_ready',trialStartAt:Date.now()-60000,trialEndAt:Date.now()+86400000});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 guard=require('./local-staging-egress').install({ports:[5432,providerPort,server.address().port]});
 process.send({type:'ready',port:server.address().port});
 process.on('message',async message=>{try{
  let result;
  if(message.type==='mode'){assert.ok(['','once','ack-lost','permanent','pause-receipt-read'].includes(message.mode));mode=message.mode;remaining=mode?1:0;result={ok:true};}
  else if(message.type==='release-receipt-read'){releaseReceiptRead?.();result={ok:true};}
  else if(message.type==='dispatch'){assert.match(message.handoffId||'',/^c[a-z0-9]+$/);result=await require('../server/leadHandoffs').dispatchLeadHandoff(message.handoffId,message.role==='BACKUP'?'BACKUP':'OWNER');}
  else if(message.type==='due')result=await require('../server/leadHandoffs').processDueLeadHandoffs();
  else if(message.type==='receipt')result=await require('../server/leadHandoffs').applyProviderEvent(message.payload);
  else if(message.type==='override'){process.env.VAPI_BUSINESS_MAP=JSON.stringify(message.value);result={ok:true};}
  else if(message.type==='stop'){
   server.closeAllConnections?.();await new Promise(r=>server.close(r));await prisma.$disconnect();
   process.send({id:message.id,result:{stopped:true,guard:guard.status()}});process.disconnect();return;
  }else throw Error('FIXTURE_COMMAND_REFUSED');
  process.send({id:message.id,result});
 }catch(error){process.send({id:message.id,error:{code:error.code||'FIXTURE_WORKER_COMMAND_FAILED'}});}});
}
main().catch(()=>{if(process.send)process.send({type:'startup-error'});process.exitCode=1;});
