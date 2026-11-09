const test = require('node:test');
const assert = require('node:assert/strict');
const { TTL_MS, MAX_BYTES, PREFIX, validateSnapshot, projectObservation, createObservationService } = require('../server/signupFormObservation');
const copy = value => JSON.parse(JSON.stringify(value));
function memory() {
  const rows = new Map(); return { rows,
    get: async key => copy(rows.get(key) || null),
    createIfExpired: async (key, record, cutoff) => { const old = rows.get(key); if (old && old.createdAt > cutoff) return false; rows.set(key, copy(record)); return true; },
    compareSwap: async (key, previous, next) => { if (JSON.stringify(rows.get(key)) !== JSON.stringify(previous)) return false; rows.set(key, copy(next)); return true; },
    list: async (cutoff, limit) => [...rows.values()].filter(r => r.createdAt > cutoff).sort((a,b) => (b.lastObservedAt || b.createdAt) - (a.lastObservedAt || a.createdAt)).slice(0, limit).map(copy),
    listByAttempt: async (attemptId, cutoff) => [...rows.values()].filter(r => r.createdAt > cutoff && r.linkedAttemptId === attemptId).sort((a,b) => (b.lastObservedAt || 0) - (a.lastObservedAt || 0)).slice(0, 2).map(copy),
    purgeExpired: async cutoff => { for (const [key, row] of rows) if (key.startsWith(PREFIX) && row.createdAt <= cutoff) rows.delete(key); },
  };
}
const field = extra => ({ id: 'business_name', presence: 'blank', visible: 'visible', required: true, interacted: true, validation: 'invalid', reason: 'required_missing', ...extra });
const event = extra => ({ schemaVersion: 1, sequence: 1, expectedRevision: 0, currentStep: 'business_details', attemptedAdvance: false, fields: [field()], ...extra });
function fixture(options = {}) { let at = 1800000000000; const store = memory(); const service = createObservationService({ store, authenticateAttempt: async (id, token) => token === 'synthetic-attempt-capability' ? { eventKey: id.endsWith('b') ? 'signup_'+'b'.repeat(32) : 'signup_'+'a'.repeat(32), status: 'provisioning', expiresAt: new Date(at+100000) } : null, now: () => at, ...options }); return { store, service, advance: ms => { at += ms; }, now: () => at }; }
test('anonymous capability creation stores only a hash, and wrong/lost tokens cannot read metadata', async () => {
  const { store, service } = fixture(), access = await service.create();
  assert.equal(access.token.length, 43); assert.ok([...store.rows.values()][0].tokenHash); assert.doesNotMatch(JSON.stringify([...store.rows.values()]), new RegExp(access.token));
  assert.deepEqual(await service.read(access.id, access.token), { revision: 0, sequence: 0, expiresAt: access.expiresAt });
  for (const [id, token] of [[access.id, 'x'.repeat(43)], ['fd_00000000-0000-4000-8000-000000000000', access.token], [access.id, '']]) await assert.rejects(service.read(id, token), { code: 'FORM_OBSERVATION_UNAUTHORIZED' });
});
test('page load/untouched snapshots do not create an engaged report or a fake validation failure', async () => {
  const f = fixture(), access = await f.service.create();
  const result = await f.service.observe(access.id, access.token, event({ fields: [field({ interacted: false, validation: 'not_observed', reason: 'not_observed' })] }));
  assert.equal(result.ignored, 'not_engaged'); assert.equal((await f.service.listAdmin()).rows.length, 0);
});
test('visible blank, untouched and not-visited fields stay distinct, and no psychological reason is invented', async () => {
  const f = fixture(), a = await f.service.create();
  await f.service.observe(a.id,a.token,event({ fields: [field(), field({ id:'street_address',interacted:false,validation:'not_observed',reason:'not_observed' })] }));
  const row=(await f.service.listAdmin()).rows[0];
  assert.equal(row.identity,'unlinked_visitor_unknown_identity'); assert.deepEqual(row.blockerLabels,['Business name: Required field is blank']);
  assert.equal(row.fields.find(v=>v.id==='street_address').presence,'blank'); assert.equal(row.fields.find(v=>v.id==='street_address').reason,'not_observed');
  assert.equal(row.fields.find(v=>v.id==='postal_code').presence,'unknown'); assert.equal(row.fields.find(v=>v.id==='postal_code').observedAt,null);
  assert.doesNotMatch(JSON.stringify(row),/confused|gave up|did not want|abandoned/i);
});
test('unknown properties, values, contact content, OTP, captcha and arbitrary reasons are rejected without storing them', async () => {
  const f=fixture(),a=await f.service.create(), before=JSON.stringify([...f.store.rows.values()]);
  const marker='PRIVATE_CUSTOMER_CONTENT_885511';
  for(const payload of [event({value:marker}),event({fields:[{...field(),value:marker}]}),event({fields:[field({id:'otp'})]}),event({fields:[field({reason:marker})]}),event({fields:[field({id:'captcha_token'})]}),event({fields:[field({required:false})]}),event({fields:[field({presence:'unknown'})]})]) await assert.rejects(f.service.observe(a.id,a.token,payload),{code:'FORM_OBSERVATION_INVALID'});
  assert.equal(JSON.stringify([...f.store.rows.values()]),before); assert.doesNotMatch(JSON.stringify(await f.service.listAdmin()),new RegExp(marker));
  assert.throws(()=>validateSnapshot(event({fields:Array(100).fill(field())}))); assert.ok(MAX_BYTES<=8192);
});
test('hidden and optional/not-instrumented controls cannot become required blockers', async()=>{
  const f=fixture(),a=await f.service.create();
  await f.service.observe(a.id,a.token,event({attemptedAdvance:true,fields:[field({id:'street_address',presence:'unknown',visible:'hidden',interacted:false,validation:'not_observed',reason:'not_observed'})]}));
  assert.equal((await f.service.listAdmin()).rows[0].blockers.length,0);
  await assert.rejects(f.service.observe(a.id,a.token,event({sequence:2,expectedRevision:1,fields:[field({id:'website_optional'})]})),{code:'FORM_OBSERVATION_INVALID'});
});
test('corrections and back navigation advance monotonic revisions without rewriting earlier snapshot age', async()=>{
  const f=fixture(),a=await f.service.create(); await f.service.observe(a.id,a.token,event()); const original=f.now();f.advance(1000);
  await f.service.observe(a.id,a.token,event({sequence:2,expectedRevision:1,fields:[field({presence:'present',validation:'valid',reason:'none'})]}));
  let row=(await f.service.listAdmin()).rows[0];assert.equal(row.blockers.length,0);assert.equal(row.revision,2);assert.equal(row.lastProgressAt,f.now());
  f.advance(1000);await f.service.observe(a.id,a.token,event({sequence:3,expectedRevision:2,currentStep:'service_areas',fields:[]}));
  row=(await f.service.listAdmin()).rows[0];assert.equal(row.currentStepLabel,'Service areas');assert.equal(row.fields.find(v=>v.id==='business_name').currentStepVisible,false);assert.equal(row.fields.find(v=>v.id==='business_name').observedAt,original+1000);
});
test('out-of-order events and concurrent stale writers cannot overwrite a correction', async()=>{
  const f=fixture(),a=await f.service.create(); await f.service.observe(a.id,a.token,event({sequence:2}));
  assert.equal((await f.service.observe(a.id,a.token,event())).ignored,'stale_sequence');
  await assert.rejects(f.service.observe(a.id,a.token,event({sequence:3,expectedRevision:0})),{code:'FORM_OBSERVATION_STALE'});
  const outputs=await Promise.allSettled([f.service.observe(a.id,a.token,event({sequence:3,expectedRevision:1})),f.service.observe(a.id,a.token,event({sequence:4,expectedRevision:1,fields:[field({presence:'present',validation:'valid',reason:'none'})]}))]);
  assert.equal(outputs.filter(v=>v.status==='fulfilled').length,1);assert.equal((await f.service.read(a.id,a.token)).revision,2);
});
test('expiry is fixed rather than sliding and cleanup touches only expired telemetry namespace', async()=>{
  const f=fixture(),a=await f.service.create();f.store.rows.set('unrelated-signup-evidence',{createdAt:0,secretHistory:'preserve'});
  f.advance(TTL_MS-1);await f.service.observe(a.id,a.token,event());assert.equal((await f.service.read(a.id,a.token)).expiresAt,a.expiresAt);
  f.advance(1);await assert.rejects(f.service.read(a.id,a.token),{code:'FORM_OBSERVATION_UNAUTHORIZED'});assert.equal((await f.service.listAdmin()).rows.length,0);
  await f.service.create();assert.ok(f.store.rows.has('unrelated-signup-evidence'));assert.ok(![...f.store.rows.values()].some(r=>r.id===a.id));
});
test('hard slot cap never evicts active drafts; capacity loss is explicit and expired slots can be reused', async()=>{
  const f=fixture({slots:1}),a=await f.service.create();await assert.rejects(f.service.create(),{code:'FORM_OBSERVATION_CAPACITY'});assert.equal((await f.service.read(a.id,a.token)).revision,0);
  f.advance(TTL_MS);const b=await f.service.create();assert.notEqual(b.id,a.id);assert.equal(f.store.rows.size,1);await assert.rejects(f.service.read(a.id,a.token),{code:'FORM_OBSERVATION_UNAUTHORIZED'});
});
test('exact linking needs both capabilities; another attempt can never be borrowed or rebound', async()=>{
  const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());
  const input={attemptId:'attempt_'+'a'.repeat(20),attemptToken:'synthetic-attempt-capability'};
  await assert.rejects(f.service.link(a.id,'x'.repeat(43),input),{code:'FORM_OBSERVATION_UNAUTHORIZED'});
  await assert.rejects(f.service.link(a.id,a.token,{...input,attemptToken:'wrong'}),{code:'FORM_OBSERVATION_UNAUTHORIZED'});
  await f.service.link(a.id,a.token,input);assert.equal((await f.service.listAdmin()).rows[0].identity,'exact_attempt_link');
  await assert.rejects(f.service.link(a.id,a.token,{...input,attemptId:'attempt_'+'b'.repeat(20)}),{code:'FORM_OBSERVATION_LINK_CONFLICT'});
});
test('stall tick sends only fixed metadata once per progress episode and survives a service restart', async()=>{
  const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());f.advance(600001);
  const entries=[],enqueue=async item=>{entries.push(item);return {queued:true};};
  assert.equal((await f.service.processStalls({enqueue,frontendUrl:'https://example.invalid'})).queued,1);
  assert.match(entries[0].text,/Business name: visible blank; Required field is blank/);assert.match(entries[0].text,/Identity: unknown/);
  assert.match(entries[0].text,/not proof that signup failed or was never submitted/);
  assert.ok(!JSON.stringify(entries).includes(a.token));assert.ok(!JSON.stringify(entries).includes('tokenHash'));
  const restarted=createObservationService({store:f.store,authenticateAttempt:async()=>null,now:f.now});
  assert.equal((await restarted.processStalls({enqueue,frontendUrl:'https://example.invalid'})).queued,0);
  await f.service.observe(a.id,a.token,event({sequence:2,expectedRevision:1,fields:[field({presence:'present',validation:'valid',reason:'none'})]}));f.advance(600001);
  assert.equal((await f.service.processStalls({enqueue,frontendUrl:'https://example.invalid'})).queued,1);assert.notEqual(entries[0].dedupeKey,entries[1].dedupeKey);
});
test('linked and untouched drafts do not alert; exact lookup uses bounded async filtered store API', async()=>{
  const f=fixture(),a=await f.service.create(),b=await f.service.create();await f.service.observe(a.id,a.token,event());
  await f.service.link(a.id,a.token,{attemptId:'attempt_'+'a'.repeat(20),attemptToken:'synthetic-attempt-capability'});f.advance(600001);
  assert.equal((await f.service.processStalls({enqueue:async()=>{throw Error('must not send');},frontendUrl:'https://example.invalid'})).queued,0);
  f.store.list=async()=>{throw Error('whole namespace lookup forbidden');};
  assert.equal((await f.service.describeAttempt('signup_'+'a'.repeat(32))).linkedAttemptId,'signup_'+'a'.repeat(32));
  assert.equal(await f.service.describeAttempt('untrusted raw contact'),null);assert.equal((await f.service.read(b.id,b.token)).revision,0);
});
test('a stale stall snapshot cannot alert after progress, linking, expiry or slot replacement', async()=>{
  for (const change of ['progress', 'link', 'expiry', 'replacement']) {
    const f=fixture({slots:1}),a=await f.service.create();
    await f.service.observe(a.id,a.token,event());f.advance(600001);
    const list=f.store.list;
    f.store.list=async(...args)=>{
      const snapshot=await list(...args);
      if(change==='progress')await f.service.observe(a.id,a.token,event({sequence:2,expectedRevision:1,fields:[field({presence:'present',validation:'valid',reason:'none'})]}));
      else if(change==='link')await f.service.link(a.id,a.token,{attemptId:'attempt_'+'a'.repeat(20),attemptToken:'synthetic-attempt-capability'});
      else {f.advance(TTL_MS);if(change==='replacement')await f.service.create();}
      return snapshot;
    };
    let calls=0;
    assert.equal((await f.service.processStalls({enqueue:async()=>{calls++;return{queued:true};},frontendUrl:'https://example.invalid'})).queued,0,change);
    assert.equal(calls,0,change);
  }
});
test('overlapping stall ticks do not enqueue twice and release the guard after errors', async()=>{
  const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());f.advance(600001);
  let resolveEntered,release;const entered=new Promise(r=>{resolveEntered=r;}),wait=new Promise(r=>{release=r;});let calls=0;
  const first=f.service.processStalls({enqueue:async()=>{calls++;resolveEntered();await wait;return {queued:true};},frontendUrl:'https://example.invalid'});await entered;
  assert.equal((await f.service.processStalls({enqueue:async()=>{calls++;},frontendUrl:''})).skipped,'already_running');release();await first;assert.equal(calls,1);
  await f.service.observe(a.id,a.token,event({sequence:2,expectedRevision:1,currentStep:'service_areas',fields:[]}));f.advance(600001);
  await assert.rejects(f.service.processStalls({enqueue:async()=>{throw Error('transport unavailable');},frontendUrl:''}));
  assert.equal((await f.service.processStalls({enqueue:async()=>({queued:true}),frontendUrl:''})).queued,1);
});
test('Prisma adapter enforces namespace/cap/TTL and filtered exact-attempt query without synchronous scans', async()=>{
  const calls=[],runtimeStore={findMany:async q=>{calls.push(['findMany',q]);return[];},deleteMany:async q=>{calls.push(['deleteMany',q]);return{count:0};},updateMany:async q=>{calls.push(['updateMany',q]);return{count:1};}};
  const {createPrismaObservationStore}=require('../server/signupFormObservation'),store=createPrismaObservationStore({runtimeStore});
  await store.listByAttempt('signup_'+'a'.repeat(32),1800000000000);await store.purgeExpired(1800000000000);
  assert.deepEqual(calls[0][1].where.data,{path:['linkedAttemptId'],equals:'signup_'+'a'.repeat(32)});assert.equal(calls[0][1].take,2);assert.equal(calls[1][1].where.key.startsWith,PREFIX);
});
test('remaining-step field IDs enforce conditional requiredness and never accept OTP, terms or payment payloads',async()=>{
 const f=fixture(),a=await f.service.create();
 await f.service.observe(a.id,a.token,event({currentStep:'pricing',attemptedAdvance:true,fields:[field({id:'pricing_choices',required:false,presence:'blank',validation:'valid',reason:'none'}),field({id:'visit_fee',required:false,presence:'unknown',visible:'hidden',interacted:false,validation:'not_observed',reason:'not_observed'})]}));
 const row=(await f.service.listAdmin()).rows[0];assert.equal(row.blockers.length,0);const {formObservationLines}=require('../server/signupFormObservation');assert.equal(formObservationLines(row).length,1,'Optional blanks are not Telegram blocker lines');
 for(const input of [event({currentStep:'pricing',fields:[field({id:'visit_fee',required:false})]}),event({currentStep:'final_review',fields:[field({id:'verification_code'})]}),event({currentStep:'final_review',fields:[field({id:'terms_accepted'})]}),event({currentStep:'final_review',fields:[field({id:'card_number'})]})])await assert.rejects(f.service.observe(a.id,a.token,{...input,sequence:2,expectedRevision:1}),{code:'FORM_OBSERVATION_INVALID'});
});
test('a newer business correction overrides an older final-review snapshot, even within the same millisecond',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());
 await f.service.observe(a.id,a.token,event({currentStep:'final_review',sequence:2,expectedRevision:1,fields:[field({presence:'present',validation:'valid',reason:'none'})]}));
 await f.service.observe(a.id,a.token,event({sequence:3,expectedRevision:2}));
 let row=(await f.service.listAdmin()).rows[0];assert.equal(row.fields.find(x=>x.id==='business_name').presence,'blank');assert.equal(row.blockers[0].id,'business_name');
 f.advance(1000);await f.service.observe(a.id,a.token,event({currentStep:'service_areas',sequence:4,expectedRevision:3,fields:[]}));
 row=(await f.service.listAdmin()).rows[0];assert.equal(row.fields.find(x=>x.id==='business_name').presence,'blank');assert.equal(row.blockers.length,0);
});
