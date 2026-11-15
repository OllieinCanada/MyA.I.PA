'use strict';
const { test, before, beforeEach, after }=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-auto-text-test-'));
Object.assign(process.env,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',DATA_DIR:directory,DATABASE_URL:'',
 SECURITY_STATE_FORCE_DATABASE:'false',ADMIN_PASSWORD:'synthetic-admin-password',ADMIN_SESSION_SECRET:'synthetic-admin-session-secret',ADMIN_TOTP_SECRET:'',VAPI_WEBHOOK_SECRET:'synthetic-auto-webhook',VAPI_API_KEY:'',INTEGRATION_API_KEY:'',
 VAPI_REQUIRE_BUSINESS_MAPPING:'true',VAPI_BUSINESS_MAP:'{}',TWILIO_ACCOUNT_SID:'AC'+'0'.repeat(32),TWILIO_AUTH_TOKEN:'INERT',
 TWILIO_API_KEY_SID:'',TWILIO_API_KEY_SECRET:'',STRIPE_SECRET_KEY:'',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',
 SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:'',MAKE_SIGNUP_WEBHOOK_URL:'',TRIAL_REMINDER_DISABLE:'true',
 VAPI_AUTO_SYNC_ENABLED:'false',MISSED_CALL_ALERT_ENABLED:'false',DAILY_DIGEST_ENABLED:'false',SIGNUP_SETUP_WORKER_PAUSED:'true',
 SMS_NOTIFICATION_DISPATCH_ENABLED:'true',SMS_AUTOMATIC_NOTIFICATION_ENABLED:'true',SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS:'[7]'});
const egress=require('../scripts/local-staging-egress').install();
const localFetch=global.fetch, posts=[];
let mode='',signup,route,server,base;
global.fetch=async(url,request)=>{
 if(String(url)==='https://api.twilio.com/2010-04-01/Accounts/AC'+'0'.repeat(32)+'/Messages.json'){
  posts.push(Object.fromEntries(new URLSearchParams(request.body)));
  if(mode==='lost-ack')throw Error('Synthetic unknown acknowledgement');
  return{ok:true,status:201,json:async()=>({sid:'SM'+String(posts.length).padStart(32,'0'),status:'queued'})};
 }
 return localFetch(url,request);
};
const gate=require('../scripts/stub-notification-dispatch').createDispatchStub();
gate.db.runtimeStore.findMany=async({where,take=100}={})=>[...gate.rows.values()]
 .filter(row=>where?.key?.in?where.key.in.includes(row.key):true).slice(0,take).map(row=>structuredClone(row));
gate.db.vapiBusinessMapping={findMany:async({where})=>where.matchValue.in.map(matchValue=>({matchValue,businessId:mode==='conflict'&&matchValue==='fixture-phone'?8:7}))};
gate.db.business={findUnique:async()=>({id:7,name:'Synthetic Electric',phone:'+19055550101',settings:{ownerPhone:'+19055550101'}})};
gate.db.smsSuppression={findUnique:async()=>({suppressed:mode==='suppressed'})};
global.__myAiPaPrisma=new Proxy(gate.db,{get(target,key){
 if(key in target)return target[key];if(typeof key!=='string'||key==='then')return undefined;
 const refuse=async()=>{throw Error('Unexpected database model in sealed test');};
 return key.startsWith('$')?refuse:new Proxy({},{get:(_,method)=>method==='then'?undefined:refuse});
}});
const {app}=require('../server/index');
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));egress.allowPort(server.address().port);base='http://127.0.0.1:'+server.address().port;});
beforeEach(()=>{
 mode='';posts.length=0;gate.rows.clear();gate.calls.clear();gate.leads.clear();process.env.SMS_AUTOMATIC_NOTIFICATION_ENABLED='true';
 signup={signupAttemptId:'fixture-signup',businessId:7,businessName:'Synthetic Electric',ownerPhone:'+19055550101',
  subscriptionId:'fixture-sub',subscriptionStatus:'active',status:'active',twilioPhoneNumber:'+19055550100',
  vapiAssistantId:'fixture-assistant',vapiPhoneNumberId:'fixture-phone'};
 route={status:'active',businessId:7,assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',phoneNumber:'+19055550100',subscriptionId:'fixture-sub'};
 for(const key of ['trial-voice-gate:phone-id:fixture-phone','trial-voice-gate:number:+19055550100'])gate.rows.set(key,{key,data:structuredClone(route)});
 saveSignup();fs.writeFileSync(path.join(directory,'trial-reminders.json'),'{}');
});
function saveSignup(){fs.writeFileSync(path.join(directory,'signup-dashboard.json'),JSON.stringify({fixture:signup}));}
after(async()=>{
 server?.closeAllConnections?.();if(server)await new Promise(r=>server.close(r));
 assert.equal(egress.status().unexpectedOutboundAttempts,0);
 assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('myaipa-auto-text-test-'));
 fs.rmSync(directory,{recursive:true,force:true});assert.equal(fs.existsSync(directory),false);
});
const args={businessName:'Do not trust model name',name:'Synthetic Caller',requestType:'message',pricingDiscussed:false,message:'Fictitious request',rawPhoneNumber:'+19055550999'};
async function request({answer='Perfect. Yes.',auth=true,toolId='fixture-tool',parameters=args,artifact=true,timestamp=Date.now()}={}){
 const response=await fetch(base+'/api/webhooks/voice',{method:'POST',headers:{'content-type':'application/json',...(auth?{'x-vapi-secret':'synthetic-auto-webhook'}:{})},body:JSON.stringify({message:{
  type:'tool-calls',timestamp,call:{id:'fixture-call',assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',customer:{number:'+19055550102'}},
  ...(artifact?{artifact:{messages:[{role:'bot',message:'Should I send this request to the team now?'},{role:'user',message:answer}]}}:{}),
  toolCallList:[{id:toolId,function:{name:'send_call_summaries_auto_0100_deadbeef_v2',arguments:typeof parameters==='string'?parameters:JSON.stringify(parameters)}}]}})});
 const body=await response.json();return{status:response.status,body,result:body.results?JSON.parse(body.results[0].result):null};
}
test('actual authenticated HTTP route uses real context reader and automatic claims with fake provider only',async()=>{
 const r=await request();assert.equal(r.status,200);assert.equal(r.result.complete,true);assert.equal(r.result.deliveryProven,false);
 assert.deepEqual(posts.map(x=>x.To),['+19055550101','+19055550102']);
 assert.match(posts[1].Body,/Synthetic Electric/);assert.doesNotMatch(posts[1].Body,/Do not trust model name/);
 assert.equal((await request({toolId:'changed-tool-id'})).result.complete,true);assert.equal(posts.length,2);
});

test('actual HTTP approval saves one business-bound lead and never duplicates texts on replay',async()=>{
 gate.calls.set(11,{id:11,businessId:7,callerId:12,caller:{id:12,phone:'+19055550102'},externalProvider:'vapi',externalId:'fixture-call',status:'STARTED'});
 const r=await request();assert.equal(r.result.complete,true);assert.equal(r.result.requestCapture.leadSaved,true);
 assert.equal(gate.leads.size,1);const lead=[...gate.leads.values()][0];assert.equal(lead.businessId,7);assert.equal(lead.callId,11);assert.match(lead.summary,/Fictitious request/);
 await request({toolId:'fresh-tool-id'});assert.equal(gate.leads.size,1);assert.equal(posts.length,2);
});

test('actual HTTP capture failure permits zero SMS and preserves existing call',async()=>{
 gate.calls.set(11,{id:11,businessId:8,callerId:12,caller:{id:12,phone:'+19055550102'},externalProvider:'vapi',externalId:'fixture-call',status:'STARTED'});
 const r=await request();assert.equal(r.result.complete,false);assert.equal(r.result.errorCode,'notification_request_call_conflict');
 assert.equal(posts.length,0);assert.equal(gate.leads.size,0);assert.equal(gate.calls.get(11).businessId,8);
});
test('actual route default-disabled, bad auth, refusal, missing artifact and malformed arguments have no sends',async()=>{
 process.env.SMS_AUTOMATIC_NOTIFICATION_ENABLED='false';assert.equal((await request()).result.errorCode,'automatic_notification_disabled');
 process.env.SMS_AUTOMATIC_NOTIFICATION_ENABLED='true';assert.equal((await request({auth:false})).status,401);
 for(const options of [{answer:'No'},{artifact:false},{parameters:'{broken'}])assert.equal((await request(options)).result.ok,false);
 assert.equal(posts.length,0);assert.equal(gate.rows.size,2);
});
test('expired trial is not bypassed and no subscription write or charge occurs',async()=>{
 signup.subscriptionStatus='paused';saveSignup();assert.equal((await request()).result.ok,false);assert.equal(posts.length,0);assert.equal(gate.rows.size,2);
});
test('conflicting tenant route refuses before any send',async()=>{mode='conflict';assert.equal((await request()).result.ok,false);assert.equal(posts.length,0);});
test('concurrent HTTP invocations share one admission per recipient',async()=>{
 await Promise.all(Array.from({length:12},(_,i)=>request({toolId:'concurrent-'+i})));assert.equal(posts.length,2);
 assert.equal((await request()).result.complete,true);assert.equal(posts.length,2);
});
test('HTTP lost acknowledgement never causes provider resubmission',async()=>{mode='lost-ack';assert.equal((await request()).result.complete,false);assert.equal((await request()).result.complete,false);assert.equal(posts.length,2);});
test('HTTP suppression prevents provider posts',async()=>{mode='suppressed';assert.equal((await request()).result.complete,false);assert.equal(posts.length,0);});
test('actual HTTP route refuses stale or missing provider timestamps without admissions',async()=>{
 for(const timestamp of [Date.now()-120000,null]){assert.equal((await request({timestamp})).result.errorCode,'notification_conversation_stale_or_unverified');}
 assert.equal(posts.length,0);assert.equal(gate.rows.size,2);
});
test('authenticated outcome alerts and saved-receipt inspection are read-only; anonymous access refused',async()=>{
 await request();const before=JSON.stringify([...gate.rows]),count=posts.length;
 const url=base+'/api/admin/call-notification-outcomes?businessId=7';
 assert.equal((await fetch(url)).status,401);
 const response=await fetch(url,{headers:{'x-admin-password':'synthetic-admin-password'}});
 assert.equal(response.status,200);const report=await response.json();assert.equal(report.alerts.length,2);
 assert.ok(report.alerts.every(x=>x.state==='accepted'&&!x.deliveryProven));assert.equal(report.readOnly,true);
 assert.equal(JSON.stringify([...gate.rows]),before);assert.equal(posts.length,count);
 assert.doesNotMatch(JSON.stringify(report),/Synthetic Caller|Fictitious request|190555501/);
});
