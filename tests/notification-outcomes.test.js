'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyNotificationOutcome:classify,automaticNotificationAlert,inspectNotificationReceipts:inspect,listNotificationOutcomeAlerts:list}=require('../server/notificationOutcomes');
const {receiptKey}=require('../server/twilioStatusInbox');
const sid='SM'+'1'.repeat(32),accepted={sent:true,attempted:true,status:'queued',messageId:sid,dispatchReceiptStored:true};
test('accepted means provider acceptance, never delivery',()=>{const r=classify(accepted);assert.equal(r.state,'accepted');assert.equal(r.deliveryProven,false);assert.equal(r.automaticRetryAllowed,false);});
for(const result of [{attempted:false,sent:false,status:'suppressed'},{attempted:false,sent:false,status:'not_configured'},
 {attempted:true,sent:false,status:'rejected',providerStatus:400}])test('known refusal/no submission is not sent: '+result.status,()=>{assert.equal(classify(result).state,'not_sent');});
for(const result of [null,{attempted:true,sent:false,status:'transport_error'},{attempted:true,sent:false,status:'rejected',providerStatus:500},
 {attempted:true,sent:false,status:'rejected',providerStatus:408},{sent:true,attempted:true,messageId:'invalid'},
 {sent:false,attempted:false,requiresReconciliation:true}])test('ambiguous result stays unknown: '+JSON.stringify(result),()=>{const r=classify(result);assert.equal(r.state,'unknown');assert.equal(r.requiresInspection,true);assert.equal(r.automaticRetryAllowed,false);});
test('accepted but receipt persistence lost remains inspectable, not safely complete',()=>{const r=classify({...accepted,dispatchReceiptStored:false});assert.equal(r.state,'accepted');assert.equal(r.requiresInspection,true);assert.equal(r.receiptPersistenceUnconfirmed,true);});
test('provider acceptance with failed status is not silent success',()=>{const r=classify({...accepted,status:'failed'});assert.equal(r.state,'accepted');assert.equal(r.requiresInspection,true);assert.equal(r.deliveryFailureReported,true);});
test('structured alerts redact bodies, numbers, provider IDs and arbitrary errors',()=>{
 const r=automaticNotificationAlert({owner:{...accepted,body:'private-body',to:'+19055550101'},customer:{sent:false,attempted:true,error:'secret-value'}},'private-call');
 assert.equal(r.owner.state,'accepted');assert.equal(r.customer.state,'unknown');
 assert.doesNotMatch(JSON.stringify(r),/private-body|19055550101|private-call|secret-value|SM111/);
});
function receipt(status='delivered',id=sid){const receipt={MessageSid:id,MessageStatus:status};return{key:receiptKey(receipt),data:{version:1,receipt,receivedAt:Date.now()}};}
function reader(rows){let writes=0;return{db:{runtimeStore:{findMany:async()=>rows,update:async()=>{writes++;throw Error('forbidden');},create:async()=>{writes++;throw Error('forbidden');}}},writes:()=>writes};}
test('saved receipt check is read-only and can prove carrier delivery for exact SID',async()=>{const f=reader([receipt()]),r=await inspect({prisma:f.db,result:accepted});assert.equal(r.deliveryProven,true);assert.equal(r.receiptCheck,'saved_authenticated_inbox');assert.equal(f.writes(),0);});
test('unknown without SID cannot guess a receipt or make a provider request',async()=>{let reads=0;const r=await inspect({prisma:{runtimeStore:{findMany:async()=>{reads++;throw Error('forbidden');}}},result:{attempted:true,sent:false}});assert.equal(r.state,'unknown');assert.equal(r.receiptCheck,'missing_message_id');assert.equal(reads,0);});
test('no receipt is not delivery and failed receipt is visible',async()=>{
 assert.equal((await inspect({prisma:reader([]).db,result:accepted})).deliveryProven,false);
 const r=await inspect({prisma:reader([receipt('undelivered')]).db,result:accepted});assert.equal(r.deliveryStatus,'failed');assert.equal(r.requiresInspection,true);assert.equal(r.deliveryProven,false);
});
for(const rows of [[receipt('delivered','SM'+'2'.repeat(32))],[{...receipt(),key:'wrong'}],[receipt(),receipt()],
 [{...receipt(),data:{...receipt().data,receivedAt:0}}]])test('mismatched or invalid receipt cannot promote delivery',async()=>{const r=await inspect({prisma:reader(rows).db,result:accepted});assert.equal(r.deliveryProven,false);assert.equal(r.receiptCheck,'invalid_evidence');});
test('conflicting terminal receipts require inspection, not a false delivered label',async()=>{const r=await inspect({prisma:reader([receipt(),receipt('undelivered')]).db,result:accepted});assert.equal(r.deliveryProven,false);assert.equal(r.receiptCheck,'conflicting_receipts');});
test('receipt-store outage is unknown delivery, never healthy',async()=>{const r=await inspect({prisma:{runtimeStore:{findMany:async()=>{throw Error('private-db-url');}}},result:accepted});assert.equal(r.receiptCheck,'store_unavailable');assert.equal(r.requiresInspection,true);assert.doesNotMatch(JSON.stringify(r),/private-db-url/);});
test('admin projection bounds tenant and held claims stay unknown',async()=>{
 const callReference='a'.repeat(64), auth={source:'authenticated_vapi_conversation',businessId:7,leg:'owner',callReference};
 const rows=[{key:'claim',data:{state:'claimed',authorization:auth}},{key:'other',data:{state:'claimed',authorization:{...auth,businessId:8}}}];
 const f=reader(rows),r=await list({prisma:f.db,businessId:7});assert.equal(r.alerts.length,1);assert.equal(r.alerts[0].state,'unknown');assert.equal(r.readOnly,true);assert.equal(f.writes(),0);
 await assert.rejects(list({prisma:f.db,businessId:NaN}),/Exact business/);
});
