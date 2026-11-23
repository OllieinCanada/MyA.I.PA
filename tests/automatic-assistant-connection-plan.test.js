'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareAutomaticAssistantConnection:prepare}=require('../server/automaticAssistantConnectionPlan');
const {INTAKE_POLICY}=require('../server/serviceIntakePrompt');
function fixture(){return {businessId:7,signup:{businessId:7,vapiAssistantId:'fake-assistant',vapiPhoneNumberId:'fake-phone',twilioPhoneNumber:'+13655550101',ownerPhone:'+19055550100',status:'setup_error'},phone:{id:'fake-phone',number:'+13655550101',assistantId:'fake-assistant'},assistant:{id:'fake-assistant',firstMessage:'Keep this greeting',model:{provider:'openai',model:'fixture-model',toolIds:['keep-end-call','legacy'],messages:[{role:'system',content:'Keep business facts.\n## MYAIPA ISOLATED SMS ROUTING\nShould I save this request for review? spoken yes never authorizes\n## END MYAIPA ISOLATED SMS ROUTING\nKeep closing rules.'}]}},legacyTool:{id:'legacy',type:'code',function:{name:'send_call_summaries_0101_abcdef12_v2'},environmentVariables:[{name:'DEFAULT_FROM_NUMBER',value:'+13655550101'},{name:'DEFAULT_OWNER_TO_NUMBER',value:'+19055550100'}]}};}
test('candidate replaces only the isolated legacy tool and prompt block, with no mutation or activation',()=>{const f=fixture(),before=JSON.stringify(f),p=prepare(f);assert.equal(JSON.stringify(f),before);assert.deepEqual(p.assistantPatch.model.toolIds,['keep-end-call']);assert.equal(p.assistantPatch.model.tools[0].type,'function');const prompt=p.assistantPatch.model.messages[0].content;assert.match(prompt,/clear caller approval/);assert.match(prompt,/refusal before submission prevents/);assert.match(prompt,/Do not retry an unknown outcome/);assert.match(prompt,/Never ask for manual operator approval/);assert.doesNotMatch(prompt,/save this request for review|spoken yes never authorizes/);assert.match(prompt,/Keep business facts/);assert.match(prompt,/Keep closing rules/);assert.equal(p.applyAllowed,false);assert.equal(p.liveTestAllowed,false);assert.deepEqual(p.missingPrerequisites,['verified_normal_account_eligibility','normal_active_phone_gate','authenticated_webhook_configuration']);});
for(const [name,change]of [['tenant mismatch',f=>f.signup.businessId=9],['wrong assistant',f=>f.phone.assistantId='foreign'],['wrong number',f=>f.phone.number='+13655550199'],['wrong owner',f=>f.legacyTool.environmentVariables[1].value='+19055550199'],['wrong tool type',f=>f.legacyTool.type='endCall'],['missing attachment',f=>f.assistant.model.toolIds=['keep-end-call']],['duplicate attachment',f=>f.assistant.model.toolIds.push('legacy')],['pinned references',f=>f.assistant.model.toolRefs=[{toolId:'legacy',version:'1'}]],['ambiguous prompt',f=>f.assistant.model.messages.push({role:'system',content:'second'})],['missing prompt delimiter',f=>f.assistant.model.messages[0].content='unchanged business facts']])test(name+' refuses without a candidate',()=>{const f=fixture();change(f);assert.throws(()=>prepare(f),/IDENTITY_UNPROVEN/);});
test('even eligible synthetic account and gate never authorize application or a live test',()=>{const f=fixture();f.signup.subscriptionStatus='active';f.signup.subscriptionId='synthetic-sub';f.gate={status:'active',businessId:7,assistantId:'fake-assistant',phoneNumberId:'fake-phone',phoneNumber:f.phone.number,subscriptionId:f.signup.subscriptionId};f.webhookVerified=true;const p=prepare(f);assert.deepEqual(p.missingPrerequisites,[]);assert.equal(p.applyAllowed,false);assert.equal(p.liveTestAllowed,false);});

const {executeAutomaticCallNotifications:execute}=require('../server/automaticCallNotifications');
const {createDispatchStub}=require('../scripts/stub-notification-dispatch');
function journey(answer='Perfect. Yes.'){
 const f=fixture(),candidate=prepare(f),gate=createDispatchStub(),posts=[];
 const prompt=candidate.assistantPatch.model.messages[0].content,question=prompt.match(/ask exactly: "([^"]+)"/)[1];
 const options={prisma:gate.db,authenticated:true,env:{SMS_AUTOMATIC_NOTIFICATION_ENABLED:'true',SMS_NOTIFICATION_DISPATCH_ENABLED:'true',SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS:'[7]',TWILIO_ACCOUNT_SID:'AC'+'0'.repeat(32),TWILIO_AUTH_TOKEN:'INERT'},
 message:{timestamp:Date.now(),call:{id:'synthetic-candidate-call',assistantId:f.assistant.id,phoneNumberId:f.phone.id,customer:{number:'+19055550102'}},toolCallList:[{}],artifact:{messages:[{role:'assistant',message:question},{role:'user',message:answer}]}},
 toolCall:{id:'synthetic-tool-call',name:candidate.toolName,parameters:{businessName:'Invented Electric',requestType:'message',name:'Fake Caller',pricingDiscussed:false,message:'Synthetic request'}},
 readContext:async()=>({businessId:7,businessName:'Invented Electric',assistantId:f.assistant.id,phoneNumberId:f.phone.id,from:f.phone.number,owner:f.signup.ownerPhone,eligible:true,pricingOptions:null}),suppressionChecker:async()=>false,
 fetchImpl:async(url,req)=>{assert.equal(url,'https://api.twilio.com/2010-04-01/Accounts/AC'+'0'.repeat(32)+'/Messages.json');posts.push(Object.fromEntries(new URLSearchParams(req.body)));return {ok:true,status:201,json:async()=>({sid:'SM'+String(posts.length).padStart(32,'0'),status:'queued'})};}};
 return {options,posts};
}
test('candidate prompt and function actually authorize once through the unchanged backend, without real transport',async()=>{const f=journey();assert.equal((await execute(f.options)).complete,true);await execute(f.options);assert.deepEqual(f.posts.map(p=>p.To),['+19055550100','+19055550102']);});
for(const answer of ['No.','Yes, but wait.'])test('candidate journey blocks '+answer,async()=>{const f=journey(answer);assert.equal((await execute(f.options)).complete,false);assert.equal(f.posts.length,0);});
test('candidate uncertain fake provider response never causes a repeat',async()=>{const f=journey(),original=f.options.fetchImpl;f.options.fetchImpl=async(...args)=>{await original(...args);throw Error('synthetic lost acknowledgement');};assert.equal((await execute(f.options)).complete,false);await execute(f.options);assert.equal(f.posts.length,2);});
test('the actual shared draft intake block is migrated only in the candidate, preserving required work facts',()=>{const f=fixture();f.assistant.model.messages[0].content+='\n'+INTAKE_POLICY;const original=JSON.stringify(f),p=prepare(f),text=p.assistantPatch.model.messages[0].content;assert.equal(JSON.stringify(f),original);assert.doesNotMatch(text,/Should I save this request for review\?|saved for manual review|An authenticated human must/);for(const field of ['preferredStartDate','bestCallbackTime','streetAddress','city','jobDetails','workDetailsConfirmed'])assert.ok(text.includes(field));});

test('automatic candidate uses standalone send consent and one safe clarification, not draft or manual approval',()=>{
 const f=fixture();f.assistant.model.messages[0].content+='\n'+INTAKE_POLICY;
 const p=prepare(f),text=p.assistantPatch.model.messages[0].content;
 for(const rule of ['Is that right?','standalone assistant turn','Do not append the permission question',
  'one clarification attempt','Never treat a refusal as missing consent','unknown, timed out, accepted or already completed',
  'submission includes owner and caller confirmation texts','Should I send this request to the team now?'])assert.ok(text.includes(rule),rule);
 assert.doesNotMatch(text,/Should I save this request for review\?|Human review is still required/);
 assert.equal(p.applyAllowed,false);assert.equal(p.liveTestAllowed,false);
});
test('unknown manual instructions outside managed blocks require review instead of a contradictory candidate',()=>{const f=fixture();f.assistant.model.messages[0].content+='\nShould I save this request for review?';assert.throws(()=>prepare(f),/PROMPT_REVIEW_REQUIRED/);});
test('a modified managed intake block is not silently rewritten',()=>{const f=fixture();f.assistant.model.messages[0].content+='\n'+INTAKE_POLICY.replace('CURRENT DRAFT CONSENT','CHANGED DRAFT CONSENT');assert.throws(()=>prepare(f),/PROMPT_REVIEW_REQUIRED/);});

test('actual generated acknowledgement survives automatic preparation without changing submission authorization',()=>{
 const {buildSignupAssistantConfig}=require('../server/signupAssistantTemplate');
 const {updateMessages}=require('../server/vapiIsolatedSmsProvisioning');
 const {CONSENT_POLICY}=require('../server/signupSpeechPolicy');
 const f=fixture();
 const config=buildSignupAssistantConfig({business:{name:'Invented Electric'},owner:{phone:f.signup.ownerPhone},
  aiAssistant:{businessType:'Electrical contractor',serviceArea:'Fixture Town'}},{assignedPhone:f.phone.number});
 f.assistant.model.messages=updateMessages(config.model.messages,f.legacyTool.function.name);
 const before=JSON.stringify(f),p=prepare(f),prompt=p.assistantPatch.model.messages[0].content;
 assert.equal(JSON.stringify(f),before);
 assert.equal(prompt.split(CONSENT_POLICY).length,2);
 assert.match(prompt,/Only if the caller's request type is still unclear, briefly acknowledge/);
 assert.doesNotMatch(prompt,/After the recording notice, say exactly:|Should I save this request for review\?/);
 assert.match(prompt,/ask exactly: "Should I send this request to the team now\?"/);
 assert.match(prompt,/An earlier yes never approves changed details/);
 assert.match(prompt,/Unknown outcomes require receipt inspection, never retries/);
 assert.match(prompt,/Never ask for manual operator approval/);
 assert.equal(p.applyAllowed,false);assert.equal(p.liveTestAllowed,false);
});

function protectedFixture(){const f=fixture();f.signup.subscriptionStatus='active';f.signup.subscriptionId='fake-subscription';
 f.gate={status:'active',businessId:7,assistantId:f.assistant.id,phoneNumberId:f.phone.id,phoneNumber:f.phone.number,subscriptionId:f.signup.subscriptionId,assistantSnapshot:structuredClone(f.assistant)};
 f.phone.assistantId=null;f.gateWebhookUrl='https://fixture.test/api/webhooks/voice';f.phone.server={url:f.gateWebhookUrl};f.webhookVerified=true;return f;}
test('normal protected trial route prepares both model and exact snapshot changes, never activation',()=>{
 const f=protectedFixture(),before=JSON.stringify(f),p=prepare(f);assert.equal(JSON.stringify(f),before);assert.deepEqual(p.missingPrerequisites,[]);
 assert.equal(p.requiresGateSnapshotRefresh,true);assert.deepEqual(p.protectedGatePatch.assistantSnapshot.model,p.assistantPatch.model);
 assert.equal(p.protectedGatePatch.assistantSnapshot.firstMessage,f.assistant.firstMessage);assert.equal(p.applyAllowed,false);assert.equal(p.liveTestAllowed,false);
});
for(const [name,change]of[
 ['wrong subscription',f=>f.gate.subscriptionId='other'],['wrong tenant',f=>f.gate.businessId=8],['stale snapshot',f=>f.gate.assistantSnapshot.firstMessage='Changed'],
 ['unverified webhook',f=>f.webhookVerified=false],['wrong server URL',f=>f.phone.server.url='https://foreign.test/hook'],
 ['another direct assistant',f=>f.phone.assistantId='other'],['squad routing',f=>f.phone.squadId='other'],['missing expected URL',f=>f.gateWebhookUrl=''],
 ['provider ownership conflict',f=>f.phone.metadata={businessId:8}],['signup binding conflict',f=>f.gate.signupAttemptId='other-signup']
])test('protected candidate refuses '+name,()=>{const f=protectedFixture();change(f);assert.throws(()=>prepare(f),/IDENTITY_UNPROVEN/);});
