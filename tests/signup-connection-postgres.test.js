'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const express=require('express');
const {fixture,registerFixtureHttp}=require('./helpers/signup-connection-fixture');
const {createConnectionControl,journalKey}=require('../server/signupConnectionControl');
const {createAssociationFence,digest}=require('../server/signupAssociationRepair');
const {hashOperationalTarget}=require('../server/signupDecommission');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const {provisioningStateKey}=require('../server/provisioningState');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
const sources=['server/index.js','server/signupConnectionControl.js','server/signupConnectionEvidence.js','server/signupConnectionTransport.js',
 'server/signupConnectionPreparation.js','server/signupAssociationRepair.js','server/provisioningState.js','server/vapiTwilioImportRequest.js',
 'server/trialUsagePolicy.js','prisma/schema.prisma','tests/helpers/signup-connection-fixture.js','tests/signup-connection-postgres.test.js',
 'tests/signup-connection-control.test.js','.github/workflows/signup-no-send-connection.yml',
 'scripts/verify-no-send-connection-evidence.js','tests/signup-connection-artifact.test.js'];
if(process.env.CONNECTION_ARTIFACT&&process.env.RUN_CONNECTION_POSTGRES!=='1')throw Error('Required SQL proof cannot be skipped');
test('disposable PostgreSQL 18: real no-send reader/control/import receipt and SQL/file writer',
 {skip:process.env.RUN_CONNECTION_POSTGRES!=='1',timeout:180000},async t=>{
 const url=new URL(process.env.DATABASE_URL);
 assert.ok(process.env.GITHUB_ACTIONS==='true'&&url.hostname==='127.0.0.1'&&url.pathname==='/ci','Only the disposable loopback CI service is allowed');
 const {PrismaClient}=require('@prisma/client'),prisma=new PrismaClient(),observer=new PrismaClient();
 const report={scope:'synthetic-no-send-connection-only',head:process.env.CONNECTION_EXPECTED_HEAD,startedAt:new Date().toISOString(),
  passed:false,cases:[],skips:0,providerNetworkRequests:0,realMessages:0,productionUsed:false,liveReadinessProven:false,
  cleanup:{fixtures:0,failures:0},sourceFiles:Object.fromEntries(sources.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
 let totalImports=0,totalFileWrites=0;
 async function run(name,options,work){
  await t.test(name,async()=>{
   const x=await fixture({prisma,fileStore:true,...options});let ok=false;
   try{await work(x);ok=true;}
   finally{
    totalImports+=x.state.imports;totalFileWrites+=x.state.fileWrites;
    try{
     await x.cleanup();
     assert.equal(await prisma.signupAttempt.count({where:{eventKey:x.target.attemptId}}),0);
     assert.equal(await prisma.runtimeStore.count({where:{key:{in:[...x.keys,provisioningStateKey('vapi-import',x.target.idempotencyKey),journalKey('connect',x.target),journalKey('associate',x.target)]}}}),0);
     assert.equal(fs.existsSync(x.directory),false);report.cleanup.fixtures++;
    }catch(error){ok=false;report.cleanup.failures++;throw error;}
    finally{report.cases.push({name,passed:ok});}
   }
  });
 }
 async function assertNoDispatch(x,operation){await assert.rejects(operation);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,0);}
 async function waitForAdvisoryWait(){
  for(let i=0;i<300;i++){const rows=await observer.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`;if(rows[0].n>0)return;await pause(10);}
  throw Error('Expected real SQL lock wait not observed');
 }
 async function underBindingLock(x,work){
  const entered=deferred(),release=deferred();
  const blocker=observer.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'signup-business-bindings:v1'}))::text AS locked`;entered.resolve();await release.promise;},{timeout:15000});
  await entered.promise;
  try{await work(release);}finally{release.resolve();await blocker;}
 }
 async function http(x){
  const app=express();app.use(express.json());registerFixtureHttp(app,x);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const endpoint='http://127.0.0.1:'+server.address().port+'/api/admin/signups/no-send-connection';
  const headers={Origin:'https://fixture.invalid','Content-Type':'application/json','x-myaipa-no-send-connection':'1',Cookie:'fixture_session='+x.token};
  return{post:(body,extra={})=>fetch(endpoint,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)}),
   close:()=>new Promise(resolve=>server.close(resolve))};
 }
 try{
  const version=await prisma.$queryRaw`SHOW server_version`;report.postgresVersion=version[0].server_version;assert.match(report.postgresVersion,/^18\./);
  await run('read-only real SQL preview preserves database and file bytes',{},async x=>{
   const row=await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),before=fs.readFileSync(x.file),count=await prisma.runtimeStore.count({where:{key:{in:x.keys}}});
   const p=await x.preview();assert.equal(p.applyAllowed,false);assert.equal(p.ready,false);assert.equal(x.state.imports,0);
   assert.deepEqual(await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),row);assert.deepEqual(fs.readFileSync(x.file),before);
   assert.equal(await prisma.runtimeStore.count({where:{key:{in:x.keys}}}),count);
  });
  await run('connection persists one real import receipt; no association/readiness/trial write',{},async x=>{
   const row=await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),before=fs.readFileSync(x.file),p=await x.preview();
   const r=await x.service.execute(x.approve(p),x.auth);assert.equal(r.applied,true);assert.equal(r.ready,false);assert.equal(x.state.imports,1);assert.equal(x.state.fileWrites,0);
   const receipt=await prisma.runtimeStore.findUnique({where:{key:provisioningStateKey('vapi-import',x.target.idempotencyKey)}});
   assert.equal(receipt.data.status,'completed');assert.equal(receipt.data.attempts,1);assert.equal(receipt.data.result.assistantId,x.target.assistantId);
   assert.deepEqual(await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),row);assert.deepEqual(fs.readFileSync(x.file),before);
  });
  await run('association stage updates only three SQL/file references and preserves failures and history',{imported:true},async x=>{
   const before=await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),store=x.readStore(),p=await x.preview();
   const r=await x.service.execute(x.approve(p),x.auth);assert.equal(r.ready,false);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,1);
   const after=await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}});
   assert.equal(after.assignedPhone,x.target.number);assert.equal(after.vapiAssistantId,x.target.assistantId);assert.ok(after.vapiPhoneNumberId);
   for(const key of ['assignedPhone','vapiAssistantId','vapiPhoneNumberId','updatedAt']){delete before[key];delete after[key];}assert.deepEqual(after,before);
   assert.equal(x.readStore().original.status,'setup_error');assert.equal(x.readStore().original.agentTestStatus,'failed');assert.deepEqual(x.readStore().other,store.other);
   assert.deepEqual(x.readStore().original.history,store.original.history);
  });
  await run('default refusal and no approved digest cause zero provider/file dispatch',{},async x=>{
   x.state.enabled=false;await assertNoDispatch(x,x.preview());x.state.enabled=true;
   const p=await x.preview(),body=x.approve(p);delete x.state.policy.approvedPlanDigest;await assertNoDispatch(x,x.service.execute(body,x.auth));
  });
  await run('actual HTTP signed-session authentication, origin and policy binding',{},async x=>{
   const h=await http(x);try{
    assert.equal((await h.post({action:'identify'},{Cookie:''})).status,401);
    assert.equal((await h.post({action:'identify'},{Origin:'https://foreign.invalid'})).status,403);
    const preview=await h.post({action:'preview',policyId:x.state.policy.policyId});assert.equal(preview.status,200);const p=await preview.json();
    assert.equal((await h.post({...x.approve(p),target:x.target})).status,400);
    const out=await h.post(x.approve(p));assert.equal(out.status,200);assert.equal((await out.json()).messagesSent,0);assert.equal(x.state.imports,1);
   }finally{await h.close();}
  });
  await run('changed original SQL row invalidates preview before import',{},async x=>{
   const p=await x.preview(),body=x.approve(p);await prisma.signupAttempt.update({where:{eventKey:x.target.attemptId},data:{lastErrorCode:'SYNTHETIC_CHANGED'}});
   await assertNoDispatch(x,x.service.execute(body,x.auth));
  });
  await run('changed signed context refuses without importing',{},async x=>{
   const p=await x.preview(),body=x.approve(p),key=contextStoreKey(x.target.idempotencyKey),row=await prisma.runtimeStore.findUnique({where:{key}});
   row.data.payload.business.name='Tampered invented tenant';await prisma.runtimeStore.update({where:{key},data:{data:row.data}});
   await assertNoDispatch(x,x.service.execute(body,x.auth));
  });
  await run('changed completed assistant receipt refuses association writes',{imported:true},async x=>{
   const p=await x.preview(),body=x.approve(p),key=provisioningStateKey('vapi-assistant',x.target.idempotencyKey),row=await prisma.runtimeStore.findUnique({where:{key}});
   row.data.result.contentFingerprint='a'.repeat(64);await prisma.runtimeStore.update({where:{key},data:{data:row.data}});
   await assertNoDispatch(x,x.service.execute(body,x.auth));
  });
  await run('conflicting provider business metadata refuses actual SQL-backed control',{},async x=>{
   x.state.assistant.metadata={businessId:999};await assertNoDispatch(x,x.preview());
  });
  await run('existing foreign routing mapping is never reassigned',{},async x=>{
   const b=await prisma.business.create({data:{name:'Fictitious foreign tenant',phone:'+19055550124',timezone:'America/Toronto',vapiMappings:{create:{matchType:'assistantId',matchValue:x.target.assistantId}}}});
   try{await assertNoDispatch(x,x.preview());}finally{await prisma.business.delete({where:{id:b.id}});}
  });
  await run('lost provider acknowledgement leaves durable uncertainty across restart even with absent receipt/resource',{},async x=>{
   x.state.lost=true;const p=await x.preview();await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);assert.equal(x.state.imports,1);
   x.state.phones=[];await prisma.runtimeStore.deleteMany({where:{key:provisioningStateKey('vapi-import',x.target.idempotencyKey)}});
   const restarted=x.make(),next=await x.preview(restarted);await assert.rejects(restarted.execute(x.approve(next),x.auth),/INSPECT_FIRST/);assert.equal(x.state.imports,1);
  });
  await run('two independent control instances with prepared plans cannot dispatch twice',{},async x=>{
   const two=createConnectionControl({...x.options,fence:createAssociationFence()}),[a,b]=await Promise.all([x.preview(),x.preview(two)]);
   assert.equal(a.planDigest,b.planDigest);const body=x.approve(a);
   const result=await Promise.allSettled([x.service.execute(body,x.auth),two.execute(body,x.auth)]);
   assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(x.state.imports,1);
  });
  await run('file refusal rolls back SQL references, retains prepared intent and never retries',{imported:true},async x=>{
   const before=await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),bytes=fs.readFileSync(x.file),p=await x.preview();x.state.failFile=true;
   await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);
   assert.deepEqual(await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),before);assert.deepEqual(fs.readFileSync(x.file),bytes);
   assert.equal((await prisma.runtimeStore.findUnique({where:{key:journalKey('associate',x.target)}})).data.phase,'prepared');
   const restarted=x.make(),next=await x.preview(restarted);await assert.rejects(restarted.execute(x.approve(next),x.auth),/INSPECT_FIRST/);
  });
  await run('file changed then SQL failure is uncertain; no reset, rollback replay or retry',{imported:true},async x=>{
   const before=await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),p=await x.preview(),key=journalKey('associate',x.target);
   const root=prisma.$transaction.bind(prisma),wrapped=Object.create(prisma);
   wrapped.$transaction=(work,options)=>root(tx=>work(new Proxy(tx,{get(target,prop){if(prop!=='runtimeStore')return target[prop];
    return new Proxy(tx.runtimeStore,{get(model,method){if(method!=='update')return model[method];return args=>{if(args.where.key===key&&args.data.data.phase==='completed')throw Error('Injected SQL completion failure');return model.update(args);};}});}})),options);
   const control=createConnectionControl({...x.options,prisma:wrapped});const body=x.approve(await x.preview(control));
   await assert.rejects(control.execute(body,x.auth),/INSPECT_FIRST/);
   assert.deepEqual(await prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),before);assert.equal(x.readStore().original.vapiAssistantId,x.target.assistantId);
   assert.equal((await prisma.runtimeStore.findUnique({where:{key}})).data.phase,'prepared');assert.equal(x.state.imports,0);assert.equal(p.ready,false);
  });
  for(const [name,revoke]of [['apply flag',x=>x.state.apply=false],['approval',x=>x.state.policy.approvedPlanDigest='d'.repeat(64)]]){
   await run(name+' revoked during a real SQL lock wait refuses actual dispatch',{},async x=>{
    const p=await x.preview(),body=x.approve(p);
    await underBindingLock(x,async release=>{
     const running=x.service.execute(body,x.auth);const settled=running.catch(e=>e);await waitForAdvisoryWait();revoke(x);release.resolve();
     const result=await settled;assert.ok(result instanceof Error);assert.match(result.code,/INSPECT_FIRST/);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,0);
    });
   });
  }
  await run('actual HTTP signed session expires during SQL lock wait: zero import',{},async x=>{
   const h=await http(x);try{
    const response=await h.post({action:'preview',policyId:x.state.policy.policyId}),p=await response.json(),body=x.approve(p);
    await underBindingLock(x,async release=>{const running=h.post(body);await waitForAdvisoryWait();x.state.now+=300001;release.resolve();const r=await running;assert.notEqual(r.status,200);assert.equal(x.state.imports,0);});
   }finally{await h.close();}
  });
  await run('canonical source mutation waits while approved provider dispatch holds real source locks',{},async x=>{
   const entered=deferred(),release=deferred();x.state.hook=async({method})=>{if(method==='POST'){entered.resolve();await release.promise;}};
   const body=x.approve(await x.preview()),running=x.service.execute(body,x.auth),settled=running.catch(e=>e);await entered.promise;
   let done=false;const update=observer.signupAttempt.update({where:{eventKey:x.target.attemptId},data:{lastErrorCode:'SYNTHETIC_AFTER_LOCK'}}).then(()=>done=true);
   try{await pause(100);assert.equal(done,false);}finally{release.resolve();}
   const result=await settled;assert.equal(result.applied,true);await update;assert.equal(x.state.imports,1);
  });
  for(const kind of ['context','vapi-assistant'])await run(kind+' mutation waits across real provider dispatch',{},async x=>{
   const entered=deferred(),release=deferred();x.state.hook=async({method})=>{if(method==='POST'){entered.resolve();await release.promise;}};
   const body=x.approve(await x.preview()),running=x.service.execute(body,x.auth),settled=running.catch(e=>e);await entered.promise;
   const key=kind==='context'?contextStoreKey(x.target.idempotencyKey):provisioningStateKey(kind,x.target.idempotencyKey),row=await observer.runtimeStore.findUnique({where:{key}});
   let done=false;const update=observer.runtimeStore.update({where:{key},data:{data:{...row.data,syntheticMutation:'after-lock'}}}).then(()=>done=true);
   try{await pause(100);assert.equal(done,false);}finally{release.resolve();}
   assert.equal((await settled).applied,true);await update;
  });
  await run('cleanup-first shared lifecycle reservation refuses before provider mutation',{},async x=>{
   const p=await x.preview(),id=hashOperationalTarget({signupAttemptId:x.target.attemptId});
   await x.options.fence.withRemovalGuard(x.readStore,[id],()=>assertNoDispatch(x,x.service.execute(x.approve(p),x.auth)));
  });
  await run('normal eligibility absence refuses instead of starting or extending a trial',{},async x=>{
   const store=x.readStore();delete store.original.trialStartAt;delete store.original.trialEndAt;x.writeFixture(store);
   const p=await x.preview();await assertNoDispatch(x,x.service.execute(x.approve(p),x.auth));
  });
  await run('wrong imported assistant never yields completed receipt or record references',{},async x=>{
   x.state.wrong=true;const p=await x.preview();await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);
   const receipt=await prisma.runtimeStore.findUnique({where:{key:provisioningStateKey('vapi-import',x.target.idempotencyKey)}});
   assert.equal(receipt.data.status,'failed');assert.equal(x.state.fileWrites,0);assert.equal(x.readStore().original.vapiAssistantId,undefined);
  });
  report.passed=report.cases.length===23&&report.cases.every(c=>c.passed)&&report.cleanup.failures===0;
  assert.equal(report.passed,true,'Every required SQL case must pass; no omitted cases');
 }finally{
  report.completedAt=new Date().toISOString();report.syntheticImports=totalImports;report.syntheticFileWriteAttempts=totalFileWrites;
  report.limitations=['Synthetic providers only; no live transport/eligibility/delivery proof','Shared single-process lifecycle and cooperating SQL writers required; not arbitrary direct-SQL protection',
   'PostgreSQL and JSON file are not one atomic medium; prepared intent blocks replay after uncertainty','No tenant mapping creation, trial activation or readiness promotion'];
  if(process.env.CONNECTION_ARTIFACT){const file=path.resolve(process.env.CONNECTION_ARTIFACT),root=path.resolve('diagnostics/no-send-connection');assert.ok(file.startsWith(root+path.sep));fs.mkdirSync(root,{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');}
  await Promise.all([prisma.$disconnect(),observer.$disconnect()]);
 }
});
