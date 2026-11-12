const test=require('node:test');const assert=require('node:assert/strict');
const {controlRoomModel}=require('../src/signupControlRoomModel');
const {projectSetup}=require('../server/adminSignupSetup');
const row={businessName:'Fixture',currentStep:'Waiting for verification',nextAction:'Review the saved record',steps:[]};
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
