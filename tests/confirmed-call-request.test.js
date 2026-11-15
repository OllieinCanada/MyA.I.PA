'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {captureConfirmedRequest:capture,reconcileConfirmedRequest:reconcile,keyFor}=require('../server/confirmedCallRequest');
const {createDispatchStub}=require('../scripts/stub-notification-dispatch');
function fixture(){
 const db=createDispatchStub(),call={id:'fixture-confirmed-call',assistantId:'assistant',phoneNumberId:'phone',customer:{number:'+19055550102'}};
 const context={businessId:7,businessName:'Synthetic Electric',assistantId:'assistant',phoneNumberId:'phone',eligible:true};
 const args={requestType:'message',name:'Fictitious caller',message:'Fictitious callback request',pricingDiscussed:false};
 const options={prisma:db.db,call,context,args,authorization:{source:'authenticated_vapi_conversation',providerTimestamp:Date.now(),conversationHash:'a'.repeat(64),toolCallHash:'b'.repeat(64)},assertFresh:async()=>{}};
 function canonical(change={}){const row={id:11,externalProvider:'vapi',externalId:call.id,businessId:7,callerId:12,caller:{id:12,phone:call.customer.number},status:'COMPLETED',endedAt:new Date(),...change};db.calls.set(row.id,row);return row;}
 return{...db,options,canonical,run:()=>capture(options),link:()=>reconcile({prisma:db.db,callId:call.id})};
}
test('authorized request survives before canonical call, then creates exactly one linked lead',async()=>{
 const f=fixture();assert.equal((await f.run()).state,'pending_call');assert.equal(f.leads.size,0);
 f.canonical();const result=await f.link();assert.equal(result.leadSaved,true);assert.equal(f.leads.size,1);
 const row=[...f.leads.values()][0];assert.equal(row.businessId,7);assert.equal(row.callId,11);assert.equal(row.callerId,12);assert.match(row.summary,/Fictitious callback request/);
 const receipt=f.rows.get(keyFor(f.options.call.id)).data;assert.equal(receipt.fields,undefined);assert.equal(JSON.stringify(receipt).includes('Fictitious callback request'),false);
 await Promise.all(Array.from({length:20},()=>f.link()));await f.run();assert.equal(f.leads.size,1);
});
test('post-call-before-tool ordering links safely and duplicate/new tool IDs keep the same lead',async()=>{
 const f=fixture();f.canonical();assert.equal((await f.link()).state,'no_confirmed_request');await f.run();
 f.options.authorization.toolCallHash=crypto.createHash('sha256').update('another tool').digest('hex');await f.run();assert.equal(f.leads.size,1);
});
test('historical completed call without current authorization cannot be backfilled',async()=>{
 const f=fixture();f.canonical({endedAt:new Date(Date.now()-86400000)});await assert.rejects(f.run(),/requires inspection/);assert.equal(f.rows.size,0);assert.equal(f.leads.size,0);
});
for(const kind of ['business','caller','provider','assistant','phone','approval','incomplete-work','changed-body'])test('refuses '+kind+' without overwriting anything',async()=>{
 const f=fixture();if(kind==='changed-body'){await f.run();f.options.args.message='Different request';}
 else if(kind==='business')f.canonical({businessId:8});else if(kind==='caller')f.canonical({caller:{id:12,phone:'+19055550999'}});
 else if(kind==='provider')f.canonical({externalProvider:'other'});else if(kind==='assistant')f.options.context.assistantId='wrong';
 else if(kind==='phone')f.options.call.customer.number='unknown';else if(kind==='approval')delete f.options.authorization;
 else if(kind==='incomplete-work')f.options.args.requestType='repair';
 const before=JSON.stringify([...f.rows]);await assert.rejects(f.run());assert.equal(JSON.stringify([...f.rows]),before);assert.equal(f.leads.size,0);
});
test('failed lead insert rolls back new request atomically; canonical call survives',async()=>{
 const f=fixture();f.canonical();f.db.lead.create=async()=>{throw Error('synthetic insert outage');};await assert.rejects(f.run());assert.equal(f.rows.size,0);assert.equal(f.leads.size,0);assert.equal(f.calls.size,1);
});
test('link failure preserves already-durable pending request for database-only reconciliation',async()=>{
 const f=fixture();await f.run();f.canonical();const create=f.db.lead.create;f.db.lead.create=async()=>{throw Error('synthetic');};await assert.rejects(f.link());assert.equal(f.rows.get(keyFor(f.options.call.id)).data.status,'pending_call');
 f.db.lead.create=create;await f.link();assert.equal(f.leads.size,1);
});
test('lost capture commit acknowledgement is inspected by receipt, not duplicated',async()=>{
 const f=fixture();f.canonical();const transaction=f.db.$transaction;f.db.$transaction=async fn=>{await transaction(fn);throw Error('synthetic lost commit acknowledgement');};await assert.rejects(f.run());
 f.db.$transaction=transaction;assert.equal((await f.link()).leadSaved,true);assert.equal(f.leads.size,1);
});
test('unowned existing lead and deleted linked lead are inspection cases, never overwritten/resurrected',async()=>{
 const f=fixture();f.canonical();f.leads.set(99,{id:99,callId:11,businessId:7,callerId:12});await assert.rejects(f.run());assert.equal(f.leads.get(99).id,99);
 f.leads.clear();await f.run();f.leads.clear();await assert.rejects(f.link());assert.equal(f.leads.size,0);
});
test('authorization changed after a write rolls back capture and lead together',async()=>{
 const f=fixture();f.canonical();let reads=0;f.options.assertFresh=async()=>{if(++reads===3)throw Error('synthetic revoked');};await assert.rejects(f.run());assert.equal(f.leads.size,0);assert.equal(f.rows.size,0);
});
test('no row means no historical capture and no transaction',async()=>{
 const f=fixture();f.db.$transaction=async()=>{throw Error('should not open transaction');};assert.equal((await f.link()).state,'no_confirmed_request');
});
test('changed sender or owner cannot create a new route for the same request',async()=>{
 for(const key of ['owner','from']){const f=fixture();await f.run();f.options.context[key]='+19055550999';await assert.rejects(f.run());assert.equal(f.rows.size,1);assert.equal(f.leads.size,0);}
});
test('tampered pending fields refuse rather than fabricating a lead',async()=>{
 const f=fixture();await f.run();f.rows.get(keyFor(f.options.call.id)).data.fields.summary='Tampered';f.canonical();await assert.rejects(f.link());assert.equal(f.leads.size,0);
});
test('missing linked canonical call is not a queued recreation',async()=>{
 const f=fixture();f.canonical();await f.run();f.calls.clear();f.leads.clear();await assert.rejects(f.link());assert.equal(f.leads.size,0);
});
test('stale authorization cannot create a fresh capture record',async()=>{
 const f=fixture();f.options.authorization.providerTimestamp=Date.now()-120000;await assert.rejects(f.run());assert.equal(f.rows.size,0);
});
test('call committed while request was invisible is linked by the post-commit read',async()=>{
 const f=fixture(),transaction=f.db.$transaction;let first=true;
 f.db.$transaction=async fn=>{const r=await transaction(fn);if(first){first=false;f.canonical();}return r;};
 assert.equal((await f.run()).leadSaved,true);assert.equal(f.leads.size,1);
});
