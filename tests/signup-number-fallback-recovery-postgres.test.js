const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/number-fallback-fixture');
const {journalKey}=require('../server/intakeRecoveryJournal');
const {provisioningStateKey,runProvisioningStep}=require('../server/provisioningState');
const {contextStoreKey}=require('../server/signupProvisioningContext');
test('PostgreSQL fallback amendment locks, rollback and one-shot dispatch (no provider traffic)',
 {skip:process.env.RUN_NUMBER_FALLBACK_POSTGRES!=='1',timeout:60000},async t=>{
 const url=new URL(process.env.DATABASE_URL);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 assert.ok(/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname)||(process.env.GITHUB_ACTIONS==='true'&&url.pathname==='/ci'));
 const {PrismaClient}=require('@prisma/client'),prisma=new PrismaClient(),keys=[];
 async function seed(){const f=await fixture(prisma);keys.push(contextStoreKey(f.key),...['twilio-number','vapi-assistant','vapi-import'].map(k=>provisioningStateKey(k,f.key)),journalKey(f.record.signupAttemptId),
  'signup-number-fallback-recovery:'+require('node:crypto').createHash('sha256').update(f.key).digest('hex'));return f;}
 try{
  await t.test('two simultaneous amendments yield exactly one committed policy and intact archive',async()=>{
   const f=await seed(),out=await Promise.allSettled([f.run(),f.run()]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
   const row=(await prisma.runtimeStore.findUnique({where:{key:f.contextKey}})).data;
   const archived=(await prisma.runtimeStore.findUnique({where:{key:row.fallbackRecovery.journalKey}})).data;
   assert.deepEqual(archived.priorNumberStage,f.number);assert.deepEqual(archived.priorContext,f.context);
   let purchases=0;const input={prisma,kind:'twilio-number',idempotencyKey:f.key,contextHash:row.contextHash,execute:async()=>{purchases++;throw Object.assign(Error('fixture lost acknowledgment'),{code:'UND_ERR_SOCKET'});}};
   await Promise.allSettled([runProvisioningStep(input),runProvisioningStep(input)]);
   await assert.rejects(runProvisioningStep(input),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});assert.equal(purchases,1);
  });
  await t.test('fault after first write rolls back context, stage, intake and archive atomically',async()=>{
   const f=await seed();let writes=0;
   const wrapped={runtimeStore:prisma.runtimeStore,$transaction:work=>prisma.$transaction(tx=>work({
    $queryRaw:tx.$queryRaw.bind(tx),runtimeStore:{findUnique:a=>tx.runtimeStore.findUnique(a),create:a=>tx.runtimeStore.create(a),
     update:a=>{if(++writes===2)throw Error('fixture transaction interruption');return tx.runtimeStore.update(a);}}}))};
   await assert.rejects(f.run({prisma:wrapped}));assert.deepEqual((await prisma.runtimeStore.findUnique({where:{key:f.contextKey}})).data,f.context);
   assert.deepEqual((await prisma.runtimeStore.findUnique({where:{key:f.numberKey}})).data,f.number);
   assert.equal(await prisma.runtimeStore.count({where:{key:keys.at(-1)}}),0);
  });
 }finally{await prisma.runtimeStore.deleteMany({where:{key:{in:keys}}});await prisma.$disconnect();}
});
