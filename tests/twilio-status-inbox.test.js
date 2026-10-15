const test=require('node:test');
const assert=require('node:assert/strict');
const {enqueueTwilioStatus,drainTwilioStatuses,receiptKey,WORKER_KEY}=require('../server/twilioStatusInbox');
const {memoryDb}=require('./helpers/twilio-status-memory-db');
const {getAgentTestDeliveryUpdate}=require('../server/signupAgentTesting');
const receipt={MessageSid:'SM'+'1'.repeat(32),MessageStatus:'delivered'};

test('receipt commit precedes acknowledgment; enqueue never runs continuation',async()=>{
 const {prisma,rows}=memoryDb();let processed=0;
 const result=await enqueueTwilioStatus({prisma,body:{...receipt,To:'+19055550123',Body:'private',token:'secret'},now:100});
 assert.equal(result.status,'pending');assert.equal(processed,0);
 assert.deepEqual(rows.get(result.key).data.receipt,receipt);
 await drainTwilioStatuses({prisma,now:()=>100,processReceipt:async body=>{assert.deepEqual(body,receipt);processed++;}});
 assert.equal(processed,1);assert.equal(rows.get(result.key).data.status,'completed');
});
test('concurrent identical callbacks persist exactly one job and process once',async()=>{
 const {prisma}=memoryDb();const r=await Promise.all(Array.from({length:5},()=>enqueueTwilioStatus({prisma,body:receipt})));
 assert.equal(r.filter(x=>!x.duplicate).length,1);let count=0;
 await Promise.all([1,2].map(()=>drainTwilioStatuses({prisma,processReceipt:async()=>{count++;await new Promise(r=>setTimeout(r,10));}})));
 await enqueueTwilioStatus({prisma,body:receipt});await drainTwilioStatuses({prisma,processReceipt:async()=>count++});assert.equal(count,1);
});
test('database failure cannot acknowledge or fall back to memory',async()=>{
 await assert.rejects(enqueueTwilioStatus({prisma:{$transaction:async()=>{throw Error('offline');}},body:receipt}),/offline/);
 await assert.rejects(enqueueTwilioStatus({prisma:memoryDb().prisma,body:{MessageSid:'not-a-sid',MessageStatus:'delivered'}}),{code:'TWILIO_RECEIPT_INVALID'});
});
test('MMS delivery receipts use the same durable inbox without storing message content',async()=>{
 const {prisma,rows}=memoryDb();const body={MessageSid:'MM'+'2'.repeat(32),MessageStatus:'delivered'};
 await enqueueTwilioStatus({prisma,body});assert.deepEqual(rows.get(receiptKey(body)).data.receipt,body);
});
test('reconstructed worker recovers a committed receipt before any work ran',async()=>{
 const {prisma,rows}=memoryDb();await enqueueTwilioStatus({prisma,body:receipt,now:100});
 let sends=0;await drainTwilioStatuses({prisma,now:()=>101,processReceipt:async()=>sends++});
 assert.equal(sends,1);assert.equal(rows.get(receiptKey(receipt)).data.status,'completed');
});
test('expired worker/job lease resumes; live worker lease blocks competitors',async()=>{
 const {prisma,rows}=memoryDb();await enqueueTwilioStatus({prisma,body:receipt,now:100});
 Object.assign(rows.get(receiptKey(receipt)).data,{status:'processing',token:'dead',leaseExpiresAt:200,attempts:1});
 rows.set(WORKER_KEY,{key:WORKER_KEY,data:{token:'dead',leaseExpiresAt:200}});let count=0;
 assert.equal((await drainTwilioStatuses({prisma,now:()=>150,processReceipt:async()=>count++})).busy,true);
 await drainTwilioStatuses({prisma,now:()=>201,processReceipt:async()=>count++});assert.equal(count,1);
});
test('failure retries with backoff and preserves error code, not secret details',async()=>{
 const {prisma,rows}=memoryDb();await enqueueTwilioStatus({prisma,body:receipt,now:100});let attempts=0;
 const run=now=>drainTwilioStatuses({prisma,now:()=>now,processReceipt:async()=>{attempts++;if(attempts===1)throw Object.assign(Error('token=secret'),{code:'LOOKUP_FAILED'});}});
 await run(100);assert.equal(rows.get(receiptKey(receipt)).data.lastErrorCode,'LOOKUP_FAILED');assert.doesNotMatch(JSON.stringify([...rows]),/secret/);
 await run(101);assert.equal(attempts,1);await run(5100);assert.equal(attempts,2);
});
test('a worker that loses its lease cannot complete a job or release its successor lease',async()=>{
 const {prisma,rows}=memoryDb();await enqueueTwilioStatus({prisma,body:receipt,now:100});
 await drainTwilioStatuses({prisma,now:()=>100,processReceipt:async()=>{
   rows.set(WORKER_KEY,{key:WORKER_KEY,data:{token:'successor',leaseExpiresAt:999999}});
 }});
 assert.equal(rows.get(receiptKey(receipt)).data.status,'processing');
 assert.equal(rows.get(WORKER_KEY).data.token,'successor');
});
test('exhausted jobs remain stored and escalate once, without infinite retry',async()=>{
 const {prisma,rows}=memoryDb();await enqueueTwilioStatus({prisma,body:receipt,now:100});rows.get(receiptKey(receipt)).data.attempts=7;
 let escalated=0;const opts={prisma,now:()=>100,processReceipt:async()=>{throw Error('failure');},onFailure:async({exhausted})=>{assert.equal(exhausted,true);escalated++;}};
 await drainTwilioStatuses(opts);await drainTwilioStatuses(opts);assert.equal(escalated,1);assert.equal(rows.get(receiptKey(receipt)).data.status,'failed');
});
test('crash after side effect replays handler but reuses durable SMS receipt',async()=>{
 const {dispatchSignupSms}=require('../server/signupSmsDispatch');const {prisma,rows}=memoryDb();await enqueueTwilioStatus({prisma,body:receipt,now:100});let sends=0;
 const dispatch=()=>dispatchSignupSms({prisma,identity:'fixture-business',purpose:'customer-test',request:{to:'+19055550123',message:'fixture'},sendSms:async()=>({sid:'SMsaved',status:'delivered',count:++sends})});
 await dispatch();Object.assign(rows.get(receiptKey(receipt)).data,{status:'processing',token:'dead',leaseExpiresAt:101,attempts:1});
 await drainTwilioStatuses({prisma,now:()=>102,processReceipt:dispatch});assert.equal(sends,1);
});
test('late sent/owner callbacks cannot regress delivered or passed test state',()=>{
 const signup={agentTestOwnerMessageSid:receipt.MessageSid,agentTestOwnerProviderStatus:'delivered',agentTestOwnerDeliveredAt:'saved',agentTestCustomerProviderStatus:'delivered',agentTestCustomerDeliveredAt:'saved',agentTestStatus:'passed'};
 assert.equal(getAgentTestDeliveryUpdate({signup,messageSid:receipt.MessageSid,status:'sent'}),null);
 assert.equal(getAgentTestDeliveryUpdate({signup,messageSid:receipt.MessageSid,status:'failed'}).agentTestStatus,'failed');
 const replay=getAgentTestDeliveryUpdate({signup,messageSid:receipt.MessageSid,status:'delivered'});assert.equal(replay.agentTestStatus,'passed');assert.equal(replay.agentTestOwnerDeliveredAt,'saved');
});
