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
