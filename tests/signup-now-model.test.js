const {test}=require('node:test'),assert=require('node:assert/strict');
const {signupNowEntries,draftStages}=require('../src/features/admin/signupNowModel');
test('a new unlinked draft is first, ahead of older stalled named signups, without guessing identity',()=>{
 const data={rows:[{attemptId:'signup_a',businessName:'Older Fixture',active:true,stalled:true,signedUpAt:'2026-11-18T18:00:00Z'}],formObservations:{rows:[{id:'fd_one',engaged:true,currentStep:'trade',createdAt:Date.parse('2026-11-18T20:00:00Z')}]}};
 const entries=signupNowEntries(data);assert.equal(entries[0].kind,'draft');assert.match(entries[0].label,/Visitor/);assert.equal(entries[0].draft.linkedAttemptId,undefined);assert.equal(entries.length,2);
 data.formObservations.rows[0].linkedAttemptId='signup_a';assert.equal(signupNowEntries(data).length,1);
});
test('same names/contact-like metadata never merge two visitor capabilities',()=>{
 const rows=['one','two'].map(id=>({id,engaged:true,businessName:'Untrusted name',ownerPhone:'untrusted',createdAt:1}));const entries=signupNowEntries({formObservations:{rows}});assert.equal(entries.length,2);assert.notEqual(entries[0].key,entries[1].key);assert.ok(entries.every(e=>!e.label.includes('Untrusted')));
});

test('explicitly entered draft labels are searchable but never become a canonical identity or merge same-name drafts',()=>{
 const rows=['one','two'].map(id=>({id,engaged:true,createdAt:1,draftNames:{businessName:'Invented Beacon',ownerName:'Alex Fixture'},linkedAttemptId:null}));
 const entries=signupNowEntries({formObservations:{rows}},Date.now(),{search:'Alex Fixture'});
 assert.equal(entries.length,2);assert.ok(entries.every(e=>e.label==='Invented Beacon'&&e.kind==='draft'&&!e.row));assert.notEqual(entries[0].key,entries[1].key);
});

test('business-name sorting includes entered draft names without treating anonymous/owner-only labels as a business',()=>{
 const data={rows:[{attemptId:'saved',businessName:'Zulu',active:true,signedUpAt:'2026-11-18T18:00:00Z'}],formObservations:{rows:[{id:'named',engaged:true,createdAt:1,draftNames:{businessName:'Alpha Draft',ownerName:'Fixture'}},{id:'owner',engaged:true,createdAt:1,draftNames:{businessName:'',ownerName:'A Person'}}]}};
 assert.deepEqual(signupNowEntries(data,Date.now(),{sort:'name'}).map(e=>e.key),['draft:named','signup:saved','draft:owner']);
});
test('six small steps preserve missing evidence and distinguish an invalid current field from untouched blanks',()=>{
 const draft={currentStep:'business_details',fields:[{id:'business_phone',label:'Business phone',observedAt:1,currentStepVisible:true,validation:'invalid',presence:'present',required:true,visibleAtObservation:'visible'},{id:'business_email',observedAt:1,currentStepVisible:true,validation:'not_observed',presence:'blank',required:true,visibleAtObservation:'visible'}]};
 let stages=draftStages(draft);assert.equal(stages.length,6);assert.equal(stages.find(s=>s.id==='business_details').state,'blocked');assert.equal(stages.find(s=>s.id==='pricing').state,'unknown');
 stages=draftStages({...draft,currentStep:'pricing',fields:draft.fields.map(f=>({...f,currentStepVisible:false}))});assert.equal(stages.find(s=>s.id==='business_details').state,'partial');assert.equal(stages.find(s=>s.id==='pricing').state,'unknown');
});

test('one valid field cannot turn a partially observed business step into a green check',()=>{
 const valid=id=>({id,observedAt:1,required:true,visibleAtObservation:'visible',validation:'valid'});
 const stage=fields=>draftStages({currentStep:'business_details',fields}).find(s=>s.id==='business_details');
 assert.equal(stage([valid('business_name')]).state,'partial');
 const ids=['owner_name','business_name','business_phone','business_email','street_address','city','province','postal_code'];
 assert.equal(stage(ids.map(valid)).state,'observed');
 assert.equal(stage(ids.map(id=>id==='city'?{id,observedAt:null}:valid(id))).state,'partial');
});

const now=Date.parse('2026-11-19T18:00:00Z');
const hour=3600000;
const saved=(id,extra={})=>({attemptId:id,businessName:id,ownerName:'Fictional Owner',active:true,mode:'working',signedUpAt:new Date(now-hour).toISOString(),...extra});
const ids=entries=>entries.map(e=>e.key);
test('newest means original start, never a refreshed old visitor or server attention-first ordering',()=>{
 const old=saved('old',{stalled:true,signedUpAt:new Date(now-3*hour).toISOString(),lastProgressAt:new Date(now-1000).toISOString()});
 const recent=saved('new');
 const data={rows:[old,recent],formObservations:{rows:[{id:'draft',engaged:true,createdAt:now-4*hour,lastObservedAt:now-500}]}};
 assert.deepEqual(ids(signupNowEntries(data,now)),['signup:new','signup:old','draft:draft']);
 assert.deepEqual(ids(signupNowEntries(data,now,{sort:'oldest'})),['draft:draft','signup:old','signup:new']);
 assert.deepEqual(ids(signupNowEntries(data,now,{sort:'progress'})),['draft:draft','signup:old','signup:new']);
});
test('every date sort puts unknown, invalid and future timestamps last without guessing them',()=>{
 const rows=[saved('null',{signedUpAt:null}),saved('bad',{signedUpAt:'bad'}),saved('future',{signedUpAt:new Date(now+hour).toISOString()}),saved('valid')];
 for(const sort of ['newest','oldest','progress']){
  const entries=signupNowEntries({rows:rows.map(r=>({...r,lastProgressAt:r.signedUpAt}))},now,{sort});
  assert.equal(entries[0].key,'signup:valid');assert.equal(entries.length,4);
 }
 assert.deepEqual(ids(signupNowEntries({rows},now,{dateRange:'24h'})),['signup:valid']);
});
test('longest stuck prioritizes confirmed stalls with known durations, not untimed or nonstalled records',()=>{
 const rows=[saved('not-stalled',{elapsedMs:1e9}),saved('unknown',{stalled:true,elapsedMs:null}),saved('short',{stalled:true,elapsedMs:600000}),saved('long',{stalled:true,elapsedMs:1200000})];
 assert.deepEqual(ids(signupNowEntries({rows},now,{sort:'stuck'})),['signup:long','signup:short','signup:unknown','signup:not-stalled']);
});
test('name sorting preserves distinct same-name records and places anonymous drafts after known businesses',()=>{
 const rows=[saved('z',{businessName:'Zulu'}),saved('b',{businessName:'Alpha'}),saved('a',{businessName:'Alpha'})];
 const data={rows,formObservations:{rows:[{id:'x',engaged:true,createdAt:now-1,businessName:'Untrusted Alpha'}]}};
 assert.deepEqual(ids(signupNowEntries(data,now,{sort:'name'})),['signup:a','signup:b','signup:z','draft:x']);
 assert.equal(rows[0].attemptId,'z','Input order is never mutated');
 assert.equal(signupNowEntries(data,now,{search:'Untrusted Alpha'}).length,0);
});
test('one search and status selection govern saved records and anonymous progress without invented identity',()=>{
 const data={rows:[saved('working'),saved('ready',{active:false,mode:'ready',lastProgressAt:new Date(now-hour).toISOString()}),saved('paused',{active:false,mode:'paused'})],formObservations:{rows:[{id:'draft-one',engaged:true,createdAt:now-hour,stalled:true,currentStepLabel:'Business details'},{id:'linked',engaged:true,linkedAttemptId:'working'},{id:'passive',engaged:false}]}};
 assert.equal(signupNowEntries(data,now,{filter:'all'}).length,4);
 assert.deepEqual(ids(signupNowEntries(data,now,{filter:'ready'})),['signup:ready']);
 assert.deepEqual(ids(signupNowEntries(data,now,{filter:'paused'})),['signup:paused']);
 assert.deepEqual(ids(signupNowEntries(data,now,{filter:'stalled'})),['draft:draft-one']);
 assert.deepEqual(ids(signupNowEntries(data,now,{search:'  BUSINESS DETAILS  '})),['draft:draft-one']);
 assert.deepEqual(ids(signupNowEntries(data,now,{search:'Fictional Owner'})),['signup:ready','signup:working']);
});
test('Toronto Today uses the local calendar day including DST changes, not UTC or a rolling 24 hours',()=>{
 const clock=Date.parse('2026-11-02T04:30:00Z'); // Nov 1, 11:30 p.m. after fallback.
 const rows=[saved('local-today',{signedUpAt:'2026-11-02T04:00:00Z'}),saved('midnight',{signedUpAt:'2026-11-01T04:00:00Z'}),saved('yesterday',{signedUpAt:'2026-11-01T03:59:59Z'})];
 assert.deepEqual(ids(signupNowEntries({rows},clock,{dateRange:'today'})),['signup:local-today','signup:midnight']);
});
test('date windows are inclusive at the exact boundary and all-time retains unknown history',()=>{
 for(const [dateRange,days] of [['24h',1],['7d',7],['30d',30]]){
  const rows=[saved('edge',{signedUpAt:new Date(now-days*24*hour).toISOString()}),saved('outside',{signedUpAt:new Date(now-days*24*hour-1).toISOString()}),saved('missing',{signedUpAt:null})];
  assert.deepEqual(ids(signupNowEntries({rows},now,{dateRange})),['signup:edge']);
  assert.equal(signupNowEntries({rows},now,{dateRange:'all'}).length,3);
 }
});
test('unknown view options fall back safely and ties remain deterministic across reordered polling responses',()=>{
 const rows=[saved('b'),saved('a')];
 const a=signupNowEntries({rows},now,{filter:'unsupported',sort:'unsupported',dateRange:'unsupported'});
 assert.deepEqual(ids(a),['signup:a','signup:b']);
 assert.deepEqual(ids(signupNowEntries({rows:[...rows].reverse()},now)),ids(a));
});
