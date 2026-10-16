const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {memoryDb}=require('./helpers/twilio-status-memory-db');
const {buildSignupCompletionContent}=require('../server/signupCompletion');
const {dispatchSignupSms,signupSmsDispatchKey}=require('../server/signupSmsDispatch');
const {provisioningStateKey}=require('../server/provisioningState');
const {verifyDeliveredCompletionReceipt,reconcileSignupCompletionReceipt,reconciledCompletionDelivery,completionRecordFields,completionDeliveryUpdate,dispatchCompletionEmail}=require('../server/signupCompletionReconciliation');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const signup={businessId:20,signupAttemptId:'signup_'+'a'.repeat(32),ownerPhone:'+19055550123',twilioPhoneNumber:'+12895550100',vapiPhoneNumberId:'phone-a',vapiAssistantId:'assistant-a',forwardingSetupId:'setup-a',setupFollowupStatus:'failed',setupFollowupErrors:[{channel:'sms',code:'PROVISIONING_CONTEXT_MISMATCH'}]};
 const body=buildSignupCompletionContent({assignedPhone:signup.twilioPhoneNumber,forwardingSetupUrl:'https://www.myaipa.ca/#/f/'+'A'.repeat(24)}).sms;
 const sid='SM'+'1'.repeat(32);
 const stored={status:'completed',contextHash:hash(body),result:{sid,status:'queued'}};
 const message={sid,status:'delivered',to:signup.ownerPhone,from:'+12895550301',body};
 const setup={id:signup.forwardingSetupId,businessId:signup.businessId,vapiPhoneNumberId:signup.vapiPhoneNumberId,assignedMyAiPaNumber:signup.twilioPhoneNumber};
 const options={stored,signup,expectedSender:message.from,frontendUrl:'https://www.myaipa.ca',fetchReceipt:async()=>message,resolveLink:async()=>setup};
 return {signup,body,sid,stored,message,setup,options};
}
test('a changed secure link reuses only the original delivered SMS; immutable dispatch remains unchanged',async()=>{
 const f=fixture(),{prisma,rows}=memoryDb();let sends=0;
 const input={prisma,identity:f.signup.businessId,purpose:'setup-complete',request:{to:f.signup.ownerPhone,message:f.body},sendSms:async()=>{sends++;return {sid:f.sid,status:'queued'};}};
 await dispatchSignupSms(input);
 const changed=f.body.replace('A'.repeat(24),'B'.repeat(24));
 const result=await dispatchSignupSms({...input,request:{...input.request,message:changed},reconcileCompleted:stored=>verifyDeliveredCompletionReceipt({...f.options,stored})});
 assert.equal(result.sid,f.sid);assert.equal(result.delivered,true);assert.equal(sends,1);
 assert.equal([...rows.values()][0].data.contextHash,hash(f.body));
});
test('a delivered legacy attempt-bound receipt is found after a CRM business ID is assigned',async()=>{
 const f=fixture(),{prisma,rows}=memoryDb();
 const key=signupSmsDispatchKey({identity:f.signup.signupAttemptId,purpose:'setup-complete',request:{to:f.signup.ownerPhone}});
 rows.set(provisioningStateKey('signup-sms',key),{key:provisioningStateKey('signup-sms',key),data:f.stored});
 const result=await reconcileSignupCompletionReceipt({prisma,...f.options,expectedSid:f.sid});assert.equal(result.delivered,true);
});
test('multiple completed dispatch identities fail closed before reading providers',async()=>{
 const f=fixture(),{prisma,rows}=memoryDb();let reads=0;
 for(const identity of [f.signup.businessId,f.signup.signupAttemptId]){
  const key=provisioningStateKey('signup-sms',signupSmsDispatchKey({identity,purpose:'setup-complete',request:{to:f.signup.ownerPhone}}));rows.set(key,{key,data:f.stored});
 }
 await assert.rejects(reconcileSignupCompletionReceipt({prisma,...f.options,fetchReceipt:async()=>{reads++;return f.message;}}),{code:'COMPLETION_RECEIPT_AMBIGUOUS'});assert.equal(reads,0);
});
for(const [name,change,code] of [
 ['wrong recipient',f=>f.message.to='+19055550999','COMPLETION_RECIPIENT_MISMATCH'],
 ['wrong sender',f=>f.message.from='+12895550999','COMPLETION_RECIPIENT_MISMATCH'],
 ['undelivered',f=>f.message.status='undelivered','COMPLETION_DELIVERY_NOT_CONFIRMED'],
 ['queued',f=>f.message.status='queued','COMPLETION_DELIVERY_NOT_CONFIRMED'],
 ['changed body',f=>f.message.body+=' Extra','COMPLETION_ORIGINAL_CONTENT_MISMATCH'],
 ['different number',f=>f.signup.twilioPhoneNumber='+12895550999','COMPLETION_BUSINESS_CONTENT_MISMATCH'],
 ['wrong setup',f=>f.setup.id='other','COMPLETION_SETUP_OWNERSHIP_MISMATCH'],
 ['other business',f=>f.setup.businessId=21,'COMPLETION_SETUP_OWNERSHIP_MISMATCH'],
 ['other phone record',f=>f.setup.vapiPhoneNumberId='other','COMPLETION_SETUP_OWNERSHIP_MISMATCH'],
 ['expired link',f=>f.options.resolveLink=async()=>null,'COMPLETION_SETUP_OWNERSHIP_MISMATCH'],
])test('reconciliation rejects '+name,async()=>{const f=fixture();change(f);await assert.rejects(verifyDeliveredCompletionReceipt(f.options),{code});});
test('a caller cannot substitute a different receipt SID',async()=>{const f=fixture();await assert.rejects(verifyDeliveredCompletionReceipt({...f.options,expectedSid:'SM'+'2'.repeat(32)}),{code:'COMPLETION_SAVED_RECEIPT_MISMATCH'});});
test('known accepted messages remain pending without being resent or called delivered',async()=>{
 const f=fixture();f.message.status='sent';const receipt=await verifyDeliveredCompletionReceipt({...f.options,requireDelivered:false});
 const delivery=reconciledCompletionDelivery(f.signup,receipt);assert.equal(receipt.delivered,false);assert.equal(delivery.status,'pending');
 assert.equal(completionRecordFields(delivery).setupFollowupSmsDeliveredAt,undefined);
});
test('the guarded live repair is admin-only, read-proves first, and contains no send/billing/provisioning calls',()=>{
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8');
 const start=source.indexOf("'/api/admin/signups/reconcile-completion-sms'");
 const endpoint=source.slice(start,source.indexOf('app.post(',start+1));
 assert.match(endpoint,/adminSignupRepairProcessRateLimiter/);assert.match(endpoint,/requireAdmin/);assert.match(endpoint,/req\.body\.apply===true/);
 assert.ok(endpoint.indexOf('await reconcileSignupCompletionReceipt')<endpoint.indexOf('if(apply)'));
 assert.doesNotMatch(endpoint,/sendSmsViaTwilio|sendSignupCompletionEmail|attachNoCardStripeTrial|sendMakeSignupCompleted/);
 const wrapper=source.slice(source.indexOf('async function deliverAndRecordSignupCompletion'),source.indexOf('function getUnixMs',source.indexOf('async function deliverAndRecordSignupCompletion')));
 assert.ok(wrapper.indexOf('signupDeliveryGatePassed')<wrapper.indexOf('await deliverSignupCompletion'));
 const trial=source.slice(source.indexOf('async function attachNoCardStripeTrialToSignup'),source.indexOf('async function attachNoCardStripeTrialToSignup')+900);
 assert.ok(trial.indexOf('signupDeliveryGatePassed')<trial.indexOf('createNoCardStripeTrialForSignup'));
});
test('SMS reconciliation preserves unrelated email errors and never claims email delivery',()=>{
 const f=fixture();f.signup.setupFollowupErrors.push({channel:'email',code:'SMTP_RECIPIENT_REJECTED'});
 const result=reconciledCompletionDelivery(f.signup,{sid:f.sid,status:'delivered',delivered:true});
 assert.equal(result.status,'partial');assert.deepEqual(result.channels,['sms']);assert.deepEqual(result.errors,[{channel:'email',code:'SMTP_RECIPIENT_REJECTED'}]);
 const fields=completionRecordFields(result,'now');assert.equal(fields.setupFollowupSmsSid,f.sid);assert.equal(fields.setupFollowupSmsDeliveredAt,'now');
});
test('completion callbacks update only the exact receipt and cannot regress delivered to sent',()=>{
 const f=fixture();const signup={...f.signup,setupFollowupSmsSid:f.sid};
 assert.equal(completionDeliveryUpdate(signup,{MessageSid:'other',MessageStatus:'delivered'}),null);
 const update=completionDeliveryUpdate(signup,{MessageSid:f.sid,MessageStatus:'delivered'});assert.equal(update.setupFollowupStatus,'sent');
 assert.equal(completionDeliveryUpdate({...signup,...update},{MessageSid:f.sid,MessageStatus:'sent'}),null);
 assert.equal(completionDeliveryUpdate({...signup,...update},{MessageSid:f.sid,MessageStatus:'failed',ErrorCode:'30003'}).setupFollowupStatus,'failed');
});
test('concurrent completion emails and link rotation send once, but changed resources stop',async()=>{
 const f=fixture(),{prisma}=memoryDb();let sends=0;
 const opts={prisma,signup:f.signup,request:{to:'owner@example.invalid',subject:'Setup ready',text:'link one'},sendEmail:async()=>{sends++;await new Promise(r=>setTimeout(r,10));return {sent:true};}};
 const results=await Promise.allSettled([dispatchCompletionEmail(opts),dispatchCompletionEmail({...opts,request:{...opts.request,text:'link two'}})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await dispatchCompletionEmail({...opts,request:{...opts.request,text:'link three'}});assert.equal(sends,1);
 await assert.rejects(dispatchCompletionEmail({...opts,signup:{...f.signup,twilioPhoneNumber:'+12895550999'}}),{code:'PROVISIONING_CONTEXT_MISMATCH'});
});
test('an ambiguous email send cannot be automatically resent',async()=>{
 const f=fixture(),{prisma}=memoryDb();let sends=0;
 const opts={prisma,signup:f.signup,request:{to:'owner@example.invalid',subject:'Setup ready'},sendEmail:async()=>{sends++;throw Error('response lost');}};
 await assert.rejects(dispatchCompletionEmail(opts));await assert.rejects(dispatchCompletionEmail(opts),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});assert.equal(sends,1);
});
