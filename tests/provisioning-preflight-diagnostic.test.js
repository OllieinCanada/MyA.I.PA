'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const diagnostic=require('../server/provisioningPreflightDiagnostic');
const {fixture:routeFixture}=require('./helpers/provisioning-error-route-fixture');
const NOW=1800000000000,SECRET='synthetic-signing-secret',ID='mdiag_'+'a'.repeat(32);
let networkAttempts=0;const restore=[];
test.before(()=>{const block=(o,k)=>{const previous=o[k];o[k]=()=>{networkAttempts++;throw Error('NO_NETWORK_IN_SYNTHETIC_TEST');};restore.push(()=>{o[k]=previous;});};block(globalThis,'fetch');for(const name of ['node:http','node:https']){block(require(name),'request');block(require(name),'get');}block(require('node:net').Socket.prototype,'connect');block(require('node:tls'),'connect');});
test.after(()=>{for(const fn of restore.reverse())fn();assert.equal(networkAttempts,0);});
function database({fault='',row=null,lock=true,readOnly='on'}={}){
 const calls={transactions:0,recordWrites:0,queries:[],reads:0};
 const fail=code=>{throw Object.assign(Error('Synthetic failure with private credential fixture-secret and fixture@example.invalid'),{code,meta:{code:'57014'}});};
 const tx={
  $executeRaw:async(strings,...values)=>{assert.equal(strings.join(''),'SET TRANSACTION READ ONLY');assert.equal(values.length,0);calls.queries.push('read-only');if(fault==='mode')fail('P2010');},
  $queryRaw:async(strings,...values)=>{const sql=strings.join('?');calls.queries.push(sql);
   if(sql.includes('transaction_read_only'))return[{read_only:readOnly}];
   assert.match(sql,/pg_try_advisory_xact_lock\(\?::bigint\)/);assert.equal(typeof values[0],'bigint');if(fault==='lock')fail('P2028');return[{acquired:lock}];},
  runtimeStore:{findUnique:async args=>{calls.reads++;assert.deepEqual(args.select,{key:true});assert.match(args.where.key,/^signup-provisioning-context:[a-f0-9]{64}$/);if(fault==='read')fail('P1001');return row;},
   create(){calls.recordWrites++;throw Error('WRITE_FORBIDDEN');},update(){calls.recordWrites++;throw Error('WRITE_FORBIDDEN');},upsert(){calls.recordWrites++;throw Error('WRITE_FORBIDDEN');},delete(){calls.recordWrites++;throw Error('WRITE_FORBIDDEN');}}
 };
 return {calls,prisma:{$transaction:async(fn,options)=>{calls.transactions++;assert.deepEqual(options,{isolationLevel:'RepeatableRead',maxWait:1000,timeout:3000});if(fault==='admission')fail('P2024');const result=await fn(tx);if(fault==='finish')fail('P2028');return result;}}};
}
function fixture(options={}){
 const app=routeFixture(),db=database(options),proof=diagnostic.buildSyntheticRequest({diagnosticId:ID,issuedAt:NOW,signingSecret:SECRET});
 const req={method:'POST',query:proof.query,body:{},headers:{'x-myaipa-integration-key':'synthetic-connection-key','x-provisioning-token':proof.authorizationToken}};
 const dependencies={connectionConfigured:()=>!!(app.ctx.INTEGRATION_API_KEY||app.ctx.getMakeSignupWebhookConfig().apiKey||app.ctx.getMakeSignupWebhookToken()),connectionValid:app.ctx.hasValidProvisioningConnectionKey,getSigningSecret:app.ctx.getProvisioningSigningSecret,parseAuthorization:app.ctx.getProvisioningAuthorizationInput,prisma:db.prisma,getRelease:()=> 'a'.repeat(40),clock:()=>NOW,monotonic:(()=>{let tick=0;return()=>++tick;})()};
 const invoke=async()=>{let status,result;const headers={};await diagnostic.createHandler(dependencies)(req,{set:(k,v)=>{headers[k]=v;},status:value=>{status=value;return{json:body=>{result=body;}};}});return{status,result,headers};};
 return {app,db,req,dependencies,invoke};
}
function assertSafe(f,r){assert.equal(r.result.providerCallsAllowed,false);assert.equal(r.result.productionRecordWritesAllowed,false);assert.equal(r.result.signupReplayAllowed,false);assert.equal(r.result.retryAllowed,false);assert.equal(r.result.historicalFailureProven,false);assert.equal(r.result.customerContextVerified,false);assert.equal(f.db.calls.recordWrites,0);assert.equal(f.app.counts.purchases,0);assert.equal(f.app.captures.length,0);assert.doesNotMatch(JSON.stringify(r.result),/synthetic-signing-secret|synthetic-connection-key|fixture-secret|example\.invalid|authorizationToken/);}
test('actual shared auth decisions admit only synthetic signed query/header proof to read-only SQL',async()=>{
 const f=fixture(),r=await f.invoke();assert.equal(r.status,200);assert.equal(r.result.code,'DIAGNOSTIC_READ_ONLY_COMPLETE');assert.equal(r.result.readOnlyConfirmed,true);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(f.db.calls.transactions,1);assert.equal(f.db.calls.queries[0],'read-only');assert.equal(f.db.calls.reads,1);assertSafe(f,r);
});
for(const mode of ['missing-key','wrong-key','missing-token','wrong-token','missing-key-config','missing-signing-config']){
 test(mode+' refuses without DB, auth journal writes, purchase or notifications',async()=>{
  const f=fixture();if(mode==='missing-key')delete f.req.headers['x-myaipa-integration-key'];if(mode==='wrong-key')f.req.headers['x-myaipa-integration-key']='untrusted';if(mode==='missing-token')delete f.req.headers['x-provisioning-token'];if(mode==='wrong-token')f.req.headers['x-provisioning-token']='f'.repeat(64);if(mode==='missing-key-config')f.app.ctx.INTEGRATION_API_KEY='';if(mode==='missing-signing-config')f.app.ctx.process.env={};
  if(mode==='missing-key-config')f.app.ctx.getMakeSignupWebhookConfig=()=>({apiKey:''});
  const r=await f.invoke();assert.equal(r.status,mode.startsWith('missing-')&&mode.endsWith('-config')?503:401);assert.equal(f.db.calls.transactions,0);assertSafe(f,r);
 });
}
for(const mode of ['stale','future','missing-id','malformed-time','extra-apply','changed-area','customer-body','changed-id']){
 test('independent clock and fixed synthetic scope reject '+mode,async()=>{
  const f=fixture();if(mode==='stale')f.dependencies.clock=()=>NOW+diagnostic.MAX_AGE_MS+1;if(mode==='future')f.dependencies.clock=()=>NOW-5001;if(mode==='missing-id')delete f.req.query.diagnosticId;if(mode==='malformed-time')f.req.query.issuedAt='not-a-time';if(mode==='extra-apply')f.req.query.apply='true';if(mode==='changed-area')f.req.query.areaCode='905';if(mode==='customer-body')f.req.body={signupAttemptId:'signup_'+'b'.repeat(32)};if(mode==='changed-id')f.req.query.diagnosticId='mdiag_'+'b'.repeat(32);
  const r=await f.invoke();assert.notEqual(r.status,200);assert.equal(f.db.calls.transactions,0);assertSafe(f,r);
 });
}
test('a valid signed customer proof cannot select or read a production signup context',async()=>{
 const f=fixture(),p=f.app.payload.provisioning;f.req.query.idempotencyKey=p.idempotencyKey;f.req.query.contextHash=p.contextHash;f.req.headers['x-provisioning-token']=p.authorizationToken;
 const r=await f.invoke();assert.equal(r.status,409);assert.equal(r.result.code,'DIAGNOSTIC_SCOPE_MISMATCH');assert.equal(f.db.calls.transactions,0);assertSafe(f,r);
});
for(const [fault,code,stage]of [['admission','P2024','database-admission'],['mode','P2010','database-read-only'],['lock','P2028','synthetic-context-lock'],['read','P1001','synthetic-context-read'],['finish','P2028','database-finish']]){
 test('preserves exact allowlisted '+code+' and '+stage+' without retry or private error text',async()=>{
  const f=fixture({fault}),r=await f.invoke();assert.equal(r.status,503);assert.equal(r.result.databaseCode,code);assert.equal(r.result.failedCheckpoint,stage);assert.equal(r.result.sqlState,'57014');assert.equal(f.db.calls.transactions,1);assertSafe(f,r);
 });
}
test('unconfirmed read-only mode fails before locks or reads',async()=>{const f=fixture({readOnly:'off'}),r=await f.invoke();assert.equal(r.result.code,'DIAGNOSTIC_READ_ONLY_UNCONFIRMED');assert.equal(f.db.calls.queries.length,2);assert.equal(f.db.calls.reads,0);assertSafe(f,r);});
test('nonblocking synthetic lock contention refuses without waiting or context reads',async()=>{const f=fixture({lock:false}),r=await f.invoke();assert.equal(r.status,409);assert.equal(r.result.code,'DIAGNOSTIC_SYNTHETIC_LOCK_BUSY');assert.equal(f.db.calls.reads,0);assertSafe(f,r);});
test('unexpected synthetic-key row is refused without returning its identity or payload',async()=>{const f=fixture({row:{key:'private-row-key',data:{secret:'private-row-body'}}}),r=await f.invoke();assert.equal(r.status,409);assert.equal(r.result.code,'DIAGNOSTIC_SYNTHETIC_KEY_CONFLICT');assert.doesNotMatch(JSON.stringify(r),/private-row/);assertSafe(f,r);});
test('the actual application registration reuses guards and has no purchase callbacks or auth-capture middleware',()=>{
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8'),a=source.indexOf("require('./provisioningPreflightDiagnostic').registerRoutes({"),b=source.indexOf('\n});',a);
 assert.ok(a>0&&b>a);const wiring=source.slice(a,b+4);assert.match(wiring,/connectionValid:hasValidProvisioningConnectionKey/);assert.match(wiring,/getSigningSecret:getProvisioningSigningSecret/);assert.match(wiring,/parseAuthorization:getProvisioningAuthorizationInput/);assert.doesNotMatch(wiring,/requireProvisioningKey|purchaseTwilio|runProvisioningStep|send|captureProvisioning|loadTrusted/);
 const module=fs.readFileSync(require.resolve('../server/provisioningPreflightDiagnostic'),'utf8');
 const withoutHashUpdate=module.replaceAll("crypto.createHash('sha256').update(value)",'APPROVED_SHA256_PRIMITIVE');
 assert.notEqual(module,withoutHashUpdate,'Exclude only the exact SHA-256 update primitive, not database update calls');
 assert.doesNotMatch(withoutHashUpdate,/\.upsert\(|\.create\(|\.update\(|\.delete\(|fetch\(|https\.request|require\(['"]\.\/index/);
});
test('route registration accepts POST only and installs a small process request ceiling',()=>{
 const f=fixture(),registrations=[];let rate;
 diagnostic.registerRoutes({app:{post:(...args)=>registrations.push(args)},rateLimit:options=>{rate=options;return'fake-limiter';},...f.dependencies});
 assert.equal(registrations.length,1);assert.equal(registrations[0][0],diagnostic.ROUTE);assert.equal(registrations[0][1],'fake-limiter');assert.equal(rate.limit,10);assert.equal(rate.windowMs,60000);assert.equal(rate.message.retryAllowed,false);
});
test('actual handler response is bound to independent release and complete ordered checkpoint proof',async()=>{
 const {consumeResponse}=require('../scripts/prepare-provider-disabled-make-diagnostic'),f=fixture(),r=await f.invoke();
 const input={httpStatus:200,text:JSON.stringify(r.result),diagnosticId:ID,expectedRelease:'a'.repeat(40),connectionKey:'synthetic-connection-key',authorizationToken:f.req.headers['x-provisioning-token']};
 assert.equal(consumeResponse(input).passed,true);
 for(const mutate of [v=>v.checkpoints.pop(),v=>v.checkpoints.reverse(),v=>v.checkpoints.splice(2,1),v=>{v.readOnlyConfirmed=false;},v=>{v.checkpoints[2].elapsedMs=-1;},v=>{v.elapsedMs=0;}]){
  const value=structuredClone(r.result);mutate(value);assert.throws(()=>consumeResponse({...input,text:JSON.stringify(value)}));
 }
 assert.equal(consumeResponse({...input,expectedRelease:'b'.repeat(40)}).serverDiagnosticVerified,false);
 assert.throws(()=>consumeResponse({...input,expectedRelease:undefined}));assert.throws(()=>consumeResponse({...input,connectionKey:undefined}));
});
