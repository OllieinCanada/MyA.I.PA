'use strict';
// A separate, read-only diagnostic. No signup loader, claim, provider transport,
// sender, record writer, recovery callback or apply mode is imported or accepted.
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {verifyProvisioningContextToken,buildProvisioningAuthorizationToken}=require('./signupProvisioning');
const {contextStoreKey}=require('./signupProvisioningContext');
const ROUTE='/api/integrations/diagnostics/provisioning-preflight';
const VERSION='provider-disabled-provisioning-diagnostic-v1';
const MAX_AGE_MS=120000;
const PREFERENCES=Object.freeze({areaCode:'289',region:'ON',voiceMethod:'POST',voiceUrl:'https://example.invalid/provider-disabled'});
const QUERY_KEYS=['diagnosticId','issuedAt','idempotencyKey','contextHash',...Object.keys(PREFERENCES)];
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const validId=value=>typeof value==='string'&&/^mdiag_[a-f0-9]{32}$/.test(value);
function scope(diagnosticId,issuedAt){
 if(!validId(diagnosticId)||!Number.isSafeInteger(issuedAt)||issuedAt<0)throw Error('DIAGNOSTIC_SCOPE_INVALID');
 const idempotencyKey=hash(VERSION+'\0identity\0'+diagnosticId);
 const contextHash=hash(VERSION+'\0context\0'+diagnosticId+'\0'+issuedAt+'\0'+JSON.stringify(PREFERENCES));
 return {idempotencyKey,contextHash};
}
function buildSyntheticRequest({diagnosticId,issuedAt,signingSecret}){
 const proof=scope(diagnosticId,issuedAt);
 return {query:{diagnosticId,issuedAt:String(issuedAt),...proof,...PREFERENCES},
  authorizationToken:buildProvisioningAuthorizationToken(proof.contextHash,proof.idempotencyKey,String(signingSecret||'').trim())};
}
function fail(code,status=503){throw Object.assign(Error(code),{diagnosticCode:code,statusCode:status});}
async function readOnlyDatabaseCheck({prisma,diagnosticId,idempotencyKey,checkpoint=()=>{}}){
 if(!validId(diagnosticId)||scope(diagnosticId,0).idempotencyKey!==idempotencyKey)fail('DIAGNOSTIC_SCOPE_INVALID',400);
 // Independent 64-bit key, nonblocking, scoped to this transaction. Never wait
 // for or inspect a real signup's advisory lock or read a customer payload.
 const unsigned=BigInt('0x'+hash(VERSION+'\0lock\0'+diagnosticId).slice(0,16));
 const lockKey=BigInt.asIntN(64,unsigned);
 return prisma.$transaction(async tx=>{
  checkpoint('database-read-only');
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const mode=await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS read_only`;
  if(mode?.[0]?.read_only!=='on')fail('DIAGNOSTIC_READ_ONLY_UNCONFIRMED');
  checkpoint('synthetic-context-lock');
  const locked=await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS acquired`;
  if(locked?.[0]?.acquired!==true)fail('DIAGNOSTIC_SYNTHETIC_LOCK_BUSY',409);
  checkpoint('synthetic-context-read');
  const row=await tx.runtimeStore.findUnique({where:{key:contextStoreKey(idempotencyKey)},select:{key:true}});
  if(row)fail('DIAGNOSTIC_SYNTHETIC_KEY_CONFLICT',409);
  checkpoint('database-finish');
  return {readOnlyConfirmed:true,syntheticLockAcquired:true,syntheticContextAbsent:true};
 },{isolationLevel:'RepeatableRead',maxWait:1000,timeout:3000});
}
const DB_CODES=new Set(['P1001','P1002','P1008','P1017','P2024','P2028','P2010']);
const SQL_CODES=new Set(['55P03','57014','25006','40001','40P01']);
const OWN_CODES=new Set(['DIAGNOSTIC_SCOPE_INVALID','DIAGNOSTIC_READ_ONLY_UNCONFIRMED','DIAGNOSTIC_SYNTHETIC_LOCK_BUSY','DIAGNOSTIC_SYNTHETIC_KEY_CONFLICT']);
function createHandler({connectionConfigured,connectionValid,getSigningSecret,parseAuthorization,prisma,getRelease=()=>null,clock=()=>Date.now(),monotonic=()=>performance.now()}){
 for(const fn of [connectionConfigured,connectionValid,getSigningSecret,parseAuthorization,getRelease,clock,monotonic])if(typeof fn!=='function')throw Error('DIAGNOSTIC_DEPENDENCIES_INVALID');
 if(typeof prisma?.$transaction!=='function')throw Error('DIAGNOSTIC_DATABASE_REQUIRED');
 return async function diagnostic(req,res){
  res.set('Cache-Control','no-store');
  const began=monotonic(),checkpoints=[];let current='connection-auth';
  const mark=stage=>{current=stage;checkpoints.push({stage,elapsedMs:Math.max(0,Math.round(monotonic()-began))});};
  const finish=(status,code,extra={})=>res.status(status).json({version:1,diagnostic:true,
   diagnosticId:validId(req.query?.diagnosticId)?req.query.diagnosticId:null,release:/^[a-f0-9]{40}$/.test(getRelease()||'')?getRelease():null,ok:status===200,code,httpStatus:status,
   failedCheckpoint:status===200?null:current,checkpoints,elapsedMs:Math.max(0,Math.round(monotonic()-began)),
   providerCallsAllowed:false,productionRecordWritesAllowed:false,signupReplayAllowed:false,retryAllowed:false,
   historicalFailureProven:false,customerContextVerified:false,...extra});
  try{
   mark('connection-auth');
   if(!connectionConfigured())return finish(503,'PROVISIONING_AUTH_NOT_CONFIGURED');
   if(!connectionValid(req))return finish(401,'PROVISIONING_AUTH_INVALID');
   mark('signature-auth');
   const secret=String(getSigningSecret()||'').trim();
   if(!secret)return finish(503,'PROVISIONING_SIGNING_NOT_CONFIGURED');
   const input=parseAuthorization(req);
   if(!verifyProvisioningContextToken(input.contextHash,input.idempotencyKey,input.authorizationToken,secret))return finish(401,'PROVISIONING_AUTHORIZATION_INVALID');
   mark('synthetic-scope');
   const q=req.query||{},body=req.body;
   if(Object.keys(q).some(k=>!QUERY_KEYS.includes(k))||body&&Object.keys(body).length
    ||!validId(q.diagnosticId)||typeof q.issuedAt!=='string'||!/^\d{13}$/.test(q.issuedAt)
    ||Object.entries(PREFERENCES).some(([k,v])=>q[k]!==v))return finish(400,'DIAGNOSTIC_SCOPE_INVALID');
   const issuedAt=Number(q.issuedAt),age=clock()-issuedAt;
   if(!Number.isSafeInteger(issuedAt)||age< -5000||age>MAX_AGE_MS)return finish(410,'DIAGNOSTIC_PROOF_EXPIRED');
   const expected=scope(q.diagnosticId,issuedAt);
   if(input.contextHash!==expected.contextHash||input.idempotencyKey!==expected.idempotencyKey)return finish(409,'DIAGNOSTIC_SCOPE_MISMATCH');
   mark('database-admission');
   const result=await readOnlyDatabaseCheck({prisma,diagnosticId:q.diagnosticId,idempotencyKey:expected.idempotencyKey,checkpoint:mark});
   mark('complete');return finish(200,'DIAGNOSTIC_READ_ONLY_COMPLETE',result);
  }catch(error){
   const own=OWN_CODES.has(error?.diagnosticCode)?error.diagnosticCode:null;
   return finish(own?error.statusCode:503,own||'DIAGNOSTIC_DATABASE_OR_RUNTIME_FAILED',{
    databaseCode:DB_CODES.has(error?.code)?error.code:null,sqlState:SQL_CODES.has(error?.meta?.code)?error.meta.code:null});
  }
 };
}
function registerRoutes({app,rateLimit,...dependencies}){
 const limiter=rateLimit({windowMs:60000,limit:10,standardHeaders:true,legacyHeaders:false,
  message:{diagnostic:true,ok:false,code:'DIAGNOSTIC_RATE_LIMITED',providerCallsAllowed:false,productionRecordWritesAllowed:false,signupReplayAllowed:false,retryAllowed:false}});
 app.post(ROUTE,limiter,createHandler(dependencies));
}
module.exports={ROUTE,VERSION,MAX_AGE_MS,PREFERENCES,scope,buildSyntheticRequest,readOnlyDatabaseCheck,createHandler,registerRoutes};
