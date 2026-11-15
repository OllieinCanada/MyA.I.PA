const test = require('node:test');
const assert = require('node:assert/strict');
const {prepareEnrollment,metadataForCalendar,policyFromSubscription,policyFromSignup,calendarTrialCopy,enrollmentKey} = require('../server/trialCalendarPolicy');
const {getTrialPaymentState,getStoredTrialPaymentState,buildTrialReminderSchedule,completeTrialPaymentSetup} = require('../server/stripeTrialBilling');
const {getTrialLifecycle,decideTrialCall} = require('../server/trialUsagePolicy');
const {signupBusinessKey} = require('../server/signupBusinessIdentity');
const {memoryCalendarDb} = require('./helpers/trial-calendar-fixture');
const identity = {businessName:'Fictitious Calendar Electric',ownerEmail:'calendar@example.invalid',ownerPhone:'+19055550123'};
const businessKey = signupBusinessKey(identity);
const now = Date.parse('2026-11-15T00:30:00Z');
async function fixture() {
  const f=memoryCalendarDb();
  const calendar=await prepareEnrollment({db:f.db,businessKey,priceId:'price_fixture',now});
  const subscription={id:'sub_fixture',status:'trialing',trial_start:now/1000,trial_end:Date.parse(calendar.serviceCutoffAt)/1000,
    metadata:{source:'my-ai-pa-signup',trialType:'no-card',businessKey,...metadataForCalendar(calendar)}};
  const policy=policyFromSubscription(subscription);
  const signup={...identity,subscriptionId:subscription.id,subscriptionStatus:'trialing',trialStartAt:now,
    trialEndAt:subscription.trial_end*1000,trialCalendarPolicy:policy};
  return {...f,calendar,subscription,signup};
}
test('concurrent enrollment and reconstructed writer preserve one durable anchor and exact request metadata',async()=>{
  const f=memoryCalendarDb();
  const params={db:f.db,businessKey,priceId:'price_fixture',now};
  const plans=await Promise.all(Array.from({length:12},(_,i)=>prepareEnrollment({...params,now:now+i*1000})));
  for(const p of plans)assert.deepEqual(metadataForCalendar(p),metadataForCalendar(plans[0]));
  assert.equal(f.rows.size,1);
  assert.deepEqual(await prepareEnrollment({...params,now:now+2000}),plans[0]);
});
test('price conflict, corrupted version, expired anchors and missing durable storage refuse enrollment',async()=>{
  const f=await fixture();
  await assert.rejects(prepareEnrollment({db:f.db,businessKey,priceId:'another_price',now}),{code:'TRIAL_CALENDAR_PROOF_INVALID'});
  await assert.rejects(prepareEnrollment({db:f.db,businessKey,priceId:'price_fixture',now:Date.parse(f.calendar.serviceCutoffAt)}),{code:'TRIAL_CALENDAR_ENROLLMENT_STALE'});
  f.rows.get(enrollmentKey(businessKey)).version='untrusted';
  await assert.rejects(prepareEnrollment({db:f.db,businessKey,priceId:'price_fixture',now}),{code:'TRIAL_CALENDAR_PROOF_INVALID'});
  await assert.rejects(prepareEnrollment({businessKey,priceId:'price_fixture',now}),{code:'TRIAL_CALENDAR_PROOF_INVALID'});
});
test('trusted subscription proof requires exact source, business, version and cutoff',async()=>{
  const f=await fixture();
  assert.deepEqual(policyFromSignup(f.signup),policyFromSubscription(f.subscription));
  for(const patch of [{trialCalendarVersion:'other'},{source:'browser'},{trialCalendarCutoff:'1'},{businessKey:'guess'},{trialCalendarAnchor:'invalid'}]) {
    assert.throws(()=>policyFromSubscription({...f.subscription,metadata:{...f.subscription.metadata,...patch}}));
  }
  assert.throws(()=>policyFromSubscription({...f.subscription,trial_end:f.subscription.trial_end+1}));
  assert.throws(()=>policyFromSignup({...f.signup,businessName:'Another Business'}));
  assert.throws(()=>policyFromSignup({...f.signup,subscriptionId:'sub_other'}));
});
test('day 15 is allowed until the exact cutoff; canceled, archived, unpaid and paused states remain blocked',async()=>{
  const f=await fixture();const end=Date.parse(f.calendar.serviceCutoffAt);
  assert.equal(getTrialLifecycle(f.signup,end-1).state,'trial');
  assert.equal(getTrialLifecycle(f.signup,end).state,'ended');
  for(const subscriptionStatus of ['canceled','paused','past_due','unpaid','incomplete_expired']) {
    assert.equal(decideTrialCall({lifecycle:getTrialLifecycle({...f.signup,subscriptionStatus},end-1)}).action,'block');
  }
  assert.equal(getTrialLifecycle({...f.signup,archivedAt:'fixture'},end-1).state,'archived');
  assert.equal(decideTrialCall({lifecycle:getTrialLifecycle(f.signup,end-1),usedSeconds:3600}).action,'block');
});
test('payment setup opens on day 14 without ending free access, and cancellation or a saved card still prevents another checkout',async()=>{
  const f=await fixture();const day14=Date.parse(f.calendar.day14ReminderWindow.opensAt);
  assert.equal(getStoredTrialPaymentState(f.signup,{now:day14-1}).checkoutAvailable,false);
  assert.equal(getStoredTrialPaymentState(f.signup,{now:day14}).checkoutAvailable,true);
  assert.equal(getTrialPaymentState(f.subscription,{now:day14}).checkoutAvailable,true);
  assert.equal(getTrialPaymentState(f.subscription,{now:day14}).trialEnded,false);
  assert.equal(getStoredTrialPaymentState({...f.signup,cancelAtPeriodEnd:true},{now:day14}).checkoutAvailable,false);
  assert.equal(getTrialPaymentState({...f.subscription,default_payment_method:'pm_fixture'},{now:day14}).checkoutAvailable,false);
});
test('legacy accounts keep original expiry, reminder schedule and checkout eligibility',async()=>{
  const f=await fixture();const legacy={...f.signup};delete legacy.trialCalendarPolicy;
  const originalEnd=now+14*86400000;legacy.trialEndAt=originalEnd;
  const before=structuredClone(legacy);
  assert.equal(policyFromSubscription({...f.subscription,metadata:{source:'my-ai-pa-signup'}}),null);
  assert.equal(getTrialLifecycle(legacy,originalEnd).state,'ended');
  assert.equal(getStoredTrialPaymentState(legacy,{now:originalEnd-1}).checkoutAvailable,false);
  assert.deepEqual(Object.keys(buildTrialReminderSchedule(originalEnd)),['7-days','3-days','1-days','payment-due']);
  assert.deepEqual(legacy,before);
});
test('day-14 and final notices use the canonical calendar, preserve sent receipts and refuse mismatched schedule proof',async()=>{
  const f=await fixture();const end=Date.parse(f.calendar.serviceCutoffAt);
  const schedule=buildTrialReminderSchedule(end,{'day-14':{sentAt:'2026-11-27T05:01:00Z'}},f.calendar);
  assert.equal(schedule['day-14'].dueAt,Date.parse('2026-11-27T05:00:00Z'));
  assert.equal(schedule['day-14'].expiresAt,Date.parse('2026-11-28T05:00:00Z'));
  assert.equal(schedule['day-14'].status,'sent');
  assert.equal(schedule['payment-due'].dueAt,end);
  assert.throws(()=>buildTrialReminderSchedule(end+1000,{},f.calendar));
  const copy=calendarTrialCopy(f.calendar);
  assert.match(copy.description,/day 14/);assert.match(copy.description,/day 15/);
  assert.match(copy.paymentMessage,/Toronto/);assert.doesNotMatch(copy.description,/trial.*complete\./);
});

test('saving a card during calendar grace does not resume/invoice/charge early or alter the cutoff',async()=>{
  const f=await fixture();const calls=[];
  const subscription={...f.subscription,customer:'cus_fixture'};
  const stripe={setupIntents:{retrieve:async()=>({status:'succeeded',customer:'cus_fixture',payment_method:'pm_fixture'})},
    customers:{update:async()=>{calls.push('save_customer_method');}},
    subscriptions:{retrieve:async()=>subscription,update:async(_id,patch)=>{calls.push('save_subscription_method');return {...subscription,...patch};},
      resume:async()=>{throw Error('Early resume forbidden');}},invoices:{pay:async()=>{throw Error('Early payment forbidden');}}};
  const result=await completeTrialPaymentSetup({stripe,session:{mode:'setup',customer:'cus_fixture',setup_intent:'seti_fixture',
    metadata:{purpose:'trial-payment-method',subscriptionId:subscription.id}}});
  assert.deepEqual(calls,['save_customer_method','save_subscription_method']);
  assert.equal(result.subscription.status,'trialing');
  assert.equal(result.subscription.trial_end,subscription.trial_end);
});
