const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const express=require('express');
const {createRequire}=require('node:module');
const {fixture}=require('./helpers/number-fallback-fixture');
const {prepareNumberFallbackRecovery}=require('../server/signupNumberFallbackRecovery');
const {contextStoreKey}=require('../server/signupProvisioningContext');
test('real recovery route enforces admin/origin/confirmation/hash and dry run remains no-send',async()=>{
 const f=await fixture(),app=express();app.use(express.json());
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8');
 const start=source.lastIndexOf('app.post(',source.indexOf("'/api/admin/signups/prepare-number-fallback-recovery'"));
 const end=source.indexOf('\napp.get(',start);
 const context={app,require:createRequire(require.resolve('../server/index')),prisma:f.prisma,contextStoreKey,
  adminSignupRepairProcessRateLimiter:(req,res,next)=>next(),requireAdmin:(req,res,next)=>req.headers['x-test-admin']==='1'?next():res.sendStatus(401),
  asyncRoute:handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next),
  isAllowedOrigin:o=>o==='https://www.myaipa.ca',listSignupDashboardRecords:()=>[f.record],
  signupRecoveryError:(m,code)=>Object.assign(Error(m),{code,statusCode:409}),prepareNumberFallbackRecovery,
  getAdminActorHash:()=>f.options.actorHash,getProvisioningSigningSecret:()=>f.options.signingSecret,
  process:{env:{SIGNUP_REGIONAL_AREA_FALLBACK_ENABLED:'true'}},fetchTwilioIncomingPhoneNumbers:async()=>[],fetchVapiCollection:async()=>[]};
 vm.runInNewContext(source.slice(start,end),context);
 app.use((err,req,res,next)=>res.status(err.statusCode||500).json({code:err.code||'test_error'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const headers={'content-type':'application/json',origin:'https://www.myaipa.ca','x-myaipa-number-recovery':'1','x-test-admin':'1'};
 const body={signupAttemptId:f.record.signupAttemptId,apply:false,confirmation:'PREPARE_NUMBER_FALLBACK_RECOVERY'};
 const call=(data=body,extra={})=>fetch('http://127.0.0.1:'+server.address().port+'/api/admin/signups/prepare-number-fallback-recovery',
  {method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
 try{
  assert.equal((await call(body,{'x-test-admin':'0'})).status,401);
  for(const extra of [{origin:'https://evil.example'},{'x-myaipa-number-recovery':''},{'content-type':'text/plain'}])assert.equal((await call(body,extra)).status,403);
  for(const data of [{...body,confirmation:'yes'},{...body,apply:true},{...body,signupAttemptId:'wrong'}])assert.equal((await call(data)).status,400);
  const dry=await call(),r=await dry.json();assert.equal(dry.status,200);assert.equal(dry.headers.get('cache-control'),'no-store');assert.equal(r.applied,false);assert.equal(r.expectedContextHash,f.hash);
  const apply=await call({...body,apply:true,expectedContextHash:r.expectedContextHash});assert.equal(apply.status,200);assert.equal((await apply.json()).applied,true);
  assert.equal((await call({...body,apply:true,expectedContextHash:r.expectedContextHash})).status,409);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
