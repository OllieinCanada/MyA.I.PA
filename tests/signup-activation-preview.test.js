'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express');
const {createActivationPreview,registerActivationPreview}=require('../server/signupActivationPreview');
const {createAssociationFence}=require('../server/signupAssociationRepair');
const id='signup_'+'a'.repeat(32),phantom='signup_'+'b'.repeat(32);
test('default policy refuses before proof reads',async()=>{
 let reads=0;const preview=createActivationPreview({getPolicy:()=>null,readProof:()=>{reads++;},fence:createAssociationFence()});
 await assert.rejects(preview(),/POLICY_REQUIRED/);assert.equal(reads,0);
});
test('running fence excludes overlapping lifecycle work and releases on proof failure',async()=>{
 const fence=createAssociationFence(),store={one:{signupAttemptId:id}};let release;
 const blocked=new Promise(r=>{release=r;});
 const preview=createActivationPreview({getPolicy:()=>({signupAttemptId:id,phantomId:phantom}),readStore:()=>store,fence,
  readProof:async()=>{await blocked;throw Error('private raw evidence');}});
 const pending=preview();assert.throws(()=>fence.hold([id]),/BUSY/);
 assert.throws(()=>fence.check(store,{}),/BUSY/);release();await assert.rejects(pending);
 fence.hold([id]);fence.release([id]);assert.deepEqual(store,{one:{signupAttemptId:id}});
});
test('proof wait detects changed policy before preparing',async()=>{
 let policy={signupAttemptId:id,phantomId:phantom};
 const preview=createActivationPreview({getPolicy:()=>policy,readStore:()=>({}),fence:createAssociationFence(),
  readProof:async()=>{policy={...policy,calendarPolicy:'changed'};return {};}});
 await assert.rejects(preview(),/PREVIEW_CHANGED/);
});
test('proof wait detects changed store before preparing',async()=>{
 let store={};const preview=createActivationPreview({getPolicy:()=>({signupAttemptId:id,phantomId:phantom}),readStore:()=>store,fence:createAssociationFence(),
  readProof:async()=>{store={unexpected:true};return {};}});
 await assert.rejects(preview(),/PREVIEW_CHANGED/);
});
test('real HTTP enforces admin, origin, header, empty body and sanitizes failures',async t=>{
 let calls=0;const app=express();app.use(express.json());
 registerActivationPreview({app,limiter:(_q,_s,n)=>n(),requireAdmin:(q,s,n)=>q.headers.authorization==='Bearer invented'?n():s.sendStatus(401),
  isAllowedOrigin:o=>o==='http://fixture.test',preview:async()=>{calls++;throw Error('PRIVATE_SECRET_MUST_NOT_ESCAPE');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const url=`http://127.0.0.1:${server.address().port}/api/admin/signups/activation-preview`;
 const headers={authorization:'Bearer invented',origin:'http://fixture.test','content-type':'application/json','x-myaipa-activation-preview':'1'};
 assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 for(const [h,body] of [[{...headers,origin:'http://foreign.test'},'{}'],[{...headers,'x-myaipa-activation-preview':'0'},'{}'],[headers,'{"action":"apply"}']]){
  assert.equal((await fetch(url,{method:'POST',headers:h,body})).status,409);
 }
 assert.equal(calls,0);
 const response=await fetch(url,{method:'POST',headers,body:'{}'});assert.equal(response.status,503);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes('PRIVATE_SECRET'));assert.equal(calls,1);
});
