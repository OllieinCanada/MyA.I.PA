const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-voice-route-api-'));
Object.assign(process.env, { NODE_ENV:'test', DISABLE_LOCAL_ENV_FILES:'1', DATABASE_URL:'', DATA_DIR:directory,
  SECURITY_STATE_FORCE_DATABASE:'false', VAPI_WEBHOOK_SECRET:'synthetic-voice-route-secret', VAPI_API_KEY:'',
  TELEGRAM_BOT_TOKEN:'', TELEGRAM_CHAT_ID:'', STRIPE_SECRET_KEY:'', TWILIO_ACCOUNT_SID:'', TWILIO_AUTH_TOKEN:'',
  SMTP_HOST:'', MAKE_SIGNUP_WEBHOOK_URL:'', TRIAL_REMINDER_DISABLE:'true', VAPI_AUTO_SYNC_ENABLED:'false',
  MISSED_CALL_ALERT_ENABLED:'false', DAILY_DIGEST_ENABLED:'false', SIGNUP_SETUP_WORKER_PAUSED:'true', TRIAL_USAGE_LIMIT_ENABLED:'true' });
const rows = new Map(); let usedSeconds=0, transactions=0, delayGate=false, releaseGate;
const clone = value => structuredClone(value);
const db = {
  runtimeStore: {
    findMany: async ({where}) => {
      if (delayGate) await new Promise(resolve => { releaseGate=resolve; });
      return (where.key?.in || []).filter(key=>rows.has(key)).map(key=>({key,data:clone(rows.get(key))}));
    },
    findUnique: async ({where}) => rows.has(where.key)?{key:where.key,data:clone(rows.get(where.key))}:null,
    upsert: async ({where,create,update}) => {
      const data=rows.has(where.key)?(update.data ?? rows.get(where.key)):create.data;
      rows.set(where.key,clone(data));return{key:where.key,data:clone(data)};
    },
  },
  call: { aggregate:async()=>({_sum:{durationSec:usedSeconds},_count:{_all:0}}) },
  $queryRaw:async(strings)=>strings.join('?').includes('pg_try_advisory_xact_lock')?[{acquired:true}]:[],
  $transaction:async(fn)=>{transactions++;return fn(db);},
};
global.__myAiPaPrisma=new Proxy(db,{get(target,key){
  if(key in target)return target[key];
  if(typeof key!=='string'||key==='then')return undefined;
  const forbidden=async()=>{throw Error(`Unexpected synthetic database access: ${key}`);};
  return key.startsWith('$')?forbidden:new Proxy({},{get:(_model,method)=>method==='then'?undefined:forbidden});
}});
const {app,__test}=require('../server/index');
const signup={signupAttemptId:'voice-route-attempt',businessId:37,businessName:'Synthetic Electric',ownerEmail:'voice@example.invalid',
  ownerPhone:'+15555550100',businessPhone:'+15555550100',twilioPhoneNumber:'+15555550101',vapiPhoneNumberId:'voice-phone',
  vapiAssistantId:'voice-assistant',subscriptionId:'voice-subscription',subscriptionStatus:'trialing',status:'setup_ready',
  trialStartAt:Date.now()-60000,trialEndAt:Date.now()+86400000};
const gate={status:'active',businessId:37,assistantId:'voice-assistant',phoneNumberId:'voice-phone',phoneNumber:'+15555550101',
  subscriptionId:'voice-subscription',signupAttemptId:signup.signupAttemptId,assistantMaxSeconds:300,fallbackPhone:signup.ownerPhone};
const keys=['trial-voice-gate:phone-id:voice-phone','trial-voice-gate:number:+15555550101'];
let server, base;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
beforeEach(()=>{
  rows.clear();usedSeconds=0;transactions=0;delayGate=false;releaseGate=null;
  for(const key of keys)rows.set(key,clone(gate));
  __test.upsertSignupDashboardRecord({...signup});
});
after(async()=>{
  releaseGate?.();await new Promise(resolve=>setImmediate(resolve));server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('myaipa-voice-route-api-'));
  fs.rmSync(directory,{recursive:true,force:true});
});
async function call(id='synthetic-call'){
  return fetch(`${base}/api/webhooks/voice`,{method:'POST',headers:{'content-type':'application/json','x-vapi-secret':'synthetic-voice-route-secret'},
    body:JSON.stringify({message:{type:'assistant-request',call:{id,phoneNumberId:'voice-phone',customer:{number:'+15555550102'},transport:{forwardedFrom:signup.ownerPhone}}}})});
}
test('real HTTP assistant-request authorizes the exact saved assistant and reserves allowance once',async()=>{
  const response=await call();assert.equal(response.status,200);assert.deepEqual(await response.json(),{assistantId:'voice-assistant'});
  const replay=await call();assert.deepEqual(await replay.json(),{assistantId:'voice-assistant'});
  const reservations=[...rows.values()].find(row=>row.reservations);
  assert.equal(Object.keys(reservations.reservations).length,1);assert.equal(transactions,2);
});
test('two conflicting route aliases fail closed before any allowance or provider action',async()=>{
  rows.set(keys[1],{...gate,assistantId:'other-business-assistant'});
  const response=await call();assert.ok((await response.json()).error);assert.equal(transactions,0);
});

test('one paused route alias cannot be bypassed using the active phone-ID alias',async()=>{
  rows.set(keys[1],{...gate,status:'paused'});
  const response=await call();assert.ok((await response.json()).error);assert.equal(transactions,0);
});
test('a trial-limit hold never transfers back to the forwarding owner and keeps its policy explanation',async()=>{
  usedSeconds=3300;const response=await call('blocked-call');const body=await response.json();
  assert.ok(body.error);assert.equal(body.destination,undefined);
  assert.equal(rows.get('voice-call-policy:blocked-call').decision,'block');
});
test('a stalled gate lookup returns safely inside Vapi deadline without late authorization',async()=>{
  delayGate=true;const started=Date.now();const response=await call('late-call');const body=await response.json();
  assert.ok(body.error);assert.ok(Date.now()-started<7000);assert.equal(transactions,0);
  releaseGate();await new Promise(resolve=>setImmediate(resolve));assert.equal(transactions,0);
});
