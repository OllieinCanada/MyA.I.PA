const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveCall}=require('../server/trialCallReservation');
const {createAssistantRequestGuard}=require('../server/voiceCallReliability');
const {decideTrialCall,getTrialLifecycle,buildTrialFallbackDestination}=require('../server/trialUsagePolicy');
const signup={subscriptionStatus:'trialing',trialStartAt:Date.now()-10000,trialEndAt:Date.now()+86400000};
const limits={maxCallSeconds:300,warningSeconds:1200,limitSeconds:3600,completionReserveSeconds:300,minCallSeconds:30,reservationGraceSeconds:60};

function fixture({used=0,acquired=true,seed={},afterWrite=()=>{}}={}) {
  let saved=structuredClone(seed);const queries=[];let options;
  const db={$transaction:async(fn,opts)=>{
    options=opts;const working=structuredClone(saved);
    const tx={$queryRaw:async strings=>{const sql=strings.join('?');queries.push(sql);return sql.includes('pg_try_advisory')?[{acquired}]:[];},
      runtimeStore:{findUnique:async({where})=>working[where.key]?{data:working[where.key]}:null,
        upsert:async({where,create})=>{working[where.key]=create.data;afterWrite();return{data:create.data};}}};
    const result=await fn(tx);saved=working;return result;
  }};
  const params={db,signup,config:{businessId:37,assistantMaxSeconds:300},callId:'test-call',key:'reservations',callIndexKey:'call-index',
    getUsedSeconds:async()=>used,getLifecycle:getTrialLifecycle,decide:decideTrialCall,limits,guard:createAssistantRequestGuard()};
  return{params,saved:()=>saved,queries,options:()=>options};
}
test('successful allowance is durably reserved exactly once with bounded transaction settings',async()=>{
  const f=fixture();assert.equal((await reserveCall(f.params)).action,'allow-saved');
  assert.equal(f.saved().reservations.reservations['test-call'].allowanceSeconds,300);
  assert.equal(f.saved()['call-index'].businessId,37);
  assert.ok(f.options().timeout<=1800);assert.ok(f.options().maxWait<=300);
  assert.ok(f.queries.some(q=>q.includes('pg_try_advisory_xact_lock')));
  assert.ok(f.queries.every(q=>!q.includes('SELECT pg_advisory_xact_lock')));
  assert.equal((await reserveCall(f.params)).duplicateReservation,true);
  assert.equal(Object.keys(f.saved().reservations.reservations).length,1);
});
test('a busy reservation lock fails promptly without changing allowance or invoking a provider',async()=>{
  const f=fixture({acquired:false});await assert.rejects(reserveCall(f.params),{code:'VOICE_TRIAL_RESERVATION_BUSY'});
  assert.deepEqual(f.saved(),{});
});
test('quota cutoff blocks without a reservation and preserves an honest policy receipt',async()=>{
  const f=fixture({used:3300});assert.equal((await reserveCall(f.params)).action,'block');
  assert.equal(f.saved().reservations,undefined);
  assert.equal(f.saved()['voice-call-policy:test-call'].decision,'block');
  assert.equal(f.saved()['voice-call-policy:test-call'].businessId,37);
});
test('expired trial cannot regain answering from a duplicate reservation',async()=>{
  const seed={reservations:{reservations:{'test-call':{allowanceSeconds:300,expiresAt:Date.now()+60000}}}};
  const f=fixture({seed});f.params.signup={...signup,trialEndAt:Date.now()-1000};
  assert.equal((await reserveCall(f.params)).action,'block');
  assert.deepEqual(f.saved().reservations,seed.reservations);
  assert.equal(f.saved()['voice-call-policy:test-call'].decision,'block');
});
test('deadline crossed during writes rolls back the entire reservation',async()=>{
  let now=0;const f=fixture({afterWrite:()=>{now=5000;}});
  f.params.guard=createAssistantRequestGuard({now:()=>now});
  await assert.rejects(reserveCall(f.params),{code:'VOICE_ASSISTANT_REQUEST_DEADLINE'});assert.deepEqual(f.saved(),{});
});
test('already expired request never starts a transaction',async()=>{
  const f=fixture();f.params.guard.expire();await assert.rejects(reserveCall(f.params),{code:'VOICE_ASSISTANT_REQUEST_DEADLINE'});
  assert.equal(f.options(),undefined);
});
test('usage-query failure cannot authorize a call or spend another customer’s allowance',async()=>{
  const f=fixture();f.params.getUsedSeconds=async()=>{throw Error('query failed');};
  await assert.rejects(reserveCall(f.params),/query failed/);assert.deepEqual(f.saved(),{});
});
test('fallback rejects a known forwarding owner, source, and the AI number itself',()=>{
  for(const fallbackPhone of ['+15555550100','+15555550101','+15555550102']){
    assert.equal(buildTrialFallbackDestination({fallbackPhone,aiPhone:'+15555550102',blockedNumbers:['+15555550100','+15555550101']}),null);
  }
  assert.equal(buildTrialFallbackDestination({fallbackPhone:'+15555550103',aiPhone:'+15555550102',blockedNumbers:['+15555550100']}).destination.number,'+15555550103');
});
