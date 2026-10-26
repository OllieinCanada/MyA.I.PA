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
