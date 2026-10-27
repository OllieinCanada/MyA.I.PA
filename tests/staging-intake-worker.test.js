const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {memoryDb}=require('./helpers/twilio-status-memory-db');
const {applyIntakeDecision}=require('../server/intakeLedger');
const {stagingWorkerEnabled,drainStagingIntakeQueue}=require('../server/stagingIntakeWorker');
const env={APP_ENV:'staging',INTAKE_LEDGER_MODE:'staging',STAGING_INTAKE_WORKER_ENABLED:'true',STAGING_INTAKE_BUSINESS_ID:'7',STAGING_INTAKE_ASSISTANT_ID:'fixture-assistant'};
async function queue(){
  const trusted={businessId:7,callDbId:99,providerCallId:'fixture-call'};
  const {prisma,rows}=memoryDb(),leads=new Map();
  const call={id:99,callerId:44,businessId:7,externalId:trusted.providerCallId,externalProvider:'vapi-staging-ledger'};
  const models={call:{findUnique:async()=>call},lead:{findUnique:async({where})=>where.id?[...leads.values()].find(l=>l.id===where.id):leads.get(where.callId),
    upsert:async({where,create,update})=>{const lead=leads.has(where.callId)?{...leads.get(where.callId),...update}:{id:1,...create};leads.set(where.callId,lead);return lead;}}};
  const transaction=prisma.$transaction.bind(prisma);prisma.$transaction=work=>transaction(tx=>work({...tx,...models}));Object.assign(prisma,models);
  const f={prisma,rows,leads};
  const identity={...trusted,assistantId:env.STAGING_INTAKE_ASSISTANT_ID,callId:'staging-'+crypto.createHash('sha256').update(trusted.providerCallId).digest('hex').slice(0,40)};
  const base={businessId:'7',callerConfirmed:true};
  const initial={...base,eventId:'capture',expectedVersion:0,operations:[{field:'callbackNumber',action:'write',value:'+19055550123',confirmed:true}]};
  const finish={...base,eventId:'finish',expectedVersion:1,operations:[],finalize:true};
  let final;
  for(const input of [initial,finish])final=await applyIntakeDecision({prisma:f.prisma,input:{...input,callId:identity.callId},trusted:identity});
  return{...f,key:final.outboxKey,ledgerKey:[...f.rows.keys()].find(k=>k.startsWith('staging:intake-ledger:'))};
}
test('staging worker is off by default and refuses the production service even with staging flags',async()=>{
  assert.equal(stagingWorkerEnabled({}),false);assert.equal(stagingWorkerEnabled(env),true);
  for(const settings of [{...env,APP_ENV:'production'},{...env,RENDER_SERVICE_ID:'srv-d92503a8qa3s73crdpog'},{}]){
    const report=await drainStagingIntakeQueue({env:settings,prisma:new Proxy({},{get:()=>{throw Error('must not touch database');}})});
    assert.equal(report.enabled,false);
  }
});
test('two worker instances submit one handoff and record acceptance, not carrier delivery',async()=>{
  const f=await queue();let sends=0;
  const sendHandoff=async()=>{sends++;return{status:'SENT',handoffId:1};};
  await Promise.all([f.prisma,{...f.prisma}].map(prisma=>drainStagingIntakeQueue({prisma,env,sendHandoff})));
  assert.equal(sends,1);assert.equal(f.rows.get(f.key).data.status,'submitted');
  assert.equal(f.rows.get('staging:intake-worker:v1:7').data.providerDeliveryProven,false);
  await drainStagingIntakeQueue({prisma:f.prisma,env,sendHandoff});assert.equal(sends,1);
  assert.equal(f.rows.get('staging:intake-worker:v1:7').data.backlog.heldForReview,0);
});
test('unknown delivery is held for reconciliation and never selected for automatic resend',async()=>{
  const f=await queue();let sends=0;
  const sendHandoff=async()=>{sends++;throw Object.assign(Error('response lost'),{code:'UND_ERR_SOCKET'});};
  const first=await drainStagingIntakeQueue({prisma:f.prisma,env,sendHandoff});
  assert.equal(first.reconciliationRequired,1);assert.equal(f.rows.get(f.key).data.status,'reconciliation_required');
  await drainStagingIntakeQueue({prisma:f.prisma,env,sendHandoff});assert.equal(sends,1);
  assert.equal(f.rows.get('staging:intake-worker:v1:7').data.backlog.heldForReview,1);
});
test('wrong assistant, altered ledger and cross-business leads cannot dispatch',async()=>{
  for(const alter of [f=>{f.rows.get(f.key).data.assistantId='other';},f=>{f.rows.get(f.key).data.businessId=8;},
    f=>{f.rows.get(f.ledgerKey).data.version=100;},f=>{[...f.leads.values()][0].businessId=8;}]){
    const f=await queue();alter(f);let sends=0;
    await drainStagingIntakeQueue({prisma:f.prisma,env,sendHandoff:async()=>{sends++;return{status:'SENT'};}});
    assert.equal(sends,0);
  }
});
test('a failed local publication after acceptance recovers from the saved receipt without a second provider send',async()=>{
  const f=await queue();let sends=0,failOnce=true;
  const upsert=f.prisma.runtimeStore.upsert.bind(f.prisma.runtimeStore);
  f.prisma.runtimeStore.upsert=async options=>{
    if(options.where.key===f.key&&options.update.data.status==='submitted'&&failOnce){failOnce=false;throw Object.assign(Error('database transient'),{code:'P2028'});}
    return upsert(options);
  };
  const report=await drainStagingIntakeQueue({prisma:f.prisma,env,sendHandoff:async()=>{sends++;return{status:'SENT',handoffId:1};}});
  assert.equal(report.submitted,1);assert.equal(sends,1);assert.equal(f.rows.get(f.key).data.status,'submitted');
});
