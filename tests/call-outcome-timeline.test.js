const test=require('node:test'),assert=require('node:assert/strict');
const {buildCallOutcomeTimeline:build}=require('../src/features/calls/callOutcomeTimeline');
const role=(call,id)=>build(call).find(x=>x.id===id);
test('call completion and linked lead never manufacture delivery or caller authorization',()=>{
 const c={id:1,status:'COMPLETED',lead:{id:2}};assert.equal(role(c,'record').state,'recorded');assert.equal(role(c,'capture').state,'recorded');
 assert.equal(role(c,'owner').state,'unknown');assert.equal(role(c,'customer').state,'unknown');assert.equal(role(c,'handoff').state,'unknown');
});
test('acceptance stays distinct from delivery',()=>{
 assert.equal(role({notificationEvidence:{available:true,owner:{state:'accepted',accepted:true}}},'owner').state,'accepted');
});
test('carrier delivery requires complete consistent server receipt evidence',()=>{
 const owner={state:'delivered',delivered:true,receiptsAvailable:true,receiptStatus:'delivered',receiptAt:'2030-01-01T00:00:00Z'};
 assert.equal(role({notificationEvidence:{available:true,owner}},'owner').state,'delivered');
 for(const change of [{delivered:false},{receiptsAvailable:false},{receiptStatus:'sent'},{receiptStatus:'failed'}])
  assert.equal(role({notificationEvidence:{available:true,owner:{...owner,...change}}},'owner').state,'unknown');
 assert.equal(role({notificationEvidence:{available:false,owner}},'owner').state,'unknown');
});
for(const [state,expected]of [['failed','failed'],['disabled','disabled'],['not_submitted','not_sent'],['needs_number','waiting'],['unconfirmed','unknown']])
 test(state+' is explicit and does not authorize a retry',()=>assert.equal(role({notificationEvidence:{available:true,customer:{state}}},'customer').state,expected));
test('each recipient is assessed separately and timestamps are never invented',()=>{
 const rows=build({notificationEvidence:{available:true,owner:{state:'accepted',accepted:true},customer:{state:'failed'}}});
 assert.equal(rows.find(x=>x.id==='owner').state,'accepted');assert.equal(rows.find(x=>x.id==='customer').state,'failed');assert.equal(rows.find(x=>x.id==='owner').at,null);
});
test('a handoff label without consistent acceptance evidence cannot turn green',()=>{
 assert.equal(role({notificationEvidence:{available:true,submission:'owner_notification_accepted',owner:{accepted:false}}},'handoff').state,'unknown');
});
