'use strict';
// Actual extracted purchase handler/auth, context lock and durable receipt code.
// Real CI SQL/HTTP; signup registry/journal/resource verification and providers
// remain synthetic doubles. No full startup, Make or original-cause proof.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {create,wire}=require('./helpers/purchase-transport-fixture');
const context=require('../server/signupProvisioningContext');
const {runProvisioningStep,provisioningStateKey}=require('../server/provisioningState');
const {writeManifest}=require('../scripts/provider-hardening-evidence');
const {REQUIRED_CASES,sourceHashes}=require('../scripts/verify-purchase-transport-evidence');
const enabled=process.env.RUN_PURCHASE_TRANSPORT_POSTGRES==='1';
if(process.env.PURCHASE_TRANSPORT_EXPECTED_HEAD&&!enabled)throw Error('REQUIRED_SQL_PROOF_CANNOT_SKIP');
test('actual purchase transport and durable SQL behavior',{skip:!enabled,timeout:90000},async t=>{
 const report={scope:'synthetic-purchase-transport-sql-http-only',head:process.env.PURCHASE_TRANSPORT_EXPECTED_HEAD,sourceFiles:sourceHashes(),passed:false,skips:0,cases:[],productionUsed:false,providerRequests:0,messages:0,makeEngineVerified:false,originalFailureCauseProven:false,osSandboxProven:false,unexpectedOutboundAttempts:0,cleanup:{complete:false,ownedRowsRemaining:null,serversClosed:false,connectionsClosed:false,unrelatedPreserved:false}};
 let prisma,observer,guard,before;const owned=new Set(),servers=new Set();
 const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
 const f0=create(),p=f0.payload.provisioning,ck=context.contextStoreKey(p.idempotencyKey),rk=provisioningStateKey('twilio-number',p.idempotencyKey);
 async function run(name,work){await t.test(name,async()=>{let passed=false;try{await work();passed=true;}finally{report.cases.push({name,passed});}});}
 async function snapshot(){return prisma.runtimeStore.findMany({where:{key:{notIn:[...owned]}},orderBy:{key:'asc'}});}
 async function reset(){await prisma.runtimeStore.deleteMany({where:{key:{in:[ck,rk]}}});}
 async function connect(){const url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit','2');const {PrismaClient}=require('@prisma/client');return new PrismaClient({datasources:{db:{url:url.href}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})},log:[]});}
 async function boot({seed=false,mode='valid',contextDb=prisma,claimDb=prisma}={}){
  const f=create({mode});if(seed)await context.registerSignupProvisioningContextForAttempt({prisma,payload:f.payload,eventKey:f.target.attemptId});
  f.ctx.loadSignupProvisioningContextForAttempt=options=>context.loadSignupProvisioningContextForAttempt({...options,prisma:contextDb});
  f.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:claimDb});
  const express=require('express'),app=express(),handlers=f.handlers();app.use(express.json({limit:'8kb'}));app.use(f.path,f.limiter());
  app.post(f.path,handlers[0],handlers[1],(req,res,next)=>Promise.resolve(handlers[2](req,res)).catch(next));app.use(f.errorHandler());
  const server=require('node:http').createServer(app);servers.add(server);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});guard.allowPort(server.address().port);
  return {f,async send(format,override={}){const w=wire(f,format),r=await fetch('http://127.0.0.1:'+server.address().port+w.path,{method:'POST',headers:w.headers,body:w.body,...override});return {status:r.status,body:await r.json()};}};
 }
 try{
  const url=new URL(process.env.DATABASE_URL);assert.ok(process.env.GITHUB_ACTIONS==='true'&&process.env.DISABLE_LOCAL_ENV_FILES==='1'&&url.hostname==='127.0.0.1'&&url.port==='5432'&&url.pathname==='/ci','Only disposable CI PostgreSQL is allowed');assert.match(report.head,/^[a-f0-9]{40}$/);
  prisma=await connect();observer=await connect();const version=await prisma.$queryRaw`SHOW server_version`;report.postgresVersion=version[0].server_version;assert.match(report.postgresVersion,/^18\./);
  assert.equal(await prisma.runtimeStore.count({where:{key:{in:[ck,rk]}}}),0,'Never adopt pre-existing context/receipt rows');owned.add(ck);owned.add(rk);
  const sentinel='synthetic-transport:'+crypto.randomUUID();owned.add(sentinel);await prisma.runtimeStore.create({data:{key:sentinel,data:{invented:true}}});const savedSentinel=await prisma.runtimeStore.findUnique({where:{key:sentinel}});before=await snapshot();
  // Prisma's already initialized native engine is not covered by JS patches;
  // its URL is independently restricted above to this job's service.
  guard=require('../scripts/local-staging-egress').install({ports:[5432]});
  let i=0;
  for(const format of ['empty-multipart','json'])await run(REQUIRED_CASES[i++],async()=>{
   await reset();const first=await boot({seed:true});assert.equal((await first.send(format)).status,201);const saved=await prisma.runtimeStore.findUnique({where:{key:rk}});assert.equal(saved.data.status,'completed');assert.ok(saved.data.dispatchStartedAt);
   const restarted=await boot({claimDb:observer,contextDb:observer});const r=await restarted.send(format==='json'?'empty-multipart':'json');assert.equal(r.status,200);assert.equal(r.body.reused,true);assert.equal(first.f.shared.providerCalls.length,1);assert.equal(restarted.f.shared.providerCalls.length,0);assert.deepEqual(await prisma.runtimeStore.findUnique({where:{key:rk}}),saved);
  });
  for(const format of ['empty-multipart','json'])await run(REQUIRED_CASES[i++],async()=>{
   await reset();const h=await boot({seed:true}),saved=await prisma.runtimeStore.findUnique({where:{key:ck}}),w=wire(h.f,format);delete w.headers['x-myaipa-integration-key'];const r=await h.send(format,{headers:w.headers});assert.equal(r.status,401);assert.equal(h.f.shared.providerCalls.length,0);assert.equal(await prisma.runtimeStore.count({where:{key:rk}}),0);assert.deepEqual(await prisma.runtimeStore.findUnique({where:{key:ck}}),saved);
  });
  for(const format of ['empty-multipart','json'])await run(REQUIRED_CASES[i++],async()=>{
   await reset();const h=await boot({seed:true});const row=await prisma.runtimeStore.findUnique({where:{key:ck}});await prisma.runtimeStore.update({where:{key:ck},data:{data:{...row.data,contextHash:'f'.repeat(64)}}});const r=await h.send(format);assert.equal(r.status,401);assert.equal(r.body.code,'PROVISIONING_CONTEXT_NOT_REGISTERED');assert.equal(h.f.shared.providerCalls.length,0);assert.equal(await prisma.runtimeStore.count({where:{key:rk}}),0);
  });
  for(const format of ['empty-multipart','json'])await run(REQUIRED_CASES[i++],async()=>{
   await reset();const wrapped={runtimeStore:prisma.runtimeStore,$transaction:(fn,opts)=>prisma.$transaction(async tx=>{await fn(tx);throw Object.assign(Error('Invented pre-commit failure'),{code:'P2028'});},opts)},h=await boot({seed:true,contextDb:wrapped}),saved=await prisma.runtimeStore.findUnique({where:{key:ck}});const r=await h.send(format);assert.equal(r.body.code,'P2028');assert.deepEqual(await prisma.runtimeStore.findUnique({where:{key:ck}}),saved);assert.equal(h.f.shared.providerCalls.length,0);assert.equal(await prisma.runtimeStore.count({where:{key:rk}}),0);
  });
  for(const format of ['empty-multipart','json'])await run(REQUIRED_CASES[i++],async()=>{
   // A Prisma callback deadline alone does not interrupt a blocked SQL query.
   // Bound this test's lock wait in PostgreSQL itself; no runtime setting is changed.
   await reset();const wrapped={runtimeStore:prisma.runtimeStore,$transaction:(fn,opts)=>prisma.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;return fn(tx);},{...opts,timeout:2000})},h=await boot({seed:true,contextDb:wrapped}),entered=deferred(),release=deferred();
   const hold=observer.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ck}))::text AS lock_result`;entered.resolve();await release.promise;},{timeout:15000}),outcome=hold.then(()=>({}),error=>({error}));
   try{assert.equal(await Promise.race([entered.promise.then(()=>true),outcome.then(()=>false)]),true);const r=await h.send(format);assert.equal(r.status,500);assert.equal(r.body.code,'P2010');assert.equal(h.f.shared.providerCalls.length,0);assert.equal(await prisma.runtimeStore.count({where:{key:rk}}),0);}finally{release.resolve();const end=await outcome;if(end.error)throw end.error;}
   assert.equal((await prisma.runtimeStore.findUnique({where:{key:ck}})).data.lockedAt,undefined);
  });
  await run(REQUIRED_CASES[i++],async()=>{
   await reset();const a=await boot({seed:true}),b=await boot({contextDb:observer,claimDb:observer}),entered=deferred(),release=deferred(),fake=a.f.ctx.purchaseTwilioPhoneNumber;
   a.f.ctx.purchaseTwilioPhoneNumber=async o=>{entered.resolve();await release.promise;return fake(o);};const pending=a.send('json'),outcome=pending.then(r=>({r}),error=>({error}));
   try{assert.equal(await Promise.race([entered.promise.then(()=>true),outcome.then(()=>false)]),true);const r=await b.send('empty-multipart');assert.equal(r.status,409);assert.equal(r.body.code,'PROVISIONING_ALREADY_IN_PROGRESS');}finally{release.resolve();const end=await outcome;if(end.error)throw end.error;assert.equal(end.r.status,201);}
   assert.equal(a.f.shared.providerCalls.length+b.f.shared.providerCalls.length,1);
  });
  await run(REQUIRED_CASES[i++],async()=>{
   await reset();const a=await boot({seed:true,mode:'timeout'});assert.equal((await a.send('json')).body.code,'ETIMEDOUT');const client=await connect();try{const b=await boot({contextDb:client,claimDb:client});assert.equal((await b.send('empty-multipart')).body.code,'PROVISIONING_RECONCILIATION_REQUIRED');assert.equal(b.f.shared.providerCalls.length,0);assert.equal((await prisma.runtimeStore.findUnique({where:{key:rk}})).data.originalErrorCode,'ETIMEDOUT');}finally{await client.$disconnect();}assert.equal(a.f.shared.providerCalls.length,1);
  });
  await run(REQUIRED_CASES[i++],async()=>{
   await reset();let lost=false;const wrapped={runtimeStore:prisma.runtimeStore,$transaction:async(fn,opts)=>{const result=await prisma.$transaction(fn,opts);const row=await prisma.runtimeStore.findUnique({where:{key:rk}});if(!lost&&row?.data.status==='completed'){lost=true;throw Object.assign(Error('Invented acknowledgement loss after real commit'),{code:'P2028'});}return result;}},a=await boot({seed:true,claimDb:wrapped});assert.equal((await a.send('empty-multipart')).body.code,'P2028');assert.equal(lost,true);const saved=await prisma.runtimeStore.findUnique({where:{key:rk}});assert.equal(saved.data.status,'completed');const b=await boot({contextDb:observer,claimDb:observer});assert.equal((await b.send('json')).body.reused,true);assert.deepEqual(await prisma.runtimeStore.findUnique({where:{key:rk}}),saved);assert.equal(a.f.shared.providerCalls.length+b.f.shared.providerCalls.length,1);
  });
  await run(REQUIRED_CASES[i++],async()=>{assert.deepEqual(await snapshot(),before);assert.deepEqual(await prisma.runtimeStore.findUnique({where:{key:sentinel}}),savedSentinel);const probes=await guard.probes();assert.equal(probes.rejected,6);assert.equal(probes.unexpectedOutboundAttempts,0);});
  assert.equal(i,REQUIRED_CASES.length);report.passed=report.cases.length===REQUIRED_CASES.length&&report.cases.every(c=>c.passed);
 }finally{
  const failures=[];
  for(const s of servers){try{s.closeAllConnections();if(s.listening)await new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));servers.delete(s);}catch(e){failures.push(e);}}
  report.cleanup.serversClosed=servers.size===0;
  try{if(prisma&&before)report.cleanup.unrelatedPreserved=JSON.stringify(await snapshot())===JSON.stringify(before);if(prisma&&owned.size){await prisma.runtimeStore.deleteMany({where:{key:{in:[...owned]}}});report.cleanup.ownedRowsRemaining=await prisma.runtimeStore.count({where:{key:{in:[...owned]}}});}}catch(e){failures.push(e);}
  report.cleanup.connectionsClosed=(await Promise.allSettled([prisma?.$disconnect(),observer?.$disconnect()])).every(r=>r.status==='fulfilled');report.unexpectedOutboundAttempts=guard?.status().unexpectedOutboundAttempts??0;
  report.cleanup.complete=!failures.length&&report.cleanup.serversClosed&&report.cleanup.connectionsClosed&&report.cleanup.unrelatedPreserved&&report.cleanup.ownedRowsRemaining===0;report.passed=report.passed&&report.cleanup.complete&&report.unexpectedOutboundAttempts===0;writeManifest('diagnostics/purchase-transport/result.json',report);
  assert.equal(report.cleanup.complete,true,'Owned SQL/HTTP cleanup must succeed, including failed assertions');
 }
});
