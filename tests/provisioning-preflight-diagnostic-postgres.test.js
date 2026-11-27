'use strict';
// CI service only. No application startup, real signup data or provider SDKs.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {readOnlyDatabaseCheck,scope,VERSION,ROUTE,registerRoutes,buildSyntheticRequest}=require('../server/provisioningPreflightDiagnostic');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const {fixture:authFixture}=require('./helpers/provisioning-error-route-fixture');
const {consumeResponse}=require('../scripts/prepare-provider-disabled-make-diagnostic');
const {writeManifest}=require('../scripts/provider-hardening-evidence');
const {sourceHashes,REQUIRED_CASES}=require('../scripts/verify-provider-disabled-diagnostic-evidence');
const enabled=process.env.RUN_PREFLIGHT_DIAGNOSTIC_POSTGRES==='1';
if(process.env.DIAGNOSTIC_EXPECTED_HEAD&&!enabled)throw Error('Required SQL proof cannot be skipped');
test('provider-disabled diagnostic: real PostgreSQL 18 and isolated HTTP',{skip:!enabled,timeout:60000},async t=>{
 const report={scope:'provider-disabled-diagnostic-disposable-sql-only',head:process.env.DIAGNOSTIC_EXPECTED_HEAD,passed:false,skips:0,cases:[],sourceFiles:sourceHashes(),productionUsed:false,providerRequests:0,forbiddenTransportAttempts:0,messages:0,originalHistoricalCauseProven:false,makeEngineVerified:false,osSandboxProven:false,cleanup:{complete:false,connectionsClosed:false,httpServerClosed:false,ownedRowsRemaining:null}};
 let prisma,observer,server,ownedOrigin;const keys=new Set(),nativeFetch=globalThis.fetch;
 const id=()=> 'mdiag_'+crypto.randomBytes(16).toString('hex');
 const args=diagnosticId=>({prisma,diagnosticId,idempotencyKey:scope(diagnosticId,0).idempotencyKey});
 const deferred=()=>{let resolve;return{promise:new Promise(r=>{resolve=r;}),resolve};};
 async function run(name,work){await t.test(name,async()=>{let passed=false;try{await work();passed=true;}finally{report.cases.push({name,passed});}});}
 try{
  const url=new URL(process.env.DATABASE_URL);
  assert.ok(process.env.GITHUB_ACTIONS==='true'&&url.hostname==='127.0.0.1'&&url.pathname==='/ci','Only the disposable CI service is allowed');
  assert.match(report.head,/^[a-f0-9]{40}$/);url.searchParams.set('connection_limit','1');
  const {PrismaClient}=require('@prisma/client'),options={datasources:{db:{url:url.href}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})},log:[]};
  prisma=new PrismaClient(options);observer=new PrismaClient(options);
  const version=await prisma.$queryRaw`SHOW server_version`;report.postgresVersion=version[0].server_version;assert.match(report.postgresVersion,/^18\./);
  globalThis.fetch=async(input,options)=>{const target=new URL(String(input));if(target.origin!==ownedOrigin||target.pathname!==ROUTE||options?.method!=='POST'){report.forbiddenTransportAttempts++;throw Error('NON_OWNED_HTTP_TARGET_REFUSED');}return nativeFetch(input,options);};
  const sentinel='synthetic-preflight-sentinel:'+crypto.randomUUID();keys.add(sentinel);await prisma.runtimeStore.create({data:{key:sentinel,data:{invented:true}}});
  const sentinelBefore=await prisma.runtimeStore.findUnique({where:{key:sentinel}}),countBefore=await prisma.runtimeStore.count();
  await run(REQUIRED_CASES[0],async()=>{assert.deepEqual(await readOnlyDatabaseCheck(args(id())),{readOnlyConfirmed:true,syntheticLockAcquired:true,syntheticContextAbsent:true});assert.deepEqual(await prisma.runtimeStore.findUnique({where:{key:sentinel}}),sentinelBefore);assert.equal(await prisma.runtimeStore.count(),countBefore);});
  await run(REQUIRED_CASES[1],async()=>{
   const key='synthetic-forbidden-write:'+crypto.randomUUID();keys.add(key);
   const wrapped={...prisma,$transaction:(fn,options)=>prisma.$transaction(async tx=>{await fn(tx);return tx.runtimeStore.create({data:{key,data:{invented:true}}});},options)};
   await assert.rejects(readOnlyDatabaseCheck({...args(id()),prisma:wrapped}),e=>/read.only/i.test(e.message));assert.equal(await prisma.runtimeStore.count({where:{key}}),0);
  });
  await run(REQUIRED_CASES[2],async()=>{const a=args(id()),key=contextStoreKey(a.idempotencyKey);keys.add(key);await prisma.runtimeStore.create({data:{key,data:{invented:true}}});const before=await prisma.runtimeStore.findUnique({where:{key}});await assert.rejects(readOnlyDatabaseCheck(a),e=>e.diagnosticCode==='DIAGNOSTIC_SYNTHETIC_KEY_CONFLICT');assert.deepEqual(await prisma.runtimeStore.findUnique({where:{key}}),before);});
  await run(REQUIRED_CASES[3],async()=>{
   const a=args(id()),entered=deferred(),release=deferred(),key=BigInt.asIntN(64,BigInt('0x'+crypto.createHash('sha256').update(VERSION+'\0lock\0'+a.diagnosticId).digest('hex').slice(0,16)));
   const hold=observer.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;const r=await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${key}::bigint) AS acquired`;assert.equal(r[0].acquired,true);entered.resolve();await release.promise;},{timeout:15000});
   const outcome=hold.then(()=>({}),error=>({error}));
   try{const admitted=await Promise.race([entered.promise.then(()=>true),outcome.then(()=>false)]);if(!admitted)throw(await outcome).error||Error('Blocker not admitted');await assert.rejects(readOnlyDatabaseCheck(a),e=>e.diagnosticCode==='DIAGNOSTIC_SYNTHETIC_LOCK_BUSY');}
   finally{release.resolve();const end=await outcome;if(end.error)throw end.error;}
   assert.equal((await readOnlyDatabaseCheck(a)).syntheticLockAcquired,true);
  });
  await run(REQUIRED_CASES[4],async()=>{
   const wrapped={...prisma,$transaction:(fn,options)=>prisma.$transaction(async tx=>{const result=await fn(tx);await tx.$queryRaw`SELECT pg_sleep(3.3)::text AS waited`;return result;},options)};
   const a=args(id()),stages=[];await assert.rejects(readOnlyDatabaseCheck({...a,prisma:wrapped,checkpoint:s=>stages.push(s)}),e=>e.code==='P2028');assert.equal(stages.at(-1),'database-finish');assert.equal(await prisma.runtimeStore.count({where:{key:contextStoreKey(a.idempotencyKey)}}),0);
  });
  const f=authFixture(),express=require('express'),rateLimit=require('express-rate-limit').rateLimit,app=express();app.use(express.json());let admissions=0;
  const counted={$transaction:(...a)=>{admissions++;return prisma.$transaction(...a);}};
  registerRoutes({app,rateLimit,prisma:counted,connectionConfigured:()=>true,connectionValid:f.ctx.hasValidProvisioningConnectionKey,getSigningSecret:f.ctx.getProvisioningSigningSecret,parseAuthorization:f.ctx.getProvisioningAuthorizationInput,getRelease:()=>report.head});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});ownedOrigin='http://127.0.0.1:'+server.address().port;
  await run(REQUIRED_CASES[5],async()=>{const r=await fetch(ownedOrigin+ROUTE,{method:'POST',body:new FormData()});assert.equal(r.status,401);assert.equal((await r.json()).code,'PROVISIONING_AUTH_INVALID');assert.equal(admissions,0);});
  for(const [i,variant]of ['empty-multipart','marker-multipart'].entries())await run(REQUIRED_CASES[6+i],async()=>{
   const diagnosticId=id(),request=buildSyntheticRequest({diagnosticId,issuedAt:Date.now(),signingSecret:'synthetic-signing-secret'}),form=new FormData();if(variant==='marker-multipart')form.set('_diagnostic_fixture','synthetic-only');
   const before=await prisma.runtimeStore.count(),r=await fetch(ownedOrigin+ROUTE+'?'+new URLSearchParams(request.query),{method:'POST',headers:{'x-myaipa-integration-key':'synthetic-connection-key','x-provisioning-token':request.authorizationToken},body:form});
   const out=consumeResponse({httpStatus:r.status,text:await r.text(),diagnosticId,expectedRelease:report.head,authorizationToken:request.authorizationToken,connectionKey:'synthetic-connection-key'});assert.equal(out.passed,true);assert.equal(await prisma.runtimeStore.count(),before);
  });
  report.passed=report.cases.length===REQUIRED_CASES.length&&report.cases.every(c=>c.passed)&&report.forbiddenTransportAttempts===0;
  assert.equal(report.passed,true);
 }finally{
  globalThis.fetch=nativeFetch;
  const cleanupErrors=[];
  try{if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));report.cleanup.httpServerClosed=true;}catch(e){cleanupErrors.push(e);}
  try{if(prisma){await prisma.runtimeStore.deleteMany({where:{key:{in:[...keys]}}});report.cleanup.ownedRowsRemaining=await prisma.runtimeStore.count({where:{key:{in:[...keys]}}});}else report.cleanup.ownedRowsRemaining=0;}catch(e){cleanupErrors.push(e);}
  const closed=await Promise.allSettled([prisma?.$disconnect(),observer?.$disconnect()]);report.cleanup.connectionsClosed=closed.every(r=>r.status==='fulfilled');
  report.cleanup.complete=!cleanupErrors.length&&report.cleanup.connectionsClosed&&report.cleanup.ownedRowsRemaining===0&&report.cleanup.httpServerClosed;
  report.passed=report.passed&&report.cleanup.complete;writeManifest('diagnostics/provider-disabled-diagnostic/result.json',report);
  if(cleanupErrors.length||!report.cleanup.connectionsClosed)throw Error('Owned fixture cleanup or disconnect was not confirmed; failure artifact preserved');
 }
});
