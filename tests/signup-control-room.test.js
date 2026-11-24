const test=require('node:test');const assert=require('node:assert/strict');
const {controlRoomModel}=require('../src/signupControlRoomModel');
const {projectSetup}=require('../server/adminSignupSetup');
const row={businessName:'Fixture',currentStep:'Waiting for verification',nextAction:'Review the saved record',steps:[]};
test('station summary requires every nonoptional check to be backend verified',()=>{
 const {stationState}=require('../src/signupControlRoomModel');
 assert.equal(stationState([]),'pending');assert.equal(stationState([{state:'optional'}]),'pending');
 for(const state of ['pending','unknown','present','observed','recorded'])assert.equal(stationState([{state:'verified'},{state}]),'pending');
 assert.equal(stationState([{state:'verified'},{state:'optional'}]),'verified');
 assert.equal(stationState([{state:'verified'},{state:'blocked'}]),'blocked');
});
test('blocker summary and inspector preserve actual evidence without inventing provider completion',()=>{
 const setup=projectSetup({});setup.groups[1].checks[0]={id:'assistant',label:'Assistant creation',state:'blocked',detail:'Saved timeout; completion unknown.'};
 const view=controlRoomModel(row,setup,'assistant');
 assert.equal(view.headline,'Assistant creation needs attention');assert.equal(view.explanation,'Saved timeout; completion unknown.');
 assert.equal(view.stations[1].state,'blocked');assert.match(view.inspector.next,/receipts before any retry/);
 assert.equal(view.inspector.found[0].detail,'Saved timeout; completion unknown.');
 assert.match(view.inspector.expected,/matching script/);assert.equal(view.verified,0);
});
test('click selection resolves every journey and backend group to its own evidence',()=>{
 const setup=projectSetup({});
 for(const id of ['start','trade','property','area','business','pricing','review','captcha','trial','number','assistant','texts','activation']) {
  assert.equal(controlRoomModel(row,setup,id).selected.id,id);
 }
 assert.equal(controlRoomModel(row,setup,'nonexistent').selected.id,'number');
});
test('readiness is evidence-counted and never a launch decision',()=>{
 const setup=projectSetup({});let view=controlRoomModel(row,setup);assert.equal(view.total,18);assert.equal(view.verified,0);
 setup.groups[0].checks[0].state='verified';view=controlRoomModel(row,setup);assert.equal(view.verified,1);
});
test('search summary ages out without a successful refresh and future observations cannot appear live',()=>{
 const setup=projectSetup({});setup.number.search={phase:'searching',areaCode:'905',at:'2026-11-10T22:00:00Z',stale:false};
 assert.match(controlRoomModel(row,setup,'number',Date.parse('2026-11-10T22:00:20Z')).headline,/Searching 905/);
 assert.equal(controlRoomModel(row,setup,'number',Date.parse('2026-11-10T22:00:31Z')).freshSearch,false);
 assert.equal(controlRoomModel(row,setup,'number',Date.parse('2026-11-10T21:59:59Z')).freshSearch,false);
 setup.number.search.stale=true;assert.equal(controlRoomModel(row,setup,'number',Date.parse('2026-11-10T22:00:20Z')).freshSearch,false);
});
test('empty/failed historical search is not presented as a running search',()=>{
 const setup=projectSetup({});setup.number.search={phase:'empty',areaCode:'289',at:new Date().toISOString()};
 assert.equal(controlRoomModel(row,setup).headline,row.currentStep);
 setup.number.stage.status='failed';assert.match(controlRoomModel(row,setup).headline,/needs review/);
});
test('timeline is chronological, deduplicated, source-labelled and excludes unknown dates',()=>{
 const setup=projectSetup({signedUpAt:'2026-11-10T20:00:00Z'});
 setup.timeline.push({id:'later',label:'Example',at:'2026-11-10T21:00:00Z',source:'Durable receipt'});
 setup.timeline.push({id:'bad',label:'Unknown',at:null});setup.timeline.push(setup.timeline[0]);
 const view=controlRoomModel({...row,formObservation:{lastObservedAt:'2026-11-10T20:30:00Z',currentStepLabel:'Business details'}},setup);
 assert.deepEqual(view.timeline.map(e=>e.id),['signup','browser-snapshot','later']);
 assert.match(view.timeline[1].source,/not backend completion/);
});
test('backend timeline never invents delivery from acceptance or completion from generic updatedAt',()=>{
 const setup=projectSetup({signedUpAt:'bad',updatedAt:'2026-11-10T21:00:00Z',agentTestOwnerAcceptedAt:'2026-11-10T21:00:00Z'},
  {receipts:{'twilio-number':{status:'processing',updatedAt:'2026-11-10T21:00:00Z'}}});
 assert.equal(setup.timeline.length,0);
});
test('only explicit durable event timestamps enter timeline; search history is qualified',()=>{
 const setup=projectSetup({},{receipts:{'twilio-number':{status:'failed',claimedAt:'2026-11-10T20:00:00Z',failedAt:'2026-11-10T20:00:04Z'}},
  search:{history:[{phase:'searching',areaCode:'289',at:'2026-11-10T20:00:02Z'},{phase:'evil-secret',areaCode:'secret',at:'2026-11-10T20:00:03Z'}]}});
 assert.deepEqual(setup.timeline.map(e=>e.label),['Number purchase started','Searching · 289','Number purchase failed']);
 assert.match(setup.timeline[1].source,/incomplete history/);assert.doesNotMatch(JSON.stringify(setup.timeline),/evil-secret/);
});
test('pinned summary uses existing saved failure evidence and separately qualified next action',()=>{
 const {progressSummary}=require('../src/signupControlRoomModel');
 const setup=projectSetup({});setup.number.stage.status='failed';
 setup.purchaseEvidence={explanation:'Synthetic saved purchase failure; provider outcome is unknown.',nextAction:'Inspect the exact saved receipts. Do not replay.'};
 const summary=progressSummary({...row,currentStep:'Assigning number',active:true},setup);
 assert.equal(summary.currentStep,'Assigning number');
 assert.equal(summary.reason,setup.purchaseEvidence.explanation);assert.equal(summary.nextAction,setup.purchaseEvidence.nextAction);
 assert.doesNotMatch(JSON.stringify(summary),/delivered|purchased successfully|live check passed/i);
});
test('customer waiting and missing evidence do not become technical failure diagnoses',()=>{
 const {progressSummary}=require('../src/signupControlRoomModel');
 const waiting=progressSummary({...row,mode:'waiting_customer',nextAction:'Wait for the customer to verify.'},null);
 assert.equal(waiting.waitingCustomer,true);assert.match(waiting.reason,/not proof of a technical failure/);
 assert.equal(waiting.nextAction,'Wait for the customer to verify.');
 const missing=progressSummary({...row,mode:'working'},null);
 assert.match(missing.reason,/No exact technical failure cause/);assert.equal(missing.checkedAt,null);
});
test('a saved blocked check supplies its existing detail rather than an invented cause',()=>{
 const {progressSummary}=require('../src/signupControlRoomModel');
 const setup=projectSetup({});setup.groups[1].checks[0]={id:'assistant',state:'blocked',detail:'Saved assistant access refusal; ownership not verified.',label:'Assistant'};
 assert.equal(progressSummary({...row,mode:'working'},setup).reason,setup.groups[1].checks[0].detail);
});
test('workflow-position lights preserve the difference between verified completion and current incomplete work',()=>{
 const {currentStationId}=require('../src/signupControlRoomModel');
 const groups=[{id:'number',checks:[{state:'verified'}]},{id:'assistant',checks:[{state:'pending'}]}];
 assert.equal(currentStationId({active:true,steps:[{key:'content',status:'current'}]},groups),'assistant');
 assert.equal(currentStationId({active:true,mode:'working'},groups),'assistant');
 for(const mode of ['waiting_customer','paused','closed','ready'])assert.equal(currentStationId({active:true,mode},groups),null);
 assert.equal(currentStationId({},groups),null);
 assert.equal(currentStationId({active:true},groups.map(g=>({...g,checks:[{state:'verified'}]}))),null);
});
test('missing and malformed group checks stay unknown and cannot collapse partial evidence into success',()=>{
 const {progressSummary}=require('../src/signupControlRoomModel');
 for(const checks of [undefined,null,{},[null],[{id:'one',label:'Known check',state:'verified'},null]]){
  const setup={groups:[{id:'number',title:'Number',checks}]};
  const view=controlRoomModel({...row,active:true},setup);
  assert.equal(view.stations[0].state,'pending');assert.ok(view.verified<Math.max(1,view.total));
  assert.match(progressSummary({...row,active:true},setup).reason,/No exact technical failure cause/);
 }
});
