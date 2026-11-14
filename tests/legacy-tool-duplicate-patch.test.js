'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {prepareLegacyDuplicatePatch}=require('../server/legacyToolDuplicatePatch');
const {getVapiCompositeToolCode}=require('../server/compositeCallNotifications');
const {createDispatchStub}=require('../scripts/stub-notification-dispatch');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const source=`
function cleanText(value){return String(value||'').trim();}
function normalizeE164(value){return String(value||'');}
function safeProviderError(){return {code:'synthetic',message:'synthetic'};}
async function checkSmsPermission(){return {allowed:true};}
async function sendTwilioMessage({to,from,body,fetchImpl}){
 return {attempted:true,sent:true,status:'queued',messageId:'SM'+'a'.repeat(32)};
}
async function executeCompositeNotifications({args,env,fetchImpl,btoaImpl,URLSearchParamsImpl}){
 const keys={owner:'fixture-owner',customer:'fixture-customer'};let owner;
 owner = await sendTwilioMessage({to:env.DEFAULT_OWNER_TO_NUMBER,from:env.DEFAULT_FROM_NUMBER,body:args.message,env,fetchImpl,btoaImpl,URLSearchParamsImpl,notificationKey:keys.owner});
 const customer = await sendTwilioMessage({to:env.CALLER_NUMBER,from:env.DEFAULT_FROM_NUMBER,body:args.message,env,fetchImpl,btoaImpl,URLSearchParamsImpl,notificationKey:keys.customer});
 return {ok:owner.sent&&customer.sent,complete:owner.sent&&customer.sent,owner,customer,ownerSmsEnabled:true,bodyBuiltByTool:true,requiresReconciliation:false};
}
return executeCompositeNotifications({args,env,fetchImpl:fetch,btoaImpl:btoa,URLSearchParamsImpl:URLSearchParams});`;
const input={message:'Synthetic only'},env={CALL_ID:'fixture-call-1',TWILIO_ACCOUNT_SID:'AC'+'0'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic',DEFAULT_FROM_NUMBER:'+19055550100',DEFAULT_OWNER_TO_NUMBER:'+19055550101',CALLER_NUMBER:'+19055550102',SMS_SUPPRESSION_API_KEY:'synthetic',SMS_NOTIFICATION_DISPATCH_URL:'https://fixture.invalid/dispatch'};
const run=(code,fetch,overrides={})=>new Function('args','env','fetch','btoa','URLSearchParams',`return (async()=>{${code}})()`)(input,{...env,...overrides},fetch,s=>Buffer.from(s).toString('base64'),URLSearchParams);
test('patch is offline/default-not-ready and preserves the two distinct roles',()=>{const p=prepareLegacyDuplicatePatch({code:source,expectedSha256:sha(source)});assert.equal(p.readyToApply,false);assert.deepEqual(p.addedEnvironmentNames,['SMS_NOTIFICATION_DISPATCH_URL']);assert.match(p.code,/leg: "owner"/);assert.match(p.code,/leg: "customer"/);assert.doesNotMatch(p.code,/awaiting_manual_approval/);assert.match(p.blocker,/authorization\/consent/);});
test('changed source hash refuses',()=>{assert.throws(()=>prepareLegacyDuplicatePatch({code:source+' ',expectedSha256:sha(source)}),/SOURCE_CHANGED/);});
for(const fragment of ['async function sendTwilioMessage(','async function executeCompositeNotifications(','owner = await sendTwilioMessage({','const customer = await sendTwilioMessage({'])test('missing expected source boundary '+fragment+' refuses',()=>{const code=source.replace(fragment,'/* absent */');assert.throws(()=>prepareLegacyDuplicatePatch({code,expectedSha256:sha(code)}),/AMBIGUOUS/);});
test('multiple owner invocations refuse rather than guessing',()=>{const code=source.replace('return {ok:','owner = await sendTwilioMessage({}); return {ok:');assert.throws(()=>prepareLegacyDuplicatePatch({code,expectedSha256:sha(code)}),/LEGS_AMBIGUOUS/);});
test('current draft-only generated code is not mistaken for the legacy automatic sender',()=>{const code=getVapiCompositeToolCode();assert.throws(()=>prepareLegacyDuplicatePatch({code,expectedSha256:sha(code)}),/NOT_EXPECTED/);});
test('missing gateway configuration never falls back to a provider POST',async()=>{const p=prepareLegacyDuplicatePatch({code:source,expectedSha256:sha(source)});let calls=0;const r=await run(p.code,async()=>{calls++;throw Error('must not fetch');},{SMS_NOTIFICATION_DISPATCH_URL:''});assert.equal(r.ok,false);assert.equal(calls,0);});
test('completed receipt loss cannot be reported as completion',async()=>{const p=prepareLegacyDuplicatePatch({code:source,expectedSha256:sha(source)}),store=createDispatchStub();let posts=0;const wrapped=store.wrap(async()=>{posts++;return{ok:true,status:201,json:async()=>({sid:'SM'+String(posts).padStart(32,'0'),status:'queued'})};});const fetch=async(url,options)=>{if(url==='https://fixture.invalid/dispatch'&&JSON.parse(options.body).action==='complete')throw Error('synthetic lost receipt');return wrapped(url,options);};const r=await run(p.code,fetch);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.equal(r.requiresReconciliation,true);await run(p.code,fetch);assert.equal(posts,2);});
