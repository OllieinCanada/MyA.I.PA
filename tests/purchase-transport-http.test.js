'use strict';
// Real loopback HTTP + the app's actual auth/limiter/purchase handler and JSON
// parser. Generated fixtures, synthetic memory DB, fake providers. Not SQL,
// complete server startup, Make execution or a production configuration test.
const test=require('node:test'),assert=require('node:assert/strict');
const {FORMATS,create,wire,receipt}=require('./helpers/purchase-transport-fixture');
// Optional existing test dependency cache: read-only resolution, no install,
// link creation, loader patch or permission/configuration change. Normal CI
// uses its own npm-ci tree. Exact versions are still required before sockets.
const path=require('node:path'),fs=require('node:fs');
const load=process.env.PURCHASE_TRANSPORT_APPROVED_NODE_MODULES
 ?require('node:module').createRequire(path.join(path.dirname(fs.realpathSync(process.env.PURCHASE_TRANSPORT_APPROVED_NODE_MODULES)),'package.json')):require;
const express=load('express'),rateLimit=load('express-rate-limit').rateLimit;
test('real HTTP form/JSON comparison with provider transports refused',{timeout:45000},async t=>{
 assert.equal(load('express/package.json').version,'4.22.3');
 // This package does not export package.json as a module. Read only its
 // installed metadata next to the public resolved entry; load no private API.
 const limiterMetadata=JSON.parse(fs.readFileSync(path.join(path.dirname(load.resolve('express-rate-limit')),'..','package.json'),'utf8'));
 assert.equal(limiterMetadata.name,'express-rate-limit');assert.equal(limiterMetadata.version,'8.6.2');
 const guard=require('../scripts/local-staging-egress').install(),servers=new Set();
 t.after(()=>{assert.equal(servers.size,0,'All owned loopback servers must close, including assertion failures');assert.equal(guard.status().unexpectedOutboundAttempts,0);});
 async function boot(f,t){
  const app=express(),handlers=f.handlers();app.use(express.json({limit:'8kb'}));app.use(f.path,f.limiter(rateLimit));
  app.post(f.path,handlers[0],handlers[1],(req,res,next)=>Promise.resolve(handlers[2](req,res)).catch(next));app.use(f.errorHandler());
  const server=require('node:http').createServer(app);servers.add(server);
  t.after(async()=>{server.closeAllConnections();if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));servers.delete(server);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});guard.allowPort(server.address().port);
  const origin='http://127.0.0.1:'+server.address().port;
  return {origin,async send(format,override={}){const r=wire(f,format),response=await fetch(origin+r.path,{method:'POST',headers:r.headers,body:r.body,...override});return {status:response.status,body:await response.json()};}};
 }
 await t.test('form and JSON reach the same real handler with identical fake purchase arguments',async t=>{
  const results=[];for(const format of FORMATS){const f=create(),http=await boot(f,t),r=await http.send(format);assert.equal(r.status,201);assert.equal(r.body.ok,true);assert.equal(f.shared.providerCalls.length,1);results.push(f.shared.providerCalls[0]);}assert.deepEqual(results[0],results[1]);
 });
 await t.test('cross-format duplicate preserves completed receipt and dispatches once',async t=>{
  const f=create(),http=await boot(f,t);assert.equal((await http.send('empty-multipart')).status,201);const saved=structuredClone(receipt(f));const next=await http.send('json');assert.equal(next.status,200);assert.equal(next.body.reused,true);assert.equal(f.shared.providerCalls.length,1);assert.deepEqual(receipt(f),saved);
 });
 await t.test('malformed JSON refuses before any fake provider request or receipt claim',async t=>{
  const f=create(),http=await boot(f,t),r=await http.send('json',{body:'{"provisioning":'});assert.equal(r.status,400);assert.equal(f.shared.providerCalls.length,0);assert.equal(f.shared.claimCalls,0);
 });
 await t.test('wrong JSON proof retains authentication refusal and zero fake dispatch',async t=>{
  const f=create(),http=await boot(f,t),request=wire(f,'json'),body=JSON.parse(request.body);body.provisioning.contextHash='f'.repeat(64);const r=await http.send('json',{body:JSON.stringify(body)});assert.equal(r.status,401);assert.equal(f.shared.providerCalls.length,0);assert.equal(f.shared.claimCalls,0);
 });
 await t.test('wrong content type cannot silently provision from unparsed JSON',async t=>{
  const f=create(),http=await boot(f,t),request=wire(f,'json');delete request.headers['content-type'];const r=await http.send('json',{headers:request.headers});assert.equal(r.status,401);assert.equal(f.shared.providerCalls.length,0);
 });
 await t.test('a changed JSON inventory preference remains blocked',async t=>{
  const f=create(),http=await boot(f,t),request=wire(f,'json'),body=JSON.parse(request.body);body.areaCode='999';const r=await http.send('json',{body:JSON.stringify(body)});assert.equal(r.status,409);assert.equal(r.body.code,'PROVISIONING_INVENTORY_CONTEXT_MISMATCH');assert.equal(f.shared.providerCalls.length,0);
 });
 await t.test('simultaneous JSON/form requests share the durable-model duplicate fence',async t=>{
  const f=create(),http=await boot(f,t);let enter,release;const entered=new Promise(r=>{enter=r;}),held=new Promise(r=>{release=r;}),fake=f.ctx.purchaseTwilioPhoneNumber;
  f.ctx.purchaseTwilioPhoneNumber=async opts=>{enter();await held;return fake(opts);};
  const pending=http.send('json'),settled=pending.then(r=>({r}),e=>({e}));const started=await Promise.race([entered.then(()=>true),settled.then(()=>false)]);if(!started)throw(await settled).e||Error('FAKE_DISPATCH_NOT_REACHED');
  try{const r=await http.send('empty-multipart');assert.equal(r.status,409);assert.equal(r.body.code,'PROVISIONING_ALREADY_IN_PROGRESS');}finally{release();await pending;}
  assert.equal(f.shared.providerCalls.length,1);assert.equal(receipt(f).data.status,'completed');
 });
 await t.test('unknown provider outcome is not retried when request format changes',async t=>{
  const f=create({mode:'timeout'}),http=await boot(f,t),first=await http.send('json');assert.equal(first.body.code,'ETIMEDOUT');const second=await http.send('empty-multipart');assert.equal(second.body.code,'PROVISIONING_RECONCILIATION_REQUIRED');assert.equal(f.shared.providerCalls.length,1);assert.equal(receipt(f).data.originalErrorCode,'ETIMEDOUT');
 });
 for(const format of FORMATS)await t.test(format+' client disconnect does not lose a completed receipt or repeat the fake purchase',async t=>{
  const f=create(),http=await boot(f,t),controller=new AbortController();let enter,release,complete;
  const entered=new Promise(r=>{enter=r;}),held=new Promise(r=>{release=r;}),completed=new Promise(r=>{complete=r;});
  const fake=f.ctx.purchaseTwilioPhoneNumber,transaction=f.shared.claim.prisma.$transaction.bind(f.shared.claim.prisma);
  f.ctx.purchaseTwilioPhoneNumber=async opts=>{enter();await held;return fake(opts);};
  f.shared.claim.prisma.$transaction=async fn=>{const result=await transaction(fn);if(receipt(f)?.data.status==='completed')complete();return result;};
  const pending=http.send(format,{signal:controller.signal}),outcome=pending.then(r=>({r}),e=>({e}));
  try{
   const started=await Promise.race([entered.then(()=>true),outcome.then(()=>false)]);assert.equal(started,true);
   controller.abort();const observed=await outcome;assert.equal(observed.e?.name,'AbortError');
  }finally{release();}
  let timer;try{await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('MODEL_RECEIPT_NOT_COMPLETED_AFTER_DISCONNECT')),5000);})]);}finally{clearTimeout(timer);}
  const saved=structuredClone(receipt(f)),other=FORMATS.find(x=>x!==format),r=await http.send(other);
  assert.equal(r.status,200);assert.equal(r.body.reused,true);assert.equal(f.shared.providerCalls.length,1);assert.deepEqual(receipt(f),saved);
 });
 await t.test('valid JSON authentication survives the failed-auth request ceiling',async t=>{
  const f=create(),http=await boot(f,t),request=wire(f,'json');delete request.headers['x-myaipa-integration-key'];
  for(let i=0;i<32;i++){const r=await http.send('json',{headers:request.headers});assert.equal(r.status,401);}
  assert.equal(f.shared.providerCalls.length,0);assert.equal((await http.send('json')).status,201);assert.equal(f.shared.providerCalls.length,1);
 });
 await t.test('transport instrumentation refuses every non-owned target',async()=>{
  const r=await guard.probes();assert.equal(r.rejected,6);assert.equal(r.unexpectedOutboundAttempts,0);assert.equal(r.osSandboxProven,false);
 });
});
