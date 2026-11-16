'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {fixture}=require('./helpers/signup-bug-memory-db');
const {recordSignupBug,registerSignupBugRoutes}=require('../server/signupBugHistory');
let f,target,server,base;const transport=global.fetch;
before(async()=>{
 f=fixture();target=f.add();await recordSignupBug({prisma:f.prisma,listSignups:f.listSignups,attemptId:target.attemptId,stage:'trial',error:{code:'P2028',message:'private credentials'}});
 const app=express();registerSignupBugRoutes({app,prisma:f.prisma,listSignups:f.listSignups,requireAdmin:(req,res,next)=>req.headers['x-fixture-admin']==='yes'?next():res.sendStatus(401)});
 server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});base='http://127.0.0.1:'+server.address().port;
 global.fetch=(url,options)=>{assert.equal(new URL(url).origin,base,'Only synthetic loopback requests');return transport(url,options);};
});
after(async()=>{global.fetch=transport;if(server)await new Promise(resolve=>server.close(resolve));});
const headers={'x-fixture-admin':'yes'};
test('actual history handler requires admin before database access',async()=>{const reads=f.reads;assert.equal((await fetch(base+'/api/admin/signup-bugs')).status,401);assert.equal(f.reads,reads);});
test('actual history GET is private, read-only and redacted; no mutation routes exist',async()=>{
 const before=JSON.stringify([...f.rows]),writes=f.writes;const response=await fetch(base+'/api/admin/signup-bugs?attemptId='+target.attemptId,{headers}),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.events.length,1);assert.equal(body.events[0].signupAttemptId,target.attemptId);assert.equal(body.ready,false);assert.doesNotMatch(JSON.stringify(body),/private credentials|private.example/);
 for(const method of ['POST','DELETE','PATCH'])assert.equal((await fetch(base+'/api/admin/signup-bugs',{method,headers})).status,404);
 assert.equal(f.writes,writes);assert.equal(JSON.stringify([...f.rows]),before);
});
test('actual handler refuses invalid scope and unavailable storage without exposing errors or empty success',async()=>{
 assert.equal((await fetch(base+'/api/admin/signup-bugs?attemptId=untrusted',{headers})).status,400);
 const prior=f.prisma.runtimeStore.findMany;f.prisma.runtimeStore.findMany=async()=>{throw Error('private database url');};
 try{const response=await fetch(base+'/api/admin/signup-bugs',{headers}),body=await response.json();assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.events,undefined);assert.doesNotMatch(JSON.stringify(body),/private database/);}finally{f.prisma.runtimeStore.findMany=prior;}
});
