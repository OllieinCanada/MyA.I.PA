'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executeAutomaticCallNotifications:execute}=require('../server/automaticCallNotifications');
const {automaticNotificationAlert:alert}=require('../server/notificationOutcomes');
const {createDispatchStub}=require('../scripts/stub-notification-dispatch');
function fixture(){
 const gate=createDispatchStub(),posts=[];
 const options={prisma:gate.db,authenticated:true,
  env:{SMS_AUTOMATIC_NOTIFICATION_ENABLED:'true',SMS_NOTIFICATION_DISPATCH_ENABLED:'true',SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS:'[7]',TWILIO_ACCOUNT_SID:'AC_INERT',TWILIO_AUTH_TOKEN:'INERT'},
  message:{call:{id:'failure-fixture-call',assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',customer:{number:'+19055550102'}},toolCallList:[{}],artifact:{messages:[{role:'bot',message:'Should I send this request to the team now?'},{role:'user',message:'Yes, please.'}]}},
  toolCall:{id:'fixture-tool',name:'send_call_summaries_0100_deadbeef_v2',parameters:{requestType:'message',name:'Fictitious Caller',pricingDiscussed:false,message:'Fictitious content'}},
  readContext:async()=>({businessId:7,businessName:'Synthetic Electric',eligible:true,assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',from:'+19055550100',owner:'+19055550101'}),
  suppressionChecker:async()=>false,fetchImpl:async(_url,request)=>{posts.push(request.body);return{ok:true,status:201,json:async()=>({sid:'SM'+String(posts.length).padStart(32,'0'),status:'queued'})};}};
 return{gate,posts,options,run:()=>execute(options)};
}
test('database unavailable before admission: zero provider attempts and unknown, not false acceptance',async()=>{
 const f=fixture();f.gate.db.$transaction=async()=>{throw Error('synthetic unavailable');};const r=await f.run();
 assert.equal(f.posts.length,0);assert.equal(r.complete,false);assert.equal(alert(r,'fixture').owner.state,'unknown');
});
test('database rollback before commit grants no send; subsequent fresh attempt can admit safely',async()=>{
 const f=fixture(),transaction=f.gate.db.$transaction;
 f.gate.db.$transaction=fn=>transaction(async tx=>{await fn(tx);throw Error('synthetic rollback');});
 assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);assert.equal(f.gate.rows.size,0);
 f.gate.db.$transaction=transaction;assert.equal((await f.run()).complete,true);assert.equal(f.posts.length,2);
});
test('simulated process loss after committed claims before send: restart cannot resend',async()=>{
 const f=fixture(),transaction=f.gate.db.$transaction;
 f.gate.db.$transaction=async fn=>{await transaction(fn);throw Error('synthetic post-commit loss');};
 assert.equal((await f.run()).complete,false);assert.equal(f.posts.length,0);assert.equal(f.gate.rows.size,2);
 f.gate.db.$transaction=transaction;const r=await execute({...f.options,prisma:{...f.gate.db}});
 assert.equal(r.complete,false);assert.equal(f.posts.length,0);assert.equal(alert(r,'fixture').owner.state,'unknown');
});
for(const status of [400,402,408,429,500,503])test('provider response '+status+' is never retried and accurately classified',async()=>{
 const f=fixture();f.options.fetchImpl=async(_url,request)=>{f.posts.push(request.body);return{ok:false,status,json:async()=>({code:status===402?'20003':'30001'})};};
 const r=await f.run();await f.run();assert.equal(f.posts.length,2);assert.equal(r.complete,false);
 assert.equal(alert(r,'fixture').owner.state,status>=500||status===408?'unknown':'not_sent');
});
test('provider timeout after fake acceptance: no repeat, receipt cannot be guessed',async()=>{
 const f=fixture(),send=f.options.fetchImpl;f.options.fetchImpl=async(...args)=>{await send(...args);throw Error('synthetic timeout');};
 const r=await f.run();await execute({...f.options});assert.equal(f.posts.length,2);assert.equal(alert(r,'fixture').customer.state,'unknown');
});
test('accepted provider response but database receipt failure stays inspectable and held on restart',async()=>{
 const f=fixture(),update=f.gate.db.runtimeStore.update;
 f.gate.db.runtimeStore.update=async input=>{if(input.data.data.state==='completed')throw Error('synthetic completion loss');return update(input);};
 const r=await f.run();assert.equal(alert(r,'fixture').owner.state,'accepted');assert.equal(alert(r,'fixture').owner.requiresInspection,true);
 assert.equal(r.complete,false);await execute({...f.options});assert.equal(f.posts.length,2);
});
test('changed request cannot silently overwrite the first accepted text',async()=>{
 const f=fixture();await f.run();f.options.toolCall.parameters.message='Fictitious correction';
 const r=await f.run();assert.equal(f.posts.length,2);assert.equal(r.complete,false);assert.equal(alert(r,'fixture').owner.state,'unknown');
});
