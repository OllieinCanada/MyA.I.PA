'use strict';
// Actual SQL transactions and locks, synthetic identities and fake providers.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {runProvisioningStep,provisioningStateKey}=require('../server/provisioningState');
const enabled=process.env.RUN_DATABASE_INTEGRATION==='1',keys=new Set();let db,observer,guard;
test.before(async()=>{
 if(!enabled)return;assert.equal(process.env.DISABLE_LOCAL_ENV_FILES,'1');
 const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/myaipa_recovery_drill_[a-z0-9_]+$/);
 const {PrismaClient}=require('@prisma/client'),options={datasources:{db:{url:url.href}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}};
 db=new PrismaClient(options);observer=new PrismaClient(options);await Promise.all([db.$connect(),observer.$connect()]);
 guard=require('../scripts/local-staging-egress').install({ports:[Number(url.port||5432)]});
});
test.after(async()=>{
 if(!enabled)return;
 try{if(db){await db.runtimeStore.deleteMany({where:{key:{in:[...keys]}}});assert.equal(await db.runtimeStore.count({where:{key:{in:[...keys]}}}),0);}
  if(guard)assert.equal(guard.status().unexpectedOutboundAttempts,0);
 }finally{await Promise.all([db?.$disconnect(),observer?.$disconnect()]);}
});
function fixture({claimDelay=0,oldDeadline=false,loseClaimAck=false,loseCompletionAck=false}={}){
 const idempotencyKey='synthetic-assistant-claim-'+crypto.randomUUID(),key=provisioningStateKey('vapi-assistant',idempotencyKey);keys.add(key);
 let count=0;const transactions=[];
 const prisma={runtimeStore:db.runtimeStore,async $transaction(fn,options){const ordinal=++count;transactions.push(options);
  const result=await db.$transaction(async tx=>{const value=await fn(tx);
   if(ordinal===1&&claimDelay)await tx.$queryRaw`SELECT pg_sleep(${claimDelay})::text AS waited`;
   return value;
  },ordinal===1&&oldDeadline?{maxWait:2000,timeout:5000}:options);
  if(ordinal===1&&loseClaimAck||ordinal===3&&loseCompletionAck)throw Object.assign(Error('Synthetic acknowledgement loss after actual commit'),{code:'P2028'});
  return result;
 }};
 return {key,transactions,args:{prisma,kind:'vapi-assistant',idempotencyKey,contextHash:'synthetic-context',verifyCompleted:async()=>true}};
}
const sqlTest=(name,fn)=>test(name,{skip:!enabled,timeout:45000},fn);
sqlTest('old five-second claim deadline reproduces P2028 with real SQL delay and zero creates',async()=>{
 const f=fixture({claimDelay:6.1,oldDeadline:true});let creates=0;
 await assert.rejects(runProvisioningStep({...f.args,execute:async()=>{creates++;return {};}}),{code:'P2028'});
 assert.equal(await db.runtimeStore.findUnique({where:{key:f.key}}),null);assert.equal(creates,0);assert.equal(f.transactions.length,1);
});
sqlTest('12-second SQL claim commits inside the new budget, provider executes outside all transactions, replay reuses',async()=>{
 const f=fixture({claimDelay:12.2});let creates=0;
 const input={...f.args,execute:async()=>{creates++;const row=await observer.runtimeStore.findUnique({where:{key:f.key}});assert.equal(row.data.status,'processing');assert.ok(row.data.dispatchStartedAt);return {assistantId:'synthetic-assistant'};}};
 await runProvisioningStep(input);assert.equal((await runProvisioningStep(input)).reused,true);assert.equal(creates,1);
 assert.deepEqual(f.transactions[0],{maxWait:2000,timeout:15000});
 assert.equal((await db.runtimeStore.findUnique({where:{key:f.key}})).data.status,'completed');
});
sqlTest('SQL claim exceeding fifteen seconds rolls back and never dispatches',async()=>{
 const f=fixture({claimDelay:15.2});let creates=0;
 await assert.rejects(runProvisioningStep({...f.args,execute:async()=>{creates++;return {};}}),{code:'P2028'});
 assert.equal(await db.runtimeStore.findUnique({where:{key:f.key}}),null);assert.equal(creates,0);assert.equal(f.transactions.length,1);
});
sqlTest('contended advisory lock hits the database-local five-second bound with zero creates',async()=>{
 const f=fixture();let entered,release,creates=0;const started=new Promise(r=>{entered=r;}),wait=new Promise(r=>{release=r;});
 const hold=observer.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${f.key}))::text AS lock_result`;entered();await wait;},{timeout:20000});
 const held=hold.then(()=>({}),error=>({error}));
 try{assert.equal(await Promise.race([started.then(()=>true),held.then(()=>false)]),true);
  const begin=Date.now();await assert.rejects(runProvisioningStep({...f.args,execute:async()=>{creates++;return {};}}),e=>e.code==='P2010'&&String(e.meta?.code)==='55P03');
  assert.ok(Date.now()-begin<12000,'SQL lock wait must not hang until the holder releases');assert.equal(creates,0);assert.equal(f.transactions.length,1);
 }finally{release();const outcome=await held;if(outcome.error)throw outcome.error;}
 assert.equal(await db.runtimeStore.findUnique({where:{key:f.key}}),null);
});
sqlTest('twenty simultaneous synthetic requests produce one assistant; wrong context stays blocked',async()=>{
 const f=fixture();let creates=0;
 const input={...f.args,execute:async()=>{creates++;await new Promise(r=>setTimeout(r,60));return {assistantId:'one-synthetic-assistant'};}};
 const results=await Promise.allSettled(Array.from({length:20},()=>runProvisioningStep(input)));
 assert.equal(creates,1);assert.ok(results.some(x=>x.status==='fulfilled'));
 for(const r of results)if(r.status==='fulfilled')assert.equal(r.value.assistantId,'one-synthetic-assistant');else assert.equal(r.reason.code,'PROVISIONING_ALREADY_IN_PROGRESS');
 await assert.rejects(runProvisioningStep({...input,contextHash:'wrong-context'}),{code:'PROVISIONING_CONTEXT_MISMATCH'});assert.equal(creates,1);
});
sqlTest('committed claim with lost acknowledgement is not automatically retried and remains blocked after a new client',async()=>{
 const f=fixture({loseClaimAck:true});let creates=0;const input={...f.args,execute:async()=>{creates++;return {};}};
 await assert.rejects(runProvisioningStep(input),{code:'P2028'});
 const saved=await observer.runtimeStore.findUnique({where:{key:f.key}});assert.equal(saved.data.status,'processing');assert.equal(saved.data.dispatchStartedAt,null);
 await assert.rejects(runProvisioningStep({...input,prisma:observer}),{code:'PROVISIONING_ALREADY_IN_PROGRESS'});assert.equal(creates,0);assert.equal(f.transactions.length,1);
});
sqlTest('completion commit with lost acknowledgement preserves result; new client reuses instead of creating',async()=>{
 const f=fixture({loseCompletionAck:true});let creates=0;const input={...f.args,execute:async()=>{creates++;return {assistantId:'persisted-synthetic'};}};
 await assert.rejects(runProvisioningStep(input),{code:'P2028'});
 assert.equal((await runProvisioningStep({...input,prisma:observer})).assistantId,'persisted-synthetic');assert.equal(creates,1);
});
sqlTest('lost provider response retains uncertainty and cannot create a second assistant',async()=>{
 const f=fixture();let creates=0;const input={...f.args,reconcile:async()=>null,execute:async()=>{creates++;throw Object.assign(Error('Synthetic response loss'),{code:'ETIMEDOUT'});}};
 await assert.rejects(runProvisioningStep(input),{code:'ETIMEDOUT'});
 await assert.rejects(runProvisioningStep({...input,prisma:observer}),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});
 assert.equal(creates,1);const row=await db.runtimeStore.findUnique({where:{key:f.key}});assert.ok(row.data.dispatchStartedAt);assert.equal(row.data.originalErrorCode,'ETIMEDOUT');
});
sqlTest('assistant-only continuation preserves the existing number receipt and reconciles an existing agent without creation',async()=>{
 const f=fixture(),numberKey=provisioningStateKey('twilio-number',f.args.idempotencyKey);keys.add(numberKey);
 const number='+13655550123';await db.runtimeStore.create({data:{key:numberKey,data:{kind:'twilio-number',status:'completed',contextHash:f.args.contextHash,
  result:{twilioPhoneNumber:number,twilioSid:'PN'+'a'.repeat(32)},completedAt:new Date().toISOString()}}});
 const before=await db.runtimeStore.findUnique({where:{key:numberKey}});let creates=0;
 const result=await runProvisioningStep({...f.args,reconcile:async()=>({assistantId:'existing-synthetic-assistant',assignedPhone:number}),execute:async()=>{creates++;throw Error('Must reuse');}});
 assert.equal(result.reused,true);assert.equal(result.assignedPhone,number);assert.equal(creates,0);
 assert.deepEqual(await observer.runtimeStore.findUnique({where:{key:numberKey}}),before);
});
