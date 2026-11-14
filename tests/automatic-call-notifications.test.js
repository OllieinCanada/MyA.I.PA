'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { executeAutomaticCallNotifications: execute, automaticSummaryToolDefinition } = require('../server/automaticCallNotifications');
const { createAutomaticNotificationContextReader } = require('../server/automaticNotificationContext');
const { createDispatchStub } = require('../scripts/stub-notification-dispatch');
const args = { businessName: 'Untrusted replacement', requestType: 'message', name: 'Fictitious Caller',
  pricingDiscussed: false, message: 'A fictitious request', rawPhoneNumber: '+19055550999' };
const call = { id: 'synthetic-auto-call', assistantId: 'fixture-assistant', phoneNumberId: 'fixture-phone', customer: { number: '+19055550102' } };
const context = { businessId: 7, businessName: 'Synthetic Electric', assistantId: call.assistantId,
  phoneNumberId: call.phoneNumberId, from: '+19055550100', owner: '+19055550101', eligible: true, pricingOptions: null };
const history = answer => [{ role: 'bot', message: 'Should I send this request to the team now?' }, { role: 'user', message: answer }];
function fixture() {
  const gate = createDispatchStub();
  const env = { SMS_NOTIFICATION_DISPATCH_ENABLED: 'true', SMS_AUTOMATIC_NOTIFICATION_ENABLED: 'true', SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS: '[7]', TWILIO_ACCOUNT_SID: 'AC'+'0'.repeat(32), TWILIO_AUTH_TOKEN: 'INERT' };
  const posts = [];
  const options = { prisma: gate.db, authenticated: true, env, message: { call: structuredClone(call),
    toolCallList: [{}], artifact: { messages: history('Perfect. Yes.') } },
    toolCall: { id: 'fixture-tool-1', name: 'send_call_summaries_0100_deadbeef_v2', parameters: { ...args } },
    readContext: async () => structuredClone(context), suppressionChecker: async () => false,
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC'+'0'.repeat(32)+'/Messages.json');
      posts.push(Object.fromEntries(new URLSearchParams(request.body)));
      return { ok: true, status: 201, json: async () => ({ sid: 'SM'+String(posts.length).padStart(32,'0'), status: 'queued' }) };
    } };
  return { gate, env, posts, options, run: () => execute(options) };
}
test('clear approval automatically admits both roles without manual approval and binds recipients/business', async () => {
  const f=fixture(), r=await f.run(); assert.equal(r.complete,true); assert.equal(r.deliveryProven,false);
  assert.deepEqual(f.posts.map(x=>x.To),[context.owner,call.customer.number]);
  assert.ok(f.posts.every(x=>x.From===context.from));
  assert.match(f.posts[1].Body,/Synthetic Electric/); assert.doesNotMatch(f.posts[1].Body,/Untrusted replacement/);
  const rows=[...f.gate.rows.values()]; assert.equal(rows.length,2);
  assert.ok(rows.every(x=>x.data.authorization?.source==='authenticated_vapi_conversation'));
  assert.doesNotMatch(JSON.stringify(rows),/Fictitious Caller|Perfect|A fictitious request/);
});
for(const answer of ['No.','Yes, but wait.','Stop','Maybe','What?']) test('refusal/correction/uncertainty refuses: '+answer,async()=>{
  const f=fixture(); f.options.message.artifact.messages=history(answer); const r=await f.run();
  assert.equal(r.complete,false); assert.equal(f.posts.length,0); assert.equal(f.gate.rows.size,0);
});
test('a later refusal consumes prior approval',async()=>{ const f=fixture(); f.options.message.artifact.messages.push({role:'user',message:'Do not send it.'}); assert.equal((await f.run()).complete,false); assert.equal(f.posts.length,0); });
test('a yes to draft review cannot authorize automatic sending',async()=>{const f=fixture();f.options.message.artifact.messages[0].message='Should I save this request for review?';assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);assert.equal(f.gate.rows.size,0);});
for(const ids of ['', 'null', '[]', '[8]', '["7"]', 'broken'])test('business opt-in must be exact and server-owned: '+ids,async()=>{const f=fixture();f.env.SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS=ids;assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);});
for(const kind of ['auth','flag','artifact','forged-arguments','ambiguous-text','missing-caller','multi-tool','route','eligibility']) test('missing/untrusted authority refuses: '+kind,async()=>{
  const f=fixture();
  if(kind==='auth')f.options.authenticated=false;
  if(kind==='flag')delete f.env.SMS_AUTOMATIC_NOTIFICATION_ENABLED;
  if(kind==='artifact')delete f.options.message.artifact;
  if(kind==='forged-arguments'){f.options.message.artifact.messages=history('No');f.options.toolCall.parameters.approved=true;f.options.toolCall.parameters.messages=history('Yes');}
  if(kind==='ambiguous-text')f.options.message.artifact.messages[1].content='No';
  if(kind==='missing-caller')delete f.options.message.call.customer.number;
  if(kind==='multi-tool')f.options.message.toolCallList.push({});
  if(kind==='route')f.options.readContext=async()=>({...context,assistantId:'other'});
  if(kind==='eligibility')f.options.readContext=async()=>({...context,eligible:false});
  assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);assert.equal(f.gate.rows.size,0);
});
test('duplicates including new tool IDs, fresh executor and concurrency never resubmit a recipient',async()=>{
  const f=fixture();await Promise.all(Array.from({length:20},()=>f.run()));
  f.options.toolCall.id='different-tool-id'; assert.equal((await execute({...f.options})).complete,true);
  assert.equal(f.posts.length,2);
});
test('changed body remains a conflict, not a second send',async()=>{const f=fixture();await f.run();f.options.toolCall.parameters.message='Different';assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,2);});
test('lost provider acknowledgement stays unknown and never resends',async()=>{
  const f=fixture(), original=f.options.fetchImpl;f.options.fetchImpl=async(...a)=>{await original(...a);throw Error('synthetic lost acknowledgement');};
  assert.equal((await f.run()).complete,false);assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,2);
});
test('completion failure retains claims and never falsely reports success',async()=>{
  const f=fixture(), update=f.gate.db.runtimeStore.update;
  f.gate.db.runtimeStore.update=async input=>{if(input.data.data.state==='completed')throw Error('synthetic failure');return update(input);};
  assert.equal((await f.run()).complete,false);assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,2);
});
test('suppression and suppression-read failure send nothing',async()=>{for(const check of [async()=>true,async()=>{throw Error('private detail');}]){const f=fixture();f.options.suppressionChecker=check;assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);}});
test('flag revoked while claim lock is pending refuses admission',async()=>{
  const f=fixture(), transaction=f.gate.db.$transaction;let entered, release;
  const pending=new Promise(r=>entered=r), wait=new Promise(r=>release=r);
  f.gate.db.$transaction=async fn=>{entered();await wait;return transaction(fn);};
  const result=f.run();await pending;f.env.SMS_AUTOMATIC_NOTIFICATION_ENABLED='false';release();
  assert.equal((await result).complete,false);assert.equal(f.posts.length,0);assert.equal(f.gate.rows.size,0);
});
test('changed ownership after initial read refuses admission',async()=>{const f=fixture();let reads=0;f.options.readContext=async()=>({...context,owner:++reads===1?context.owner:'+19055550999'});assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);});
test('missing pricing proof refuses priced request without a send',async()=>{const f=fixture();f.options.toolCall.parameters.pricingDiscussed=true;assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);});
for(const change of [{name:{}},{requestType:'unknown'},{pricingDiscussed:'true'},{message:''},{unexpectedRecipient:'+19055550999'},{requestType:undefined}])test('domain-invalid model arguments refuse before claims: '+JSON.stringify(change),async()=>{
 const f=fixture();Object.assign(f.options.toolCall.parameters,change);assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);assert.equal(f.gate.rows.size,0);
});
test('existing dispatch kill switch is preserved',async()=>{const f=fixture();f.env.SMS_NOTIFICATION_DISPATCH_ENABLED='false';assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);});
test('uncertain claim commit acknowledgement permits no provider attempt or retry',async()=>{
 const f=fixture(),transaction=f.gate.db.$transaction;
 f.gate.db.$transaction=async fn=>{await transaction(fn);throw Error('synthetic committed but acknowledgement lost');};
 assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);
 f.gate.db.$transaction=transaction;assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);
});
test('migration definition uses the same function name/schema, no credential-bearing code tool or manual review',()=>{
 const definition=automaticSummaryToolDefinition('send_call_summaries_0100_deadbeef_v2');
 assert.equal(definition.type,'function');assert.equal(definition.function.parameters.type,'object');
 assert.equal(definition.code,undefined);assert.equal(definition.environmentVariables,undefined);
 assert.doesNotMatch(JSON.stringify(definition),/manual review|requiresApproval|TWILIO_AUTH_TOKEN/);
 assert.throws(()=>automaticSummaryToolDefinition('unmanaged'),/tool_name_invalid/);
});

function readerFixture(){
 const gate={status:'active',businessId:7,assistantId:call.assistantId,phoneNumberId:call.phoneNumberId,phoneNumber:context.from,subscriptionId:'fixture-sub'};
 const signup={status:'setup_ready',businessId:7,vapiAssistantId:call.assistantId,vapiPhoneNumberId:call.phoneNumberId,
   twilioPhoneNumber:context.from,ownerPhone:context.owner,subscriptionId:'fixture-sub',subscriptionStatus:'active'};
 const business={id:7,name:context.businessName,settings:{ownerPhone:context.owner}};
 const inputs={prisma:{business:{findUnique:async()=>business}},readGate:async()=>gate,listSignups:()=>[signup],resolveBusinessId:async()=>7};
 return{gate,signup,business,inputs,read:()=>createAutomaticNotificationContextReader(inputs)(call)};
}
test('real context reader admits exact paid signup without writes or billing calls',async()=>{const f=readerFixture();assert.equal((await f.read()).eligible,true);});
for(const kind of ['expired','archived','wrong-owner','wrong-business','wrong-assistant','ambiguous-signup','unknown-trial-end'])test('real reader refuses '+kind,async()=>{
 const f=readerFixture();
 if(kind==='expired')f.signup.subscriptionStatus='paused';
 if(kind==='archived')f.signup.archivedAt='2026-01-01';
 if(kind==='wrong-owner')f.business.settings.ownerPhone='+19055550999';
 if(kind==='wrong-business')f.gate.businessId=8;
 if(kind==='wrong-assistant')f.gate.assistantId='other';
 if(kind==='ambiguous-signup')f.inputs.listSignups=()=>[f.signup,{...f.signup}];
 if(kind==='unknown-trial-end')f.signup.subscriptionStatus='trialing';
 await assert.rejects(f.read(),/eligibility_unproven/);
});
