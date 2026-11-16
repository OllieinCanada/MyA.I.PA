'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {registerLiveDiagnosticRoutes}=require('../server/signupLiveDiagnosticRoutes');
const attempt='signup_'+'a'.repeat(32);
let server,base,reads=0,failCode='';
const nativeFetch=global.fetch;
before(async()=>{
  const app=express();app.use(express.json());
  registerLiveDiagnosticRoutes({app,requireAdmin:(req,res,next)=>req.headers['x-fixture-session']==='signed-in'?next():res.sendStatus(401),
    isAllowedOrigin:origin=>origin==='https://www.myaipa.ca',inspect:async id=>{
      reads++;if(failCode)throw Object.assign(Error('private provider body must never escape'),{code:failCode});
      return{version:1,attemptId:id,readOnly:true,ready:false,resumeAllowed:false,groups:[]};
    }});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base='http://127.0.0.1:'+server.address().port;
  global.fetch=(url,options)=>{assert.equal(new URL(url).origin,base,'Only loopback synthetic HTTP is permitted');return nativeFetch(url,options);};
});
after(async()=>{global.fetch=nativeFetch;await new Promise(resolve=>server.close(resolve));});
const headers={'x-fixture-session':'signed-in','Content-Type':'application/json',Origin:'https://www.myaipa.ca','X-MyAIPA-Read-Only-Check':'1'};
const request=(extra={},body={},id=attempt)=>fetch(base+'/api/admin/signup-tracker/'+id+'/diagnostics',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
test('real HTTP handler refuses unauthenticated requests before invoking readers',async()=>{
  reads=0;assert.equal((await request({'x-fixture-session':''})).status,401);assert.equal(reads,0);
});
test('origin, content type, explicit header and server-only target input are required',async()=>{
  reads=0;for(const h of [{Origin:'https://evil.example'},{Origin:''},{'X-MyAIPA-Read-Only-Check':''},{'Content-Type':'text/plain'}])assert.equal((await request(h)).status,403);
  assert.equal((await request({},{url:'https://evil.example'})).status,403);assert.equal((await request({},[])).status,403);
  assert.equal((await request({}, {},'wrong')).status,400);assert.equal(reads,0);
});
test('explicit authenticated POST returns only read-only report and no-store; GET is not a provider trigger',async()=>{
  reads=0;const r=await request();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const body=await r.json();assert.equal(body.diagnostics.attemptId,attempt);assert.equal(body.diagnostics.ready,false);assert.equal(reads,1);
  assert.equal((await fetch(base+'/api/admin/signup-tracker/'+attempt+'/diagnostics',{headers})).status,404);assert.equal(reads,1);
});
test('conflict/rate/access failures never return last success as a new pass or raw errors',async()=>{
  for(const [code,status]of [['DIAGNOSTIC_EVIDENCE_CHANGED',409],['DIAGNOSTIC_RATE_LIMITED',429],['raw-provider-secret',503]]){
    failCode=code;const r=await request();assert.equal(r.status,status);const text=await r.text();assert.doesNotMatch(text,/private provider|raw-provider-secret/);assert.doesNotMatch(text,/diagnostics/);
  }failCode='';
});
