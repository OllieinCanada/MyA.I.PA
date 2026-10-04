const {readRenderCredentials,fetchRenderEnv}=require('./run-with-render-env');
const {totpCode}=require('../server/adminSecurity');
const crypto=require('node:crypto');
const {signupBusinessKey,isClosedSignup}=require('../server/signupBusinessIdentity');
const {isBillingAlias}=require('../server/signupDashboardIdentity');
const names=new Set(['super plumbing','macdoopers electrical','dooper hvac']);
async function inspect(){
 const env=await fetchRenderEnv({serviceId:'srv-d92503a8qa3s73crdpog',credentials:readRenderCredentials(),keys:['ADMIN_PASSWORD','STRIPE_SECRET_KEY','VAPI_API_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN'],optionalKeys:['ADMIN_TOTP_SECRET']});
 async function request(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Read failed HTTP ${r.status}`);return r.json();}
 const login=await fetch('https://api.myaipa.ca/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:env.ADMIN_PASSWORD,mfaCode:env.ADMIN_TOTP_SECRET?totpCode(env.ADMIN_TOTP_SECRET):undefined}),signal:AbortSignal.timeout(15000)});
 if(!login.ok)throw Error(`Admin login HTTP ${login.status}`);
 const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('Admin session missing');
 const data=await request('https://api.myaipa.ca/api/admin/signups',{headers:{cookie}});
 const records=(data.signups||[]).filter(r=>names.has(String(r.businessName||'').trim().toLowerCase()));
 const stripe=new (require('stripe'))(env.STRIPE_SECRET_KEY);
 const report=[];
 for(const r of records){
  const subscription=r.subscriptionId?await stripe.subscriptions.retrieve(r.subscriptionId):null;
  let providerBinding=null;
  if(r.vapiPhoneNumberId){
   const vp=await request(`https://api.vapi.ai/phone-number/${encodeURIComponent(r.vapiPhoneNumberId)}`,{headers:{authorization:`Bearer ${env.VAPI_API_KEY}`}});
   const va=await request(`https://api.vapi.ai/assistant/${encodeURIComponent(r.vapiAssistantId)}`,{headers:{authorization:`Bearer ${env.VAPI_API_KEY}`}});
   const tp=await request(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?${new URLSearchParams({PhoneNumber:r.twilioPhoneNumber,PageSize:'1000'})}`,{headers:{authorization:'Basic '+Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}});
   providerBinding={assistantExists:va.id===r.vapiAssistantId,directAssistantMatches:vp.assistantId===r.vapiAssistantId,usesProtectedTrialGate:!vp.assistantId&&vp.server?.url==='https://api.myaipa.ca/api/webhooks/voice',exactNumber:vp.number===r.twilioPhoneNumber,twilioOwned:tp.incoming_phone_numbers?.length===1,inventoryComplete:!tp.next_page_uri,numberLast4:r.twilioPhoneNumber?.slice(-4)};
  }
  report.push({business:r.businessName,status:r.status,signupAttemptId:r.signupAttemptId,subscriptionId:r.subscriptionId,createdAt:r.createdAt,updatedAt:r.updatedAt,archivedAt:r.archivedAt,signupSource:r.signupSource,verification:{email:r.emailVerified,sms:r.smsVerified,sentAt:r.smsVerificationSentAt,delivery:r.smsVerificationDeliveryStatus,expiresAt:r.verificationExpiresAt},resources:{phone:!!r.twilioPhoneNumber,assistant:!!r.vapiAssistantId,vapiPhone:!!r.vapiPhoneNumberId},providerBinding,stripe:subscription?{status:subscription.status,live:subscription.livemode,metadataKeys:Object.keys(subscription.metadata),created:subscription.created,hasPaymentMethod:!!subscription.default_payment_method,cancelAtPeriodEnd:subscription.cancel_at_period_end}:null});
 }
 return {records,cookie,request,stripe,report};
}
async function archiveSafe(){
 if(!process.argv.includes('--confirm=ARCHIVE_THREE_STALE_WARNING_RECORDS'))throw Error('Exact cleanup confirmation required');
 const {records,cookie,request}=await inspect();
 const targets=records.filter(r=>!isClosedSignup(r)&&!r.signupAttemptId&&records.filter(c=>!isClosedSignup(c)&&isBillingAlias(r,c)&&c.status==='setup_ready').length===1);
 const hvac=records.find(r=>r.signupAttemptId==='signup_f80cb18a4673c1ff8aba2851a5c17ab2'&&!isClosedSignup(r));
 if(hvac){if(hvac.status!=='pending_verification'||hvac.smsVerified||hvac.emailVerified||hvac.twilioPhoneNumber||hvac.vapiAssistantId||hvac.vapiPhoneNumberId||hvac.subscriptionId||hvac.customerId||hvac.checkoutSessionId||Date.now()-Date.parse(hvac.updatedAt)<86400000)throw Error('HVAC archive safety check failed');targets.push(hvac);}
 for(const r of targets){
  const fresh=await request('https://api.myaipa.ca/api/admin/signups',{headers:{cookie}});
  const identity=r.signupAttemptId?`attempt:${r.signupAttemptId}`:r.subscriptionId;
  const current=(fresh.signups||[]).filter(x=>x.businessName===r.businessName&&x.signupAttemptId===r.signupAttemptId&&x.subscriptionId===r.subscriptionId&&!isClosedSignup(x));
  if(current.length!==1||current[0].twilioPhoneNumber||current[0].vapiAssistantId||current[0].vapiPhoneNumberId||signupBusinessKey(current[0])!==signupBusinessKey(r))throw Error('Archive target changed; stopped');
  if(r.signupAttemptId&&(current[0].status!=='pending_verification'||current[0].smsVerified||current[0].emailVerified||current[0].subscriptionId||current[0].customerId||current[0].checkoutSessionId))throw Error('Verification or billing changed; stopped');
  if(!r.signupAttemptId&&(fresh.signups||[]).filter(c=>!isClosedSignup(c)&&isBillingAlias(current[0],c)&&c.status==='setup_ready').length!==1)throw Error('Canonical owner changed; stopped');
  const result=await request('https://api.myaipa.ca/api/admin/attention/actions',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action:'archive_signup',targetId:crypto.createHash('sha256').update(identity).digest('hex').slice(0,24)})});
  console.log(JSON.stringify({business:r.businessName,billingAlias:!r.signupAttemptId,result:result.result||result}));
 }
 console.log(JSON.stringify({archived:targets.length,providerDeletes:0,billingChanges:0,hardDeletes:0}));
}
if(require.main===module)(process.argv.includes('--archive-safe')?archiveSafe():inspect().then(({report})=>console.log(JSON.stringify(report,null,2)))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={inspect};
