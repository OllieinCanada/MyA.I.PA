const {test}=require('node:test');
const assert=require('node:assert/strict');
const {toEvent,PATH,registerTwilioProviderEvents}=require('../server/twilioProviderEvents');
const {getTwilioSignature}=require('../server/smsSuppression');
const {run}=require('../scripts/configure-twilio-direct-alerts');
const account='AC'+'a'.repeat(32);
test('usage events are stable, account-bound and never imply recharge',()=>{
  const body={AccountSid:account,UsageTriggerSid:'UT'+'b'.repeat(32),IdempotencyToken:'unique-fire',DateFired:new Date().toISOString(),UsageCategory:'totalprice',TriggerBy:'price',CurrentValue:'20'};
  assert.deepEqual(toEvent(body,account),toEvent(body,account));
  assert.equal(toEvent(body,account).type,'spending_alert');
  assert.equal(toEvent(body,account).amount,undefined);
  assert.throws(()=>toEvent(body,'AC'+'c'.repeat(32)));
  assert.throws(()=>toEvent({...body,IdempotencyToken:''},account));
});
test('debugger callback excludes raw customer data',()=>{
  const event=toEvent({AccountSid:account,Sid:'NO'+'c'.repeat(32),Level:'ERROR',Timestamp:new Date().toISOString(),Payload:'private phone/secret'},account);
  assert.equal(event.type,'provider_error');assert.ok(!JSON.stringify(event).includes('private'));
});
test('debugger callback preserves only the documented numeric error code',()=>{
 const event=toEvent({AccountSid:account,Sid:'NO'+'c'.repeat(32),Level:'WARNING',Timestamp:new Date().toISOString(),Payload:JSON.stringify({error_code:11200,message:'private@example.com',webhook:{url:'https://example.com?token=secret'}})},account);
 assert.equal(event.errorCode,'11200');
 assert.doesNotMatch(JSON.stringify(event),/private|secret|webhook|example/);
});
test('configuration fails closed before activation on an undeployed endpoint',async()=>{
  let writes=0;
  await assert.rejects(run({env:{TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:'test'},apply:true,dailyLimit:5,fetchImpl:async(url,opts)=>{
    if(url.includes('Usage/Triggers')){if(opts.method==='POST')writes++;return {ok:true,json:async()=>({usage_triggers:[]})};}
    return {status:404,json:async()=>({})};
  }}));assert.equal(writes,0);
});
test('HTTP callback rejects spoofing and distinguishes confirmed duplicates from active leases',async t=>{
  const app=require('express')();let delivered=false,calls=0,mode='delivered';
  const prisma={runtimeStore:{findUnique:async()=>({data:delivered?{deliveredAt:new Date().toISOString()}:{leaseUntil:Date.now()+60000}})}};
  registerTwilioProviderEvents(app,{prisma,env:{TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:'test-secret'},deliver:async()=>{calls++;if(mode==='failure')throw new Error('offline');return mode==='duplicate'?{duplicate:true}:{delivered:true};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{
    server.close(resolve);
    // Fetch keeps sockets alive; close them explicitly so teardown is bounded
    // on Node versions that do not close idle connections with server.close.
    server.closeAllConnections();
  }));
  const body={AccountSid:account,Sid:'NO'+'c'.repeat(32),Level:'WARNING',Timestamp:new Date().toISOString()};
  const url=`http://127.0.0.1:${server.address().port}${PATH}`;
  const send=signature=>fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature},body:new URLSearchParams(body).toString()});
  assert.equal((await send('spoofed')).status,403);assert.equal(calls,0);
  const signature=getTwilioSignature('https://api.myaipa.ca'+PATH,body,'test-secret');
  assert.equal((await send(signature)).status,204);
  mode='duplicate';assert.equal((await send(signature)).status,503);
  delivered=true;assert.equal((await send(signature)).status,204);
  mode='failure';assert.equal((await send(signature)).status,503);
});
