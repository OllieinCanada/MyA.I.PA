const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {calendarForAnchor,metadataForCalendar,VERSION} = require('../server/trialCalendarPolicy');
const {signupBusinessKey} = require('../server/signupBusinessIdentity');
const {memoryCalendarDb} = require('./helpers/trial-calendar-fixture');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-trial-calendar-http-'));
const realNow=Date.now;Date.now=()=>Date.parse('2026-11-27T12:00:00Z');
Object.assign(process.env,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',DATA_DIR:directory,DATABASE_URL:'',
  STRIPE_SECRET_KEY:'sk_test_synthetic_calendar_only',STRIPE_PRICE_ID:'price_calendar_fixture',STRIPE_TRIAL_DAYS:'14',
  ADMIN_SESSION_SECRET:'synthetic-calendar-session-secret',TRIAL_REMINDER_DISABLE:'true',VAPI_AUTO_SYNC_ENABLED:'false',
  VAPI_API_KEY:'',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:'',SMTP_HOST:'',
  MISSED_CALL_ALERT_ENABLED:'false',DAILY_DIGEST_ENABLED:'false',SIGNUP_SETUP_WORKER_PAUSED:'true'});
let subscription,checkouts=[];
const client={subscriptions:{retrieve:async()=>structuredClone(subscription)},checkout:{sessions:{create:async params=>{
  checkouts.push(params);return{id:'cs_fixture',url:'https://checkout.stripe.com/synthetic-only'};
}}}};
const stripePath=require.resolve('stripe');
require.cache[stripePath]={id:stripePath,filename:stripePath,loaded:true,exports:function SyntheticStripe(){return client;}};
global.__myAiPaPrisma=new Proxy({}, {get:(_target,key)=>typeof key!=='string'||key==='then'?undefined:
  key==='$disconnect'?async()=>{}:key.startsWith('$')?async()=>{throw Error('Unexpected database action');}:
  new Proxy({},{get:()=>async()=>{throw Error('Unexpected database action');}})});
const actualFetch=global.fetch;let unexpectedOutbound=0;
global.fetch=(url,options)=>{
  if(new URL(url).hostname!=='127.0.0.1'){unexpectedOutbound++;throw Error('Provider transport refused');}
  return actualFetch(url,options);
};
const {app,__test}=require('../server/index');
let server,base;
test.before(async()=>{
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  global.fetch=actualFetch;Date.now=realNow;
  try {assert.equal(unexpectedOutbound,0);server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
  finally {assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('myaipa-trial-calendar-http-'));fs.rmSync(directory,{recursive:true,force:true});}
});
const identity={businessName:'Calendar HTTP Fixture',ownerEmail:'calendar-http@example.invalid',ownerPhone:'+19055550123'};
const businessKey=signupBusinessKey(identity);
const calendar=calendarForAnchor({trialStartAt:'2026-11-15T00:30:00Z'});
function seed({legacy=false}={}) {
  checkouts=[];
  subscription={id:'sub_http_fixture',customer:'cus_http_fixture',status:'trialing',trial_start:Date.parse(calendar.trialStartAt)/1000,
    trial_end:Date.parse(calendar.serviceCutoffAt)/1000,
    metadata:{...identity,source:'my-ai-pa-signup',trialType:'no-card',businessKey,...(legacy?{}:metadataForCalendar(calendar))}};
  return __test.upsertSignupDashboardFromSubscription(subscription);
}
async function post(auth=true) {
  const cookie=auth?`myaipa_customer_dashboard_session=${__test.createCustomerDashboardSessionToken({email:identity.ownerEmail,phone:identity.ownerPhone})}`:'';
  return fetch(`${base}/api/customer/dashboard/billing/setup`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});
}
test('actual billing HTTP route requires a signed customer session before any checkout',async()=>{
  seed();assert.equal((await post(false)).status,401);assert.equal(checkouts.length,0);
});
test('actual trusted projection enables day-14 hosted setup for the exact customer/subscription without charging',async()=>{
  const record=seed();assert.equal(record.trialCalendarPolicy.policy,VERSION);
  const response=await post();assert.equal(response.status,200);assert.equal((await response.json()).checkoutUrl,'https://checkout.stripe.com/synthetic-only');
  assert.equal(checkouts.length,1);assert.equal(checkouts[0].mode,'setup');
  assert.equal(checkouts[0].customer,'cus_http_fixture');assert.equal(checkouts[0].metadata.subscriptionId,'sub_http_fixture');
  assert.equal(checkouts[0].line_items,undefined);
});
test('actual route does not upgrade legacy subscription metadata or open checkout early',async()=>{
  seed({legacy:true});assert.equal((await post()).status,409);assert.equal(checkouts.length,0);
  assert.equal(subscription.metadata.trialCalendarVersion,undefined);
});
test('actual route rejects changed Stripe ownership and scheduled cancellation without checkout',async()=>{
  seed();subscription.customer='cus_another';assert.equal((await post()).status,409);assert.equal(checkouts.length,0);
  seed();subscription.cancel_at_period_end=true;assert.equal((await post()).status,409);assert.equal(checkouts.length,0);
});

test('bad calendar proof blocks setup/access but cannot prevent authoritative cancellation or paid-state persistence',async()=>{
  seed();subscription.metadata.trialCalendarCutoff='1';
  const response=await post();assert.equal(response.status,409);assert.equal((await response.json()).code,'TRIAL_CALENDAR_PROOF_INVALID');
  assert.equal(checkouts.length,0);
  const {getTrialLifecycle}=require('../server/trialUsagePolicy');
  const bad=__test.upsertSignupDashboardFromSubscription(subscription);
  assert.equal(bad.trialCalendarProofStatus,'invalid');assert.equal(getTrialLifecycle(bad).state,'unmanaged');
  const closed=__test.upsertSignupDashboardFromSubscription({...subscription,status:'canceled'});
  assert.equal(closed.subscriptionStatus,'canceled');assert.equal(getTrialLifecycle(closed).state,'ended');
  const paid=__test.upsertSignupDashboardFromSubscription({...subscription,status:'active',default_payment_method:'pm_fixture'});
  assert.equal(paid.subscriptionStatus,'active');assert.equal(getTrialLifecycle(paid).state,'paid');
});
test('existing stored account cannot opt itself in via an update; a genuinely new intake is server-enrolled',()=>{
  const old={...identity,businessName:'Old Fixture',signupAttemptId:'old_fixture',subscriptionId:'sub_old'};
  const before=__test.upsertSignupDashboardRecord(old);assert.equal(before.trialCalendarEnrollmentVersion,undefined);
  const after=__test.upsertSignupDashboardRecord({...old,trialCalendarEnrollmentVersion:VERSION});
  assert.equal(after.trialCalendarEnrollmentVersion,undefined);
  const fresh=__test.upsertSignupDashboardRecord({...identity,businessName:'New Fixture',signupAttemptId:'new_fixture'});
  assert.equal(fresh.trialCalendarEnrollmentVersion,VERSION);
});
test('actual new-subscription creation uses a durable calendar while existing subscriptions are reused unchanged',async()=>{
  const {db,rows}=memoryCalendarDb();let created,updates=0;
  const customer={id:'cus_create_fixture',metadata:{businessKey}};
  const fake={customers:{list:async()=>({data:[customer]}),update:async()=>customer},subscriptions:{
    list:async()=>({data:created?[created]:[]}),
    create:async data=>(created={...data,id:'sub_created_fixture',status:'trialing'}),
    update:async()=>{updates++;return created;},
  }};
  const options={db,calendarEligible:true,now:Date.parse(calendar.trialStartAt)};
  const first=await __test.createBusinessStripeTrial(identity,businessKey,fake,options);
  assert.equal(first.subscription.trial_end,Date.parse(calendar.serviceCutoffAt)/1000);
  assert.equal(first.subscription.trial_period_days,undefined);assert.equal(rows.size,1);
  const before=structuredClone(created);
  const second=await __test.createBusinessStripeTrial(identity,businessKey,fake,{...options,now:options.now+86400000});
  assert.equal(second.reused,true);assert.deepEqual(created,before);assert.equal(updates,1);assert.equal(rows.size,1);
});

test('a historical non-enrolled signup keeps the existing duration request and performs no calendar enrollment',async()=>{
  let created;
  const fake={customers:{list:async()=>({data:[{id:'cus_legacy_fixture',metadata:{businessKey}}]}),update:async()=>({id:'cus_legacy_fixture'})},
    subscriptions:{list:async()=>({data:[]}),create:async data=>(created={...data,id:'sub_legacy_fixture',status:'trialing'})}};
  const forbiddenDb={$transaction:()=>{throw Error('Legacy calendar enrollment is forbidden');}};
  await __test.createBusinessStripeTrial(identity,businessKey,fake,{db:forbiddenDb,calendarEligible:false});
  assert.equal(created.trial_period_days,14);assert.equal(created.trial_end,undefined);
  assert.equal(created.metadata.trialCalendarVersion,undefined);
});

test('an uncertain Stripe create is read/reused on retry, not dispatched a second time or given a new clock',async()=>{
  const {db}=memoryCalendarDb();let stored,creates=0;
  const fake={customers:{list:async()=>({data:[{id:'cus_uncertain',metadata:{businessKey}}]}),update:async()=>({id:'cus_uncertain'})},
    subscriptions:{list:async()=>({data:stored?[stored]:[]}),
      create:async data=>{creates++;stored={...data,id:'sub_uncertain',status:'trialing'};throw Error('synthetic lost provider acknowledgment');},
      update:async()=>stored}};
  const options={db,calendarEligible:true,now:Date.parse(calendar.trialStartAt)};
  await assert.rejects(__test.createBusinessStripeTrial(identity,businessKey,fake,options),/lost provider acknowledgment/);
  const before=structuredClone(stored);
  const retry=await __test.createBusinessStripeTrial(identity,businessKey,fake,{...options,now:options.now+86400000});
  assert.equal(retry.reused,true);assert.equal(creates,1);assert.deepEqual(stored,before);
});
