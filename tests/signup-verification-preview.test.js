'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {signupVerificationPreview:preview}=require('../server/signupVerificationPreview');
const express=require('express');
const {registerTrackerRoutes}=require('../server/adminSignupTracker');
test('even all saved checks verified cannot authorize writes, sending, billing or live readiness',()=>{
 const record={status:'setup_ready'},setup={readOnly:true,coverage:'exact_context_and_saved_receipts',groups:[{checks:[{id:'script',state:'verified',detail:'private@example.test'}]}]};
 const before=JSON.stringify({record,setup}),p=preview(record,setup);
 assert.equal(JSON.stringify({record,setup}),before);
 for(const key of ['ready','applyAllowed','sendAllowed','trialActivationAllowed','liveProviderVerified'])assert.equal(p[key],false);
 assert.equal(p.savedChecks.find(c=>c.id==='script').state,'verified');
 assert.equal(p.savedChecks.find(c=>c.id==='trial').state,'unknown');
 assert.ok(p.nextActions.filter(a=>a.effects.length).every(a=>a.requiresApproval&&a.status==='not_authorized'));
 assert.doesNotMatch(JSON.stringify(p),/private@example/);
});
test('missing, duplicate, invalid and unavailable evidence cannot manufacture success',()=>{
 for(const checks of [[],[{id:'trial',state:'verified'},{id:'trial',state:'verified'}],[{id:'trial',state:'success'}]]){
  assert.equal(preview({}, {readOnly:true,groups:[{checks}]}).savedChecks.find(c=>c.id==='trial').state,'unknown');
 }
 assert.throws(()=>preview({},{}),/UNAVAILABLE/);
 assert.throws(()=>preview({status:'archived'},{readOnly:true,groups:[]}),/Closed signup/);
});
test('actual HTTP evidence failure and ambiguous target refuse without invoking any action',async t=>{
 const id='signup_'+'c'.repeat(32);let records=[{signupAttemptId:id,status:'setup_error'}],reads=0;
 const before=JSON.stringify(records),app=express();
 const forbidden=()=>{assert.fail('Preview invoked a write/action');};
 registerTrackerRoutes({app,requireAdmin:(req,res,next)=>req.headers['x-test-admin']==='yes'?next():res.sendStatus(401),
  list:()=>records,save:forbidden,audit:forbidden,actorHash:forbidden,isAllowedOrigin:()=>false,
  setupEvidence:async()=>{reads++;throw Error('private database failure');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/api/admin/signup-tracker/${id}/verification-preview`,headers={'x-test-admin':'yes'};
 const r=await fetch(url,{headers});assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.doesNotMatch(await r.text(),/private database failure/);assert.equal(JSON.stringify(records),before);assert.equal(reads,1);
 records=[records[0],{...records[0]}];assert.equal((await fetch(url,{headers})).status,409);assert.equal(reads,1);
 assert.equal((await fetch(url.replace(id,'invalid'),{headers})).status,400);assert.equal(reads,1);
});
