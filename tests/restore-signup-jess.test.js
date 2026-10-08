const test=require('node:test');
const assert=require('node:assert/strict');
const {safeCandidate,desiredVoice,restore}=require('../scripts/restore-signup-jess');
const {signupSpeechPatch,normalizeConsentPrompt}=require('../server/signupSpeechPolicy');
function fixture(){
 const signup={businessName:'Example Electric',signupAttemptId:'attempt-one',businessId:1,provisioningBusinessKey:'business-one',identityVerified:true,vapiAssistantId:'a',vapiPhoneNumberId:'p',twilioPhoneNumber:'+19055550123',status:'agent_testing'};
 const phone={id:'p',number:signup.twilioPhoneNumber,assistantId:'a'};
 const assistant={id:'a',name:'myaipa-vapi-assistant-test',latestVersion:'v1',...signupSpeechPatch({firstMessage:'Thanks for calling Example Electric.'}),voice:{provider:'openai',voiceId:'alloy',model:'tts-1',cachingEnabled:false},model:{provider:'openai',model:'gpt-4o',toolIds:['t'],messages:[{role:'system',content:normalizeConsentPrompt('- Business name: Example Electric\nPreserve every pricing choice.')} ]}};
 const data={signups:[signup],phones:[phone],customers:[],assistants:[assistant],tools:[],mappings:[{matchType:'assistantId',matchValue:'a',businessId:1},{matchType:'phoneNumber',matchValue:signup.twilioPhoneNumber,businessId:1}]};
 const plan={signup:structuredClone(signup),assistant:structuredClone(assistant),voice:desiredVoice(assistant)},writes=[];
 const admin=async p=>p.endsWith('/signups')?{signups:data.signups}:p.endsWith('/mappings')?{mappings:data.mappings}:{customers:data.customers};
 let calls=[];
 const api=async(p,o={})=>{
  if(p.startsWith('/call?'))return calls;
  if(p.startsWith('/phone-number?'))return structuredClone(data.phones);
  if(p.startsWith('/tool?'))return [];
  if(p.startsWith('/assistant?'))return [structuredClone(assistant)];
  if(o.method){writes.push(o);Object.assign(assistant,structuredClone(o.body));assistant.latestVersion='v'+(Number(assistant.latestVersion.slice(1))+1);}
  return structuredClone(assistant);
 };
 return {signup,assistant,data,plan,writes,io:{api,admin},setCalls:x=>{calls=x}};
}
test('restores Jess with caching off without changing any script or tools',async()=>{
 const f=fixture(),before=structuredClone(f.assistant);let backed=false;
 const result=await restore({io:f.io,data:f.data,plans:[f.plan],backup:async()=>{backed=true}});
 assert.equal(backed,true);assert.equal(result[0].verified,true);
 assert.deepEqual(f.writes.map(x=>Object.keys(x.body)),[['voice']]);
 assert.deepEqual(f.assistant.model,before.model);assert.equal(f.assistant.firstMessage,before.firstMessage);
 assert.deepEqual(f.assistant.voice,{provider:'vapi',voiceId:'Jess',version:'2',cachingEnabled:false});
});
test('backup failure prevents provider writes',async()=>{
 const f=fixture();await assert.rejects(restore({io:f.io,data:f.data,plans:[f.plan],backup:async()=>{throw Error('disk')}}));assert.equal(f.writes.length,0);
});
test('archived or shared signup cannot be changed',()=>{
 const f=fixture();assert.equal(safeCandidate(f.data,{...f.signup,archivedAt:'now'},f.assistant),'missing_active_verified_business_identity');
 f.data.signups.push({...f.signup,signupAttemptId:'other',businessId:2});assert.equal(safeCandidate(f.data,f.signup,f.assistant),'shared_active_signup_resource');
});
test('active calls and concurrent prompt edits prevent writes',async()=>{
 for(const mode of ['call','edit']){
  const f=fixture();if(mode==='call')f.setCalls([{status:'in-progress'}]);else f.assistant.model.messages[0].content+='\nConcurrent change.';
  const result=await restore({io:f.io,data:f.data,plans:[f.plan],backup:async()=>{}});
  assert.equal(result[0].verified,false);assert.equal(f.writes.length,0);
 }
});
test('readback failure rolls back only voice and stops the batch',async()=>{
 const f=fixture(),api=f.io.api;let count=0;
 f.io.api=async(p,o={})=>{const r=await api(p,o);if(p==='/assistant/a'&&!o.method&&++count===2)r.voice.voiceId='wrong';return r;};
 const result=await restore({io:f.io,data:f.data,plans:[f.plan,f.plan],backup:async()=>{}});
 assert.equal(result.length,1);assert.equal(result[0].verified,false);assert.equal(result[0].rollback,'restored');
 assert.equal(f.assistant.voice.voiceId,'alloy');assert.ok(f.writes.every(x=>Object.keys(x.body).join()==='voice'));
});
