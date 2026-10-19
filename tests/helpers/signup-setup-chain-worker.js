// Full application + real PostgreSQL; every provider is an in-process fake.
// This executable is never loaded by the application or its deployment.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const caseId=process.argv.find(v=>v.startsWith('--case='))?.slice(7);
if(!/^[1-9]$/.test(caseId||''))throw Error('Isolated case ID required');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(target.pathname))throw Error('Isolated loopback database required');
const inherited=Object.fromEntries(['PATH','SystemRoot','DATABASE_URL','DATA_DIR'].map(k=>[k,process.env[k]]));
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,inherited,{
  NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',SIGNUP_SETUP_WORKER_PAUSED:'true',
  JWT_SECRET:'isolated-chain-jwt-secret-at-least-32',ADMIN_SESSION_SECRET:'isolated-chain-admin-secret-at-least-32',
  SIGNUP_STATUS_SECRET:'isolated-chain-status-secret-at-least-32',PROVISIONING_SIGNING_SECRET:'isolated-chain-provisioning-secret-at-least-32',
  INTEGRATION_API_KEY:'isolated-chain-integration-key',MAKE_SIGNUP_WEBHOOK_URL:'https://hook.us1.make.com/isolated-chain',
  MAKE_SIGNUP_WEBHOOK_API_KEY:'isolated-chain-integration-key',FORWARDING_SETUP_SECRET:'isolated-chain-forwarding-secret-at-least-32',
  VAPI_API_KEY:'synthetic-vapi-only',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'b'.repeat(32),
  TWILIO_FROM_NUMBER:'+12895550100',VAPI_VOICE_SIGNUP_SMS_FROM:'+12895550100',
  SMS_SUPPRESSION_API_KEY:'isolated-chain-suppression-key',SMS_SUPPRESSION_CHECK_URL:'https://api.myaipa.test/api/integrations/sms/suppression/check',
  TWILIO_STATUS_CALLBACK_URL:'https://api.myaipa.test/api/webhooks/twilio/message-status',
  STRIPE_SECRET_KEY:'sk_test_isolated_fake_only',STRIPE_PRICE_ID:'price_isolated',TRIAL_USAGE_LIMIT_ENABLED:'false',
  VAPI_AUTO_SYNC_ENABLED:'false',TRIAL_REMINDER_DISABLE:'true',MISSED_CALL_ALERT_ENABLED:'false',DAILY_DIGEST_ENABLED:'false',
});
const {PrismaClient}=require('@prisma/client');
const prisma=global.__myAiPaPrisma=new PrismaClient({datasources:{db:{url:target.toString()}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
const PREFIX='chain-fake:'+caseId+':';
const load=async key=>(await prisma.runtimeStore.findUnique({where:{key:PREFIX+key}}))?.data;
const save=async(key,data)=>prisma.runtimeStore.upsert({where:{key:PREFIX+key},create:{key:PREFIX+key,data},update:{data}});
const inventory=async kind=>(await prisma.runtimeStore.findMany({where:{key:{startsWith:PREFIX+kind+':'}}})).map(r=>r.data);
async function count(name){const current=await load('count:'+name)||{value:0};await save('count:'+name,{value:current.value+1});}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
// Stripe's SDK uses HTTPS rather than global.fetch. Replace only its module in
// this sanitized child so no SDK request can escape the fake boundary.
require('stripe');
class FakeStripe{
  constructor(){
    for(const kind of ['customers','subscriptions'])this[kind]={
      list:async filters=>({data:(await inventory(kind)).filter(r=>!filters.email||r.email===filters.email),has_more:false}),
      retrieve:async id=>load(kind+':'+id),
      update:async(id,patch)=>{const data={...await load(kind+':'+id),...patch};await save(kind+':'+id,data);return data;},
      create:async data=>{await count(kind);const id=(kind==='customers'?'cus_':'sub_')+crypto.randomBytes(8).toString('hex');
        const result={...data,id,...(kind==='subscriptions'?{status:'trialing',trial_start:Math.floor(Date.now()/1000),trial_end:Math.floor(Date.now()/1000)+14*86400}: {})};await save(kind+':'+id,result);return result;},
    };
  }
}
require.cache[require.resolve('stripe')].exports=FakeStripe;
const nativeFetch=global.fetch;
let baseUrl;
global.fetch=async(url,options={})=>{
  const uri=new URL(url),method=options.method||'GET';
  if(uri.hostname==='127.0.0.1')return nativeFetch(url,options);
  if(uri.hostname==='hook.us1.make.com'){
    await count('make');
    const payload=JSON.parse(options.body);
    const invoke=async(endpoint,body)=>{
      const response=await nativeFetch(baseUrl+endpoint,{method:'POST',headers:{'content-type':'application/json','x-make-apikey':process.env.MAKE_SIGNUP_WEBHOOK_API_KEY},body:JSON.stringify({...body,provisioning:payload.provisioning})});
      const result=await response.json();if(!response.ok)throw Object.assign(new Error('Isolated module failed: '+endpoint+':'+JSON.stringify(result)),{code:result.code||'CHAIN_MODULE_FAILED'});return result;
    };
    const number=await invoke('/api/integrations/twilio/purchase-number',{areaCode:payload.provisioning.preferredAreaCode,region:payload.provisioning.preferredRegion,voiceUrl:'https://hook.us1.make.com/isolated-voice'});
    const assistant=await invoke('/api/integrations/vapi/create-signup-assistant',{assignedPhone:number.twilioPhoneNumber});
    const imported=await invoke('/api/integrations/vapi/import-twilio-number',{twilioPhoneNumber:number.twilioPhoneNumber,assistantId:assistant.assistantId});
    const fault=(await load('fault'))?.value;
    if(fault==='late-result'){
      const {contextStoreKey}=require('../../server/signupProvisioningContext');
      const key=contextStoreKey(payload.provisioning.idempotencyKey);
      const current=await prisma.runtimeStore.findUnique({where:{key}});
      await save('late-result',{key,data:current.data});
      const {completedAt,result,...pending}=current.data;
      await prisma.runtimeStore.update({where:{key},data:{data:pending}});
    }
    if(fault==='after-make')process.exit(86);
    if(['drop-body','late-result'].includes(fault))return {ok:true,status:200,headers:new Headers(),text:async()=>{throw Object.assign(new Error('other side closed'),{code:'UND_ERR_SOCKET'});}};
    return json(imported);
  }
  if(uri.hostname==='api.vapi.ai'){
    const segments=uri.pathname.split('/').filter(Boolean),kind=segments[0];
    const body=options.body?JSON.parse(options.body):{};
    if(!['assistant','phone-number','tool'].includes(kind))throw Error('Unexpected fake Vapi request '+method+' '+uri.pathname);
    if(method==='GET')return json(segments[1]?await load(kind+':'+segments[1])||{}:await inventory(kind));
    if(method==='POST'){
      await count(kind);const id=crypto.randomUUID();
      const result={...body,id,...(kind==='phone-number'?{number:body.twilioPhoneNumber,provider:'twilio'}:{})};
      await save(kind+':'+id,result);return json(result,201);
    }
    if(method==='PATCH'){
      const result={...await load(kind+':'+segments[1]),...body};
      await save(kind+':'+segments[1],result);return json(result);
    }
  }
  if(uri.hostname==='api.twilio.com'){
    if(uri.pathname.includes('/Calls'))throw Error('Automated test calls are forbidden');
    if(uri.pathname.includes('/AvailablePhoneNumbers/'))return json({available_phone_numbers:[{phone_number:'+1289555019'+caseId}]});
    if(uri.pathname.endsWith('/IncomingPhoneNumbers.json')){
      if(method==='GET')return json({incoming_phone_numbers:await inventory('twilio-number'),next_page_uri:null});
      const body=new URLSearchParams(options.body);await count('twilio-number');
      const result={sid:'PN'+crypto.randomBytes(16).toString('hex'),phone_number:body.get('PhoneNumber'),friendly_name:body.get('FriendlyName'),voice_url:body.get('VoiceUrl'),voice_method:'POST',capabilities:{voice:true,sms:true}};
      await save('twilio-number:'+result.sid,result);return json(result,201);
    }
    if(uri.pathname.endsWith('/Messages.json')&&method==='POST'){
      await count('texts');const body=new URLSearchParams(options.body),sid='SM'+crypto.randomBytes(16).toString('hex');
      const result={sid,to:body.get('To'),from:body.get('From'),body:body.get('Body'),status:'delivered',error_code:null};
      await save('message:'+sid,result);return json(result,201);
    }
    const sid=uri.pathname.match(/\/Messages\/(SM[a-f0-9]+)\.json$/)?.[1];
    if(sid&&method==='GET')return json(await load('message:'+sid));
  }
  throw Error('External traffic forbidden: '+uri.hostname+uri.pathname);
};
const {app,__test}=require('../../server/index');
const {createPendingSignupVerificationStore}=require('../../server/pendingSignupVerifications');
const {createSignupAttemptStore}=require('../../server/signupAttemptStore');
const {createVerificationChannelProof}=require('../../server/signupVerificationChannel');
const {buildMakeSignupEventKey}=require('../../server/makeSignupWebhook');
const {rateLimit}=require('express-rate-limit');
const localDrillLimiter=rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false});
app.post('/__local-chain',localDrillLimiter,async(req,res)=>{
  try{
    const {action,fault}=req.body;
    if(action==='fixture'){
      const payload={signupId:'isolated-full-chain-'+caseId,business:{name:'Isolated Chain Electric '+caseId,phone:'+1289555012'+caseId,address:'1 Synthetic Street, Hamilton, ON'},owner:{name:'Synthetic Owner',email:'chain'+caseId+'@example.invalid',phone:'+1289555012'+caseId},
        aiAssistant:{businessType:'Electrical',serviceArea:'Hamilton',assistantVoice:'elliot'},callForwarding:{carrier:'rogers',lineType:'mobile'}};
      const eventKey=buildMakeSignupEventKey(payload);
      await createSignupAttemptStore({prisma,secret:process.env.SIGNUP_STATUS_SECRET}).register({eventKey,payload,status:'pending_verification',businessName:payload.business.name,ownerEmail:payload.owner.email,ownerPhone:payload.owner.phone});
      const token=await createPendingSignupVerificationStore({prisma}).create({payload,ownerEmail:payload.owner.email,businessName:payload.business.name});
      const proof=createVerificationChannelProof(token,'sms',process.env.ADMIN_SESSION_SECRET);
      await save('fault',{value:fault||'normal'});
      return res.json({eventKey,token,query:new URLSearchParams({token,channel:'sms',channelProof:proof}).toString()});
    }
    if(action==='drain')return res.json(await __test.processVerifiedSignupJobs({force:true}));
    if(action==='release-late-result'){
      const saved=await load('late-result');
      await prisma.runtimeStore.update({where:{key:saved.key},data:{data:saved.data}});
      return res.json({saved:true});
    }
    if(action==='callbacks'){
      const {getTwilioSignature}=require('../../server/smsSuppression');
      for(let cycle=0;cycle<3;cycle++){
        for(const message of await inventory('message')){
          const body={MessageSid:message.sid,MessageStatus:'delivered'};
          const signature=getTwilioSignature(process.env.TWILIO_STATUS_CALLBACK_URL,body,process.env.TWILIO_AUTH_TOKEN);
          // Replay every receipt twice through the authenticated public route.
          for(let replay=0;replay<2;replay++){
            const response=await nativeFetch(baseUrl+'/api/webhooks/twilio/message-status',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body:new URLSearchParams(body).toString()});
            if(!response.ok)throw Error('Isolated delivery receipt rejected: '+await response.text());
            await response.text();
          }
        }
        await __test.processTwilioStatusInbox();
      }
      return res.json({processed:true});
    }
    if(action==='inspect'){
      const rows=await prisma.runtimeStore.findMany({where:{key:{startsWith:PREFIX+'count:'}}});
      const file=path.join(process.env.DATA_DIR,'signup-dashboard.json');
      return res.json({counts:Object.fromEntries(rows.map(r=>[r.key.slice((PREFIX+'count:').length),r.data.value])),dashboard:fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{},attempts:await prisma.signupAttempt.findMany(),jobs:await prisma.runtimeStore.findMany({where:{key:{startsWith:'signup-setup-job:v1:'}}})});
    }
    res.sendStatus(400);
  }catch(error){res.status(500).json({code:error.code||'CHAIN_FAILED',message:error.message});}
});
const server=app.listen(0,'127.0.0.1',()=>{baseUrl=`http://127.0.0.1:${server.address().port}`;process.send({port:server.address().port});});
