const test=require('node:test');
const assert=require('node:assert/strict');
const {validateEvent,card,presentation,sendProviderNotification,deliverDurably}=require('../server/providerNotifications');
const {collectProviderNotifications}=require('../server/providerNotificationSources');
const event=(extra={})=>({provider:'twilio',type:'low_balance',id:'balance:test',occurredAt:new Date().toISOString(),...extra});
test('Make live usage converts centicredits and reports denied access',async()=>{
 const env={MAKE_API_TOKEN:'test',PROVIDER_MAKE_ORGANIZATION_ID:'5814892',PROVIDER_MAKE_30DAY_CREDIT_WARNING:'8'};
 const fetchImpl=async url=>({ok:true,json:async()=>url.includes('/usage?')?{data:[{centicredits:900}]}:url.endsWith('/logs')?{scenarioLogs:[]}:{scenario:{isActive:true}}});
 const r=await collectProviderNotifications({env,fetchImpl});assert.equal(r.readiness.makeCredits.rolling30DayCredits,9);assert.equal(r.events[0].type,'usage_warning');
 const denied=await collectProviderNotifications({env,fetchImpl:async url=>url.includes('/usage?')?{ok:false,status:401}:fetchImpl(url)});
 assert.equal(denied.readiness.makeCredits.status,'provider_http_401');assert.equal(denied.events.length,0);
});
test('Vapi five-dollar warning is notification-only and deduplicated',async()=>{
 const env={VAPI_API_KEY:'test',PROVIDER_VAPI_WINDOW_SPEND_USD:'5'},fetchImpl=async()=>({ok:true,json:async()=>[{cost:5.25,createdAt:new Date().toISOString()}]});
 const first=await collectProviderNotifications({env,fetchImpl});assert.equal(first.events[0].amount,5.25);assert.equal(first.events[0].currency,'USD');
 const again=await collectProviderNotifications({env,fetchImpl,previous:first.snapshots});assert.equal(again.events.length,0);
});
test('recharge never follows a balance increase and requires receipt evidence',()=>{
  assert.throws(()=>validateEvent(event({type:'recharge_confirmed'})),/receipt/);
  assert.throws(()=>validateEvent(event({amount:20})),/currency/);
  const view=presentation(event({type:'recharge_confirmed',paymentId:'payment:123',evidence:'provider_receipt',amount:20,currency:'USD'}));
  assert.match(view.caption,/USD/);assert.match(view.caption,/confirmed/);
});
test('cards are PNG files and buttons stay on known dashboards',()=>{
  for(const provider of ['twilio','make','vapi','render'])assert.deepEqual([...card(provider).subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(presentation(event()).keyboard.inline_keyboard[0][0].url,'https://console.twilio.com/');
  assert.throws(()=>validateEvent(event({provider:'attacker'})));
});
test('successful photo deliveries must have a Telegram receipt',async()=>{
  let form;
  const fetchImpl=async(url,options)=>{form=options.body;return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:4}})};};
  assert.equal((await sendProviderNotification(event(),{token:'test',chatId:'1',fetchImpl})).messageId,4);
  assert.ok(form.get('photo'));assert.equal(form.get('parse_mode'),'HTML');
  await assert.rejects(sendProviderNotification(event(),{token:'test',chatId:'1',fetchImpl:async()=>({ok:true,status:200,json:async()=>({ok:true,result:{}})})}),/not confirmed/);
});
test('durable delivery skips a previously delivered event',async()=>{
  const rows=new Map();let sent=0;
  const store={findUnique:async({where})=>rows.get(where.key),upsert:async({where,create,update})=>{rows.set(where.key,rows.has(where.key)?update:create);},update:async({where,data})=>rows.set(where.key,data)};
  const tx={runtimeStore:store,$queryRaw:async()=>[]};const prisma={...tx,$transaction:async cb=>cb(tx)};
  const options={prisma,token:'test',chatId:'1',fetchImpl:async()=>{sent++;return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:1}})};}};
  const input=event();assert.equal((await deliverDurably(input,options)).delivered,true);assert.equal((await deliverDurably(input,options)).duplicate,true);assert.equal(sent,1);
});
test('normal Vapi call endings do not alert, real errors do',async()=>{
  const now=Date.now(),time=new Date(now).toISOString();
  const result=await collectProviderNotifications({now,env:{VAPI_API_KEY:'test'},fetchImpl:async()=>({ok:true,json:async()=>[
    {id:'normal',status:'ended',endedReason:'customer-ended-call',endedAt:time},
    {id:'failed',status:'ended',endedReason:'call.start.error-subscription-insufficient-credits',endedAt:time},
  ]})});
  assert.equal(result.events.length,1);assert.equal(result.events[0].type,'call_failed');
});
test('low balance warns once and never claims an auto-recharge',async()=>{
  const env={TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test'},fetchImpl=async()=>({ok:true,json:async()=>({balance:'5.00',currency:'usd'})});
  const first=await collectProviderNotifications({env,fetchImpl});assert.equal(first.events[0].type,'low_balance');
  const second=await collectProviderNotifications({env,fetchImpl,previous:first.snapshots});assert.equal(second.events.length,0);
  const increased=await collectProviderNotifications({env,previous:first.snapshots,fetchImpl:async()=>({ok:true,json:async()=>({balance:'25',currency:'usd'})})});assert.equal(increased.events.length,0);
});
test('failed provider checks preserve previous state and report the coverage gap',async()=>{
  const previous={'twilio:low_balance':true};const result=await collectProviderNotifications({env:{TWILIO_ACCOUNT_SID:'test',TWILIO_AUTH_TOKEN:'test'},previous,fetchImpl:async()=>({ok:false,status:401})});
  assert.equal(result.snapshots['twilio:low_balance'],true);assert.equal(result.readiness.twilio.status,'provider_http_401');
});
