const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveCall,reservationBudget,reservationFailure}=require('../server/trialCallReservation');
const {createAssistantRequestGuard}=require('../server/voiceCallReliability');
const {decideTrialCall,getTrialLifecycle,buildTrialFallbackDestination}=require('../server/trialUsagePolicy');
const signup={subscriptionStatus:'trialing',trialStartAt:Date.now()-10000,trialEndAt:Date.now()+86400000};
const limits={maxCallSeconds:300,warningSeconds:1200,limitSeconds:3600,completionReserveSeconds:300,minCallSeconds:30,reservationGraceSeconds:60};

function fixture({used=0,acquired=true,seed={},afterWrite=()=>{},failRead=false}={}) {
  let saved=structuredClone(seed);const queries=[];let options;
  const db={$transaction:async(fn,opts)=>{
    options=opts;const working=structuredClone(saved);
    const tx={$queryRaw:async (strings,...values)=>{const sql=strings.join('?');queries.push(sql);
      if(sql.includes('pg_advisory_xact_lock')&&!acquired)throw Object.assign(Error('synthetic contention'),{code:'P2010',meta:{code:'55P03'}});
      if(sql.includes('AS "usedSeconds"')){if(failRead)throw Error('query failed');return[{data:working[values[0]]||null,usedSeconds:String(used)}];}return[];},
      $executeRaw:async(strings,...values)=>{const sql=strings.join('?');queries.push(sql);
        for(let i=0;i<values.length;i+=2){if(!sql.includes('DO NOTHING')||!working[values[i]])working[values[i]]=JSON.parse(values[i+1]);}
        afterWrite();return values.length/2;}};
    const result=await fn(tx);saved=working;return result;
  }};
  const params={db,signup,config:{businessId:37,assistantMaxSeconds:300},callId:'test-call',key:'reservations',callIndexKey:'call-index',
    getLifecycle:getTrialLifecycle,decide:decideTrialCall,limits,guard:createAssistantRequestGuard()};
  return{params,saved:()=>saved,queries,options:()=>options};
}
test('successful allowance is durably reserved exactly once with bounded transaction settings',async()=>{
  const f=fixture();assert.equal((await reserveCall(f.params)).action,'allow-saved');
  assert.equal(f.saved().reservations.reservations['test-call'].allowanceSeconds,300);
  assert.equal(f.saved()['call-index'].businessId,37);
  assert.equal(f.options().timeout,3200);assert.ok(f.options().maxWait<=300);
  assert.ok(f.queries[0].includes("set_config('lock_timeout'"));
  assert.ok(f.queries[1].includes('pg_advisory_xact_lock'));
  assert.equal(f.queries.length,4,'limits, bounded lock, combined read, atomic two-row write');
  assert.equal((await reserveCall(f.params)).duplicateReservation,true);
  assert.equal(Object.keys(f.saved().reservations.reservations).length,1);
});
test('a lock wait is bounded and contention never changes allowance or invokes a provider',async()=>{
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
  const f=fixture({failRead:true});
  await assert.rejects(reserveCall(f.params),{code:'VOICE_TRIAL_RESERVATION_FAILED'});assert.deepEqual(f.saved(),{});
});

test('transaction budget shrinks after prior work and leaves response headroom',()=>{
  for(const ms of [4500,3000,1400,800,650]){const b=reservationBudget(ms);assert.ok(b.timeout+b.maxWait+250<=ms);assert.ok(b.timeout<=3200);}
  for(const ms of [649,200,0,NaN,Infinity])assert.throws(()=>reservationBudget(ms),{code:'VOICE_ASSISTANT_REQUEST_DEADLINE'});
});

test('safe diagnostics retain the failing stage and code but not raw SQL or credentials',()=>{
  const error=reservationFailure(Object.assign(Error('secret SQL password=never-log'),{code:'P2028',meta:{error:'private database details'}}),'write');
  assert.deepEqual(error.reservationDiagnostic,{stage:'write',category:'transaction_api_error',databaseCode:'P2028',sqlState:'unknown'});
  assert.doesNotMatch(JSON.stringify(error)+error.message,/secret SQL|never-log|private database/);
});

test('malformed or unsafe usage cannot be interpreted as a free allowance',async()=>{
  for(const used of [NaN,-1,'unproven',Number.MAX_SAFE_INTEGER+1]){
    const f=fixture({used});await assert.rejects(reserveCall(f.params),{code:'VOICE_TRIAL_USAGE_UNPROVEN'});assert.deepEqual(f.saved(),{});
  }
});

test('a deadline crossed during commit never authorizes the committed lease',async()=>{
  const f=fixture();let now=0;f.params.guard=createAssistantRequestGuard({now:()=>now});const tx=f.params.db.$transaction;
  f.params.db.$transaction=async(...args)=>{const result=await tx(...args);now=5000;return result;};
  await assert.rejects(reserveCall(f.params),{code:'VOICE_ASSISTANT_REQUEST_DEADLINE'});
  assert.ok(f.saved().reservations.reservations['test-call'],'caller must reconcile this exact late lease');
});
test('fallback rejects a known forwarding owner, source, and the AI number itself',()=>{
  for(const fallbackPhone of ['+15555550100','+15555550101','+15555550102']){
    assert.equal(buildTrialFallbackDestination({fallbackPhone,aiPhone:'+15555550102',blockedNumbers:['+15555550100','+15555550101']}),null);
  }
  assert.equal(buildTrialFallbackDestination({fallbackPhone:'+15555550103',aiPhone:'+15555550102',blockedNumbers:['+15555550100']}).destination.number,'+15555550103');
});
