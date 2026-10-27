const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { assess, run } = require('../scripts/verify-controlled-voice-call');
const fixture = () => ({ health: { ok: true, releaseCommit: 'new-head' }, expectedRelease: 'new-head',
  after: '2026-10-26T16:00:00Z', phoneId: 'phone-id', signup: { businessId:37,vapiPhoneNumberId:'phone-id',vapiAssistantId:'assistant-id' },
  call: { id:'call-id',type:'inboundPhoneCall',phoneNumberId:'phone-id',assistantId:'assistant-id',createdAt:'2026-10-26T16:01:00Z',startedAt:'2026-10-26T16:01:01Z',endedAt:'2026-10-26T16:01:05Z',endedReason:'customer-ended-call' },
  savedCalls:[{externalProvider:'vapi',externalId:'call-id',businessId:37,status:'COMPLETED',endedReason:'customer-ended-call',durationSec:4}] });

test('read-only evidence can prove one post-deployment inbound call and its canonical record',()=>{
  const result=assess(fixture());assert.equal(result.verified,true);assert.equal(result.callsSubmitted,0);
});
test('a successful old call or outbound assistant shortcut cannot prove the repaired inbound route',()=>{
  for(const change of [{createdAt:'2026-10-26T15:00:00Z'},{type:'outboundPhoneCall'}]){
    const input=fixture();Object.assign(input.call,change);assert.equal(assess(input).verified,false);
  }
  const input=fixture();input.health.releaseCommit='old-head';assert.equal(assess(input).verified,false);
});
test('carrier completion, fallback speech and generic COMPLETED rows cannot prove AI answering',()=>{
  const input=fixture();input.call.endedReason='assistant-request-returned-error';delete input.call.assistantId;delete input.call.startedAt;
  assert.equal(assess(input).verified,false);
  input.call.endedReason='call.ending.hook-executed-say';assert.equal(assess(input).verified,false);
});
test('duplicate records and wrong business or assistant bindings fail verification',()=>{
  const a=fixture();a.savedCalls.push({...a.savedCalls[0]});assert.equal(assess(a).verified,false);
  const b=fixture();b.savedCalls[0].businessId=99;assert.equal(assess(b).verified,false);
  const c=fixture();c.call.assistantId='other';assert.equal(assess(c).verified,false);
});
test('helper rejects any apply flag before network access and has no call-creation operation',async()=>{
  await assert.rejects(run({argv:['--apply'],env:{},fetchImpl:()=>{throw Error('network forbidden');}}),/read-only/);
  const source=fs.readFileSync(require.resolve('../scripts/verify-controlled-voice-call'),'utf8');
  assert.doesNotMatch(source,/api\.twilio\.com|Calls\.json|Twiml|method:\s*['"]PATCH/);
});

test('notification verification cannot pass on queued SMS, wrong recipients or duplicate provider IDs',()=>{
  const input=fixture();input.requireNotifications=true;
  Object.assign(input.signup,{ownerPhone:'+15555550100',twilioPhoneNumber:'+15555550101'});input.call.customer={number:'+15555550102'};
  const result={name:'send_call_summaries_test',owner:{messageId:'SM'+'1'.repeat(32),toLast4:'0100',fromLast4:'0101'},customer:{messageId:'SM'+'2'.repeat(32),toLast4:'0102',fromLast4:'0101'}};
  Object.assign(input.savedCalls[0],{notificationEvidence:{available:true,owner:{accepted:true,delivered:false},customer:{accepted:true,delivered:false}},toolCallSummary:{results:[result]}});
  assert.equal(assess(input).verified,false);
  input.savedCalls[0].notificationEvidence.owner.delivered=true;input.savedCalls[0].notificationEvidence.customer.delivered=true;
  assert.equal(assess(input).verified,true);
  result.customer.toLast4='9999';assert.equal(assess(input).verified,false);result.customer.toLast4='0102';
  input.savedCalls[0].toolCallSummary.results.push({...result,customer:{...result.customer,messageId:'SM'+'3'.repeat(32)}});
  assert.equal(assess(input).verified,false);
});
