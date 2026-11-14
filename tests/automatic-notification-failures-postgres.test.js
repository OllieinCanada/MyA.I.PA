'use strict';
// SQL admission/receipt proof, not full application routing or live delivery.
// Reuses only the existing fresh disposable CI service after its crash drill.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {validateDrillTarget}=require('../scripts/sms-dispatch-postgres-safety');
const {executeAutomaticCallNotifications:execute}=require('../server/automaticCallNotifications');
const {classifyNotificationOutcome,inspectNotificationReceipts}=require('../server/notificationOutcomes');

test('automatic admission failures on isolated PostgreSQL with fake transport only',{
 timeout:120000,
 skip:process.env.RUN_AUTOMATIC_NOTIFICATION_POSTGRES!=='1'&&'Requires the disposable SMS PostgreSQL CI service'
},async t=>{
 const url=validateDrillTarget(process.env);
 const {PrismaClient}=require('@prisma/client');
 const create=()=>new PrismaClient({datasources:{db:{url}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
 const db=create(),owned=[];
 const report={schemaVersion:1,scope:'Synthetic automatic-admission SQL and receipt failure tests; injected route context, no live readiness proof',
  commit:process.env.SMS_DISPATCH_DRILL_EXPECTED_HEAD,realPostgreSQL:true,realSms:0,providerRequests:0,passed:false,cleanup:false,cases:[],
  sources:['server/automaticCallNotifications.js','server/notificationOutcomes.js','server/smsNotificationDispatch.js','server/compositeCallNotifications.js','tests/automatic-notification-failures-postgres.test.js']
   .map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',name))).digest('hex')}))};
 assert.match(report.commit||'',/^[a-f0-9]{40}$/);
 const directory=path.resolve(__dirname,'../diagnostics/sms-dispatch-postgres/automatic-'+crypto.randomUUID());
 fs.mkdirSync(directory,{recursive:true});
 async function fixture(){
  const id='sms-drill-'+crypto.randomUUID(),posts=[];owned.push(id);
  const parameters={requestType:'message',name:'Fictitious caller',message:'Fictitious SQL request',pricingDiscussed:false};
  const options={prisma:db,authenticated:true,
   env:{SMS_AUTOMATIC_NOTIFICATION_ENABLED:'true',SMS_NOTIFICATION_DISPATCH_ENABLED:'true',SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS:'[7]',TWILIO_ACCOUNT_SID:'AC_INERT',TWILIO_AUTH_TOKEN:'INERT'},
   message:{timestamp:Date.now(),call:{id,assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',customer:{number:'+19055550102'}},toolCallList:[{}],artifact:{messages:[{role:'bot',message:'Should I send this request to the team now?'},{role:'user',message:'Perfect. Yes.'}]}},
   toolCall:{id:'fixture-tool',name:'send_call_summaries_auto_0100_deadbeef_v2',parameters},
   readContext:async()=>({businessId:7,businessName:'Synthetic Electric',eligible:true,assistantId:'fixture-assistant',phoneNumberId:'fixture-phone',from:'+19055550100',owner:'+19055550101'}),
   suppressionChecker:async()=>false,fetchImpl:async(endpoint,request)=>{
    assert.equal(endpoint,'https://api.twilio.com/2010-04-01/Accounts/AC_INERT/Messages.json');
    const data=new URLSearchParams(request.body),leg=data.get('To')==='+19055550101'?'owner':data.get('To')==='+19055550102'?'customer':'';assert.ok(leg);
    // This insertion IS the entire fake transport. Never an HTTP request.
    await db.$executeRaw`INSERT INTO "SmsDispatchDrillTransport" ("caseId","leg","bodyHash") VALUES (${id},${leg},'synthetic')`;
    posts.push(leg);return{ok:true,status:201,json:async()=>({sid:'SM'+crypto.randomBytes(16).toString('hex'),status:'queued'})};
   }};
  return{id,options,posts,run:()=>execute(options),count:async()=>Number((await db.$queryRaw`SELECT count(*) AS n FROM "SmsDispatchDrillTransport" WHERE "caseId"=${id}`)[0].n)};
 }
 const check=async(name,fn)=>t.test(name,async()=>{try{await fn();report.cases.push({name,passed:true});}catch(e){report.cases.push({name,passed:false});throw e;}});
 try{
  const identity=(await db.$queryRaw`SELECT current_database() AS db,current_user AS actor`)[0];
  assert.equal(identity.db,'myaipa_sms_dispatch_drill_ci');assert.equal(identity.actor,'sms_drill');
  await check('concurrent authenticated approvals admit one fake send per role',async()=>{
   const f=await fixture();await Promise.all(Array.from({length:12},()=>f.run()));assert.equal(await f.count(),2);assert.equal((await f.run()).complete,true);
  });
  await check('real SQL rollback after claim creation permits no provider attempt',async()=>{
   const f=await fixture();f.options.prisma={runtimeStore:db.runtimeStore,$transaction:(fn,opts)=>db.$transaction(async tx=>{await fn(tx);await tx.$queryRaw`SELECT 1/0`;},opts)};
   assert.equal((await f.run()).complete,false);assert.equal(await f.count(),0);
   f.options.prisma=db;assert.equal((await f.run()).complete,true);assert.equal(await f.count(),2);
  });
  await check('lost commit acknowledgement and new client retain holds without sends',async()=>{
   const f=await fixture();f.options.prisma={runtimeStore:db.runtimeStore,$transaction:async(fn,opts)=>{await db.$transaction(fn,opts);throw Error('synthetic post-commit loss');}};
   assert.equal((await f.run()).complete,false);assert.equal(await f.count(),0);
   const restarted=create();try{f.options.prisma=restarted;assert.equal((await f.run()).complete,false);assert.equal(await f.count(),0);}finally{await restarted.$disconnect();}
  });
  await check('unknown fake provider outcome stays held across a new client',async()=>{
   const f=await fixture(),send=f.options.fetchImpl;f.options.fetchImpl=async(...args)=>{await send(...args);throw Error('synthetic timeout');};
   const r=await f.run();assert.equal(classifyNotificationOutcome(r.owner).state,'unknown');
   const restarted=create();try{f.options.prisma=restarted;await f.run();assert.equal(await f.count(),2);}finally{await restarted.$disconnect();}
  });
  await check('real SQL receipt rollback preserves accepted-but-unrecorded uncertainty',async()=>{
   const f=await fixture();f.options.prisma={runtimeStore:db.runtimeStore,$transaction:(fn,opts)=>db.$transaction(tx=>fn({
    $queryRaw:tx.$queryRaw.bind(tx),runtimeStore:{findUnique:tx.runtimeStore.findUnique.bind(tx.runtimeStore),create:tx.runtimeStore.create.bind(tx.runtimeStore),
     update:async input=>{if(input.data.data.state==='completed')await tx.$queryRaw`SELECT 1/0`;return tx.runtimeStore.update(input);}}
   }),opts)};
   const r=await f.run();assert.equal(r.complete,false);assert.equal(r.owner.sent,true);assert.equal(r.owner.dispatchReceiptStored,false);
   f.options.prisma=db;await f.run();assert.equal(await f.count(),2);
  });
  await check('changed request cannot obtain another SQL admission',async()=>{const f=await fixture();await f.run();f.options.toolCall.parameters.message='Changed fictitious request';assert.equal((await f.run()).complete,false);assert.equal(await f.count(),2);});
  await check('real advisory-lock wait rechecks disabled flag before admission',async()=>{
   const f=await fixture(),lockClient=create();let acquired,release;
   const entered=new Promise(r=>acquired=r),gate=new Promise(r=>release=r);
   const key=crypto.createHash('sha256').update(JSON.stringify([f.id,'+19055550100','owner'])).digest('hex');
   const held=lockClient.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'call-notification-dispatch:v1:'+key}))::text`;acquired();await gate;},{timeout:10000});
   let run;
   try{await entered;run=f.run();let waiting=false;
    for(let i=0;i<40;i++){const rows=await db.$queryRaw`SELECT count(*)::integer AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;if(rows[0].n>0){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}
    assert.equal(waiting,true);f.options.env.SMS_AUTOMATIC_NOTIFICATION_ENABLED='false';release();await held;assert.equal((await run).complete,false);assert.equal(await f.count(),0);
   }finally{release();try{await held;await run;}finally{await lockClient.$disconnect();}}
  });
  await check('receipt inspection never mutates claim or transport and cannot guess missing SID',async()=>{
   const f=await fixture(),r=await f.run();
   const before=await db.runtimeStore.findMany({where:{key:{startsWith:'call-notification-dispatch:v1:'}},orderBy:{key:'asc'}});
   const checked=await inspectNotificationReceipts({prisma:db,result:r.owner});assert.equal(checked.deliveryProven,false);assert.equal(checked.receiptCheck,'no_saved_receipt');
   assert.equal((await inspectNotificationReceipts({prisma:db,result:{attempted:true,sent:false}})).receiptCheck,'missing_message_id');
   assert.deepEqual(await db.runtimeStore.findMany({where:{key:{startsWith:'call-notification-dispatch:v1:'}},orderBy:{key:'asc'}}),before);assert.equal(await f.count(),2);
  });
  await check('revocation during final authority read prevents fake provider submission',async()=>{
   const f=await fixture(),read=f.options.readContext;let reads=0;
   f.options.readContext=async()=>{if(++reads===4)f.options.env.SMS_AUTOMATIC_NOTIFICATION_ENABLED='false';return read();};
   assert.equal((await f.run()).complete,false);assert.equal(await f.count(),0);
  });
  report.passed=report.cases.length===9&&report.cases.every(row=>row.passed);
  assert.equal(report.passed,true);
 }finally{
  try{
   for(const id of owned){
    assert.match(id,/^sms-drill-[a-f0-9-]{36}$/);
    for(const leg of ['owner','customer']){
     const key='call-notification-dispatch:v1:'+crypto.createHash('sha256').update(JSON.stringify([id,'+19055550100',leg])).digest('hex');
     await db.runtimeStore.deleteMany({where:{key}});assert.equal(await db.runtimeStore.findUnique({where:{key}}),null);
    }
    await db.$executeRaw`DELETE FROM "SmsDispatchDrillTransport" WHERE "caseId"=${id}`;
    assert.equal(Number((await db.$queryRaw`SELECT count(*) AS n FROM "SmsDispatchDrillTransport" WHERE "caseId"=${id}`)[0].n),0);
   }
   report.cleanup=true;
  }catch(error){report.passed=false;throw error;}
  finally{await db.$disconnect();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});}
 }
});
