const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJourney, describeField } = require('../src/signupJourneyModel');
const observed = (id, extra = {}) => ({ id, observedAt: '2026-11-10T20:00:00Z', presence: 'present', visibleAtObservation: 'visible', validation: 'valid', required: true, ...extra });
test('sketch order preserves all nine steps and eight business fields without terms', () => {
 const nodes = buildJourney({ steps: [] });
 assert.deepEqual(nodes.map(n=>n.id), ['start','trade','property','area','business','pricing','review','captcha','trial']);
 assert.equal(nodes.find(n=>n.id==='business').fields.length,8);
 assert.equal(nodes.find(n=>n.id==='business').fields[0].label,'Name');
 assert.ok(!JSON.stringify(nodes).includes('Terms'));
});
test('old signups without browser coverage never invent field checks or trial activation',()=>{
 const nodes=buildJourney({signedUpAt:'2026-11-01',status:'setup_ready',info:{businessAddress:'Saved address'},steps:[]});
 assert.equal(nodes[0].state,'recorded');
 assert.equal(nodes.find(n=>n.id==='business').state,'unknown');
 assert.equal(nodes.find(n=>n.id==='trial').state,'pending');
});
test('visible blanks, invalid, optional and hidden fields remain distinct',()=>{
 assert.equal(describeField(observed('city',{presence:'blank',validation:'not_observed',interacted:false})).state,'blocked');
 assert.match(describeField(observed('city',{presence:'blank',validation:'not_observed',interacted:false})).label,/reason unknown/);
 assert.equal(describeField(observed('visit_fee',{presence:'blank',required:false,validation:'not_observed'})).state,'optional');
 assert.equal(describeField(observed('visit_fee',{visibleAtObservation:'hidden'})).state,'optional');
 assert.equal(describeField(observed('visit_fee',{visibleAtObservation:'hidden',presence:'unknown'})).state,'optional');
 assert.equal(describeField(observed('city',{validation:'invalid'})).state,'blocked');
 assert.equal(describeField(observed('city',{validation:'not_observed'})).state,'present');
 assert.equal(describeField(observed('city',{observedAt:null})).state,'unknown');
});
test('browser completion cannot verify backend trial or submission',()=>{
 const nodes=buildJourney({formObservation:{currentStep:'final_review',fields:[observed('human_verification'),observed('trade_choice')]},steps:[{key:'trial',status:'current'}]});
 assert.equal(nodes.find(n=>n.id==='captcha').state,'observed');
 assert.equal(nodes.find(n=>n.id==='review').state,'observed');
 assert.equal(nodes.find(n=>n.id==='trial').state,'pending');
 assert.equal(nodes.find(n=>n.id==='trade').state,'observed');
 assert.equal(buildJourney({steps:[{key:'trial',status:'done'}]}).at(-1).state,'verified');
});
test('pricing alternatives are explicitly not claimed as individually tracked',()=>{
 const pricing=buildJourney({}).find(n=>n.id==='pricing');
 assert.match(pricing.note,/individual selections are not recorded/);
 assert.equal(pricing.fields.length,6);
 assert.equal(pricing.fields.find(f=>f.id==='parts').state,'unknown');
});
