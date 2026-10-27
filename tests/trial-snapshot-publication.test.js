const test=require('node:test');const assert=require('node:assert/strict');
const {promptHash,publishTrialSnapshot}=require('../server/trialSnapshotPublication');
function fixture(){
 const assistant={id:'assistant-one',model:{messages:[{role:'system',content:'Verified current business facts and SMS policy'}]}};
 const signup={businessId:37,signupAttemptId:'attempt-one',vapiAssistantId:assistant.id,vapiPhoneNumberId:'phone-one',twilioPhoneNumber:'+15555550100',agentRouteBindingMode:'trial-gate'};
 let gate={status:'active',businessId:37,assistantId:assistant.id,assistantSnapshot:{model:{messages:[]}}};let writes=0;
 const input={businessId:37,signupAttemptId:signup.signupAttemptId,assistantId:assistant.id,phoneNumberId:signup.vapiPhoneNumberId,expectedFingerprint:'a'.repeat(64),expectedPromptHash:promptHash(assistant),apply:true};
 const args={input,signups:[signup],getAssistant:async()=>assistant,getPhone:async()=>({id:signup.vapiPhoneNumberId,number:signup.twilioPhoneNumber,server:{url:'https://api.myaipa.ca/api/webhooks/voice'}}),getCalls:async()=>[],assertLifecycle:async()=>{},
  readGate:async()=>gate,fingerprint:()=>input.expectedFingerprint,publishGate:async context=>{writes++;assert.equal(context.identity.businessId,37);gate={...gate,assistantContentFingerprint:input.expectedFingerprint,assistantSnapshot:assistant};}};
 return{args,writes:()=>writes};
}
test('exact publication refreshes the owned snapshot without any provider-write capability',async()=>{
 const f=fixture();const result=await publishTrialSnapshot(f.args);assert.equal(result.refreshed,true);assert.equal(result.providerWrites,0);assert.equal(f.writes(),1);
});
test('read-only validation cannot publish snapshots',async()=>{
 const f=fixture();f.args.input.apply=false;const result=await publishTrialSnapshot(f.args);assert.equal(result.mode,'dry-run');assert.equal(f.writes(),0);
});
test('cross-business identities, duplicate owners, changed prompts and active calls fail before publication',async()=>{
 for(const change of [f=>{f.args.input.businessId=38;},f=>{f.args.signups.push({...f.args.signups[0],signupAttemptId:'duplicate'});},
  f=>{f.args.input.expectedPromptHash='b'.repeat(64);},f=>{f.args.getCalls=async()=>[{status:'in-progress'}];},f=>{f.args.getCalls=async()=>null;}]){
  const f=fixture();change(f);await assert.rejects(publishTrialSnapshot(f.args),{code:'TRIAL_SNAPSHOT_PUBLICATION_CONFLICT'});assert.equal(f.writes(),0);
 }
});
test('an archived signup or stale alias cannot be revived by a content refresh',async()=>{
 const f=fixture();f.args.signups[0].archivedAt=new Date().toISOString();await assert.rejects(publishTrialSnapshot(f.args));assert.equal(f.writes(),0);
 const g=fixture();g.args.readGate=async()=>({status:'active',businessId:999,assistantId:'assistant-one'});await assert.rejects(publishTrialSnapshot(g.args));assert.equal(g.writes(),0);
});
test('a missing snapshot readback never reports a verified rollout',async()=>{
 const f=fixture();f.args.publishGate=async()=>{};await assert.rejects(publishTrialSnapshot(f.args),/read-back/);
});
