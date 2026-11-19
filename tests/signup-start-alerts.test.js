const {test}=require('node:test');
const assert=require('node:assert/strict');
const memory=require('./helpers/form-observation-memory');
const {createObservationService,TTL_MS}=require('../server/signupFormObservation');
const event=(extra={})=>({schemaVersion:1,sequence:1,expectedRevision:0,currentStep:'trade',attemptedAdvance:false,fields:[{id:'trade_choice',presence:'blank',visible:'visible',required:true,interacted:false,validation:'not_observed',reason:'not_observed'}],started:true,...extra});
function fixture(){let at=1900000000000;const store=memory(),create=()=>createObservationService({store,now:()=>at,authenticateAttempt:async()=>({eventKey:'signup_'+'a'.repeat(32),status:'provisioning',expiresAt:new Date(at+100000)})}),service=create();return{store,service,create,advance:ms=>{at+=ms;},now:()=>at};}
test('an explicit start is visible before any field interaction without inventing field validation',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());const r=(await f.service.listAdmin()).rows[0];
 assert.equal(r.engaged,true);assert.equal(r.startedAt,f.now());assert.equal(r.startSource,'trial_button');assert.equal(r.currentStep,'trade');assert.deepEqual(r.blockers,[]);assert.equal(r.fields.find(x=>x.id==='trade_choice').validation,'not_observed');assert.equal(r.identity,'unlinked_visitor_unknown_identity');
 assert.doesNotMatch(JSON.stringify(r),new RegExp(a.token+'|tokenHash'));
});
test('page views, historical engagement and invalid start values do not manufacture starts',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event({started:false}));assert.equal((await f.service.listAdmin()).rows.length,0);
 for(const started of ['yes',{},null,1])await assert.rejects(f.service.observe(a.id,a.token,event({started})),{code:'FORM_OBSERVATION_INVALID'});
 await f.service.observe(a.id,a.token,event({started:false,attemptedAdvance:true}));assert.equal((await f.service.listAdmin()).rows[0].startedAt,null);
 let startCalls=0;await f.service.processStalls({enqueue:async x=>{if(x.dedupeKey.startsWith('signup-form-start:'))startCalls++;return{queued:true};},frontendUrl:'https://fixture.test'});assert.equal(startCalls,0);
});
test('new starts enqueue before the ten-minute stall, once per draft across refresh and restart',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());const calls=[],enqueue=async x=>{calls.push(x);return{queued:true};};
 const first=await f.service.processStalls({enqueue,frontendUrl:'https://fixture.test'});assert.equal(first.startsQueued,1);assert.equal(first.queued,0);assert.equal(calls.length,1);
 assert.equal(calls[0].dedupeKey,'signup-form-start:'+a.id);assert.match(calls[0].text,/not a verified new customer/);assert.doesNotMatch(JSON.stringify(calls),new RegExp(a.token+'|tokenHash|ownerEmail'));
 const before=(await f.service.listAdmin()).rows[0];f.advance(1000);await f.service.observe(a.id,a.token,event({sequence:2,expectedRevision:1}));
 const restarted=f.create();assert.equal((await restarted.processStalls({enqueue,frontendUrl:'https://fixture.test'})).startsQueued,0);assert.equal(calls.length,1);assert.equal((await restarted.listAdmin()).rows[0].startedAt,before.startedAt);
});
test('lost metadata acknowledgement retries only the same durable outbox key and preserves newer browser progress',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());const cas=f.store.compareSwap;let inject=true;
 f.store.compareSwap=async(k,p,n)=>{if(n.startAlertQueuedAt&&inject){inject=false;await f.service.observe(a.id,a.token,event({sequence:2,expectedRevision:1,currentStep:'property_types',fields:[]}));return false;}return cas(k,p,n);};
 const outbox=new Set(),calls=[];const enqueue=async x=>{calls.push(x.dedupeKey);if(outbox.has(x.dedupeKey))return{duplicate:true};outbox.add(x.dedupeKey);return{queued:true};};
 await f.service.processStalls({enqueue,frontendUrl:'https://fixture.test'});assert.equal((await f.service.listAdmin()).rows[0].currentStep,'property_types');assert.equal((await f.service.listAdmin()).rows[0].startAlertQueuedAt,null);
 await f.create().processStalls({enqueue,frontendUrl:'https://fixture.test'});assert.equal(outbox.size,1);assert.deepEqual(calls,[calls[0],calls[0]]);assert.ok((await f.service.listAdmin()).rows[0].startAlertQueuedAt);assert.equal((await f.service.listAdmin()).rows[0].currentStep,'property_types');
});
test('two worker instances share a stable start key; uncertainty does not falsely mark queue acceptance',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());const keys=new Set();let attempts=0;
 const enqueue=async x=>{attempts++;const duplicate=keys.has(x.dedupeKey);keys.add(x.dedupeKey);return duplicate?{duplicate:true}:{queued:true};};
 await Promise.all([f.service.processStalls({enqueue,frontendUrl:'https://fixture.test'}),f.create().processStalls({enqueue,frontendUrl:'https://fixture.test'})]);assert.equal(keys.size,1);assert.ok(attempts<=2);
 const b=await f.service.create();await f.service.observe(b.id,b.token,event());await f.service.processStalls({enqueue:async()=>({queued:false,outcome:'unknown'}),frontendUrl:'https://fixture.test'});assert.equal((await f.service.listAdmin()).rows.find(r=>r.id===b.id).startAlertQueuedAt,null);
});
test('fast submission does not erase its start notification or create a second identity',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());await f.service.link(a.id,a.token,{attemptId:'attempt_'+'a'.repeat(20),attemptToken:'synthetic-status'});
 const calls=[];await f.service.processStalls({enqueue:async x=>{calls.push(x);return{queued:true};},frontendUrl:'https://fixture.test'});assert.equal(calls.length,1);assert.equal((await f.service.listAdmin()).rows[0].linkedAttemptId,'signup_'+'a'.repeat(32));
});
test('fresh recheck refuses replaced/expired slots and bounded batches eventually enqueue distinct starts',async()=>{
 const f=fixture();for(let i=0;i<7;i++){const a=await f.service.create();await f.service.observe(a.id,a.token,event());}
 const calls=[],enqueue=async x=>{calls.push(x.dedupeKey);return{queued:true};};assert.equal((await f.service.processStalls({enqueue,frontendUrl:'https://fixture.test'})).startsQueued,5);assert.equal((await f.service.processStalls({enqueue,frontendUrl:'https://fixture.test'})).startsQueued,2);assert.equal(new Set(calls).size,7);
 const a=await f.service.create();await f.service.observe(a.id,a.token,event());const get=f.store.get;f.store.get=async k=>{const r=await get(k);return r?.id===a.id?{...r,id:'fd_00000000-0000-4000-8000-000000000000'}:r;};assert.equal((await f.service.processStalls({enqueue,frontendUrl:'https://fixture.test'})).startsQueued,0);
 f.store.get=get;f.advance(TTL_MS+1);assert.equal((await f.service.processStalls({enqueue,frontendUrl:'https://fixture.test'})).startsQueued,0);assert.equal(calls.length,7);
});
test('a thrown enqueue leaves start state pending and releases the single-process tick guard',async()=>{
 const f=fixture(),a=await f.service.create();await f.service.observe(a.id,a.token,event());await assert.rejects(f.service.processStalls({enqueue:async()=>{throw Error('synthetic enqueue failure');},frontendUrl:'https://fixture.test'}));
 assert.equal((await f.service.listAdmin()).rows[0].startAlertQueuedAt,null);assert.equal((await f.service.processStalls({enqueue:async()=>({queued:true}),frontendUrl:'https://fixture.test'})).startsQueued,1);
});
