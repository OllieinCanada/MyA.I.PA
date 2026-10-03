const test=require('node:test');
const assert=require('node:assert/strict');
const {enqueueProviderNotification,deliverDurably}=require('../server/providerNotifications');
const event={provider:'twilio',type:'provider_warning',id:'debug:test',occurredAt:new Date().toISOString(),errorCode:'11200'};
function database() {
  const rows=new Map();let tail=Promise.resolve();
  const runtimeStore={findUnique:async({where})=>rows.get(where.key),upsert:async({where,create,update})=>rows.set(where.key,rows.has(where.key)?{data:update.data}:create),update:async({where,data})=>rows.set(where.key,data)};
  const tx={runtimeStore,$queryRaw:async()=>[]};
  return {rows,prisma:{...tx,$transaction:callback=>{const work=tail.then(()=>callback(tx));tail=work.catch(()=>{});return work;}}};
}
test('simultaneous callbacks persist one redacted notification before delivery',async()=>{
  const {prisma,rows}=database();
  const receipts=await Promise.all([enqueueProviderNotification(event,{prisma}),enqueueProviderNotification(event,{prisma})]);
  assert.equal(rows.size,1);assert.equal(receipts.filter(item=>!item.duplicate).length,1);
  assert.equal([...rows.values()][0].data.queued,true);
  await assert.rejects(enqueueProviderNotification({...event,errorCode:'30007'},{prisma}),/identity conflict/);
});
test('process restart before sending leaves recoverable work; provider retries do not erase it',async()=>{
  const {prisma,rows}=database();await enqueueProviderNotification(event,{prisma});
  let sends=0;
  const options={prisma,token:'synthetic',chatId:'1',fetchImpl:async()=>{sends++;return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:1}})};}};
  await deliverDurably([...rows.values()][0].data.event,options);
  const receipt=await enqueueProviderNotification(event,{prisma});assert.equal(receipt.delivered,true);
  await deliverDurably(event,options);assert.equal(sends,1);
});
test('failed delivery is durable and retryable; storage failure cannot be acknowledged',async()=>{
  const {prisma,rows}=database();await enqueueProviderNotification(event,{prisma});
  await assert.rejects(deliverDurably(event,{prisma,token:'synthetic',chatId:'1',fetchImpl:async()=>{throw new Error('offline');}}));
  assert.equal([...rows.values()][0].data.lastFailure,'telegram_delivery_unconfirmed');
  assert.equal((await enqueueProviderNotification(event,{prisma})).delivered,false);
  await assert.rejects(enqueueProviderNotification(event,{prisma:{}}),/unavailable/);
});
