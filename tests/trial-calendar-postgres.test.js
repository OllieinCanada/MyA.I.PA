const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {prepareEnrollment,enrollmentKey} = require('../server/trialCalendarPolicy');
const enabled = process.env.RUN_TRIAL_CALENDAR_POSTGRES === '1';
test('disposable PostgreSQL calendar enrollment: concurrency, restart, conflict, rollback and lost acknowledgment',
  {skip:!enabled,timeout:30000}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(process.env.CI,'true');
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.equal(url.pathname,'/ci'); assert.equal(url.username,'ci');
  const {PrismaClient} = require('@prisma/client');
  const a=new PrismaClient(),b=new PrismaClient();
  const businessKey=crypto.randomBytes(32).toString('hex'),rollbackBusiness=crypto.randomBytes(32).toString('hex');
  const key=enrollmentKey(businessKey),rollbackKey=enrollmentKey(rollbackBusiness);
  const sentinelKey=`trial-calendar-fixture-sentinel:${crypto.randomUUID()}`;
  const owned=[key,rollbackKey,sentinelKey];
  const now=Date.parse('2026-11-15T04:59:59Z');
  const results=[];let passed=false,cleanup=false;
  const check=async(name,fn)=>{await fn();results.push({name,passed:true});};
  try {
    await a.runtimeStore.create({data:{key:sentinelKey,data:{untouched:true}}});
    let first;
    await check('eight concurrent clients/calls persist one anchor',async()=>{
      const plans=await Promise.all(Array.from({length:8},(_,i)=>prepareEnrollment({db:i%2?a:b,businessKey,priceId:'price_fixture',now})));
      first=plans[0];for(const p of plans)assert.deepEqual(p,first);
      assert.equal(first.trialStartAt,new Date(now).toISOString());
      assert.equal(await a.runtimeStore.count({where:{key}}),1);
    });
    await check('fresh connection after restart reuses the exact original plan across midnight',async()=>{
      await b.$disconnect();
      assert.deepEqual(await prepareEnrollment({db:b,businessKey,priceId:'price_fixture',now:now+2000}),first);
    });
    await check('conflicting price refuses without overwriting',async()=>{
      const before=await a.runtimeStore.findUnique({where:{key}});
      await assert.rejects(prepareEnrollment({db:b,businessKey,priceId:'price_other',now}),{code:'TRIAL_CALENDAR_PROOF_INVALID'});
      assert.deepEqual((await a.runtimeStore.findUnique({where:{key}})).data,before.data);
    });
    await check('an already held advisory lock is waited for before the exact stored enrollment is read',async()=>{
      let release,locked;
      const entered=new Promise(resolve=>{locked=resolve;});
      const held=b.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
        locked();await new Promise(resolve=>{release=resolve;});
      },{timeout:5000});
      await entered;
      let completed=false;
      const pending=prepareEnrollment({db:a,businessKey,priceId:'price_fixture',now:now+2000}).then(value=>{completed=true;return value;});
      try {await new Promise(resolve=>setTimeout(resolve,50));assert.equal(completed,false);}
      finally {release();await held;}
      assert.deepEqual(await pending,first);
    });
    await check('failed transaction leaves no partial enrollment',async()=>{
      const db={$transaction:fn=>a.$transaction(async tx=>{
        await fn(tx);throw Error('synthetic rollback');
      })};
      await assert.rejects(prepareEnrollment({db,businessKey:rollbackBusiness,priceId:'price_fixture',now}),/synthetic rollback/);
      assert.equal(await a.runtimeStore.findUnique({where:{key:rollbackKey}}),null);
    });
    await check('lost commit acknowledgment is inspected and stable state reused, with no provider replay',async()=>{
      const db={$transaction:async(fn,options)=>{await a.$transaction(fn,options);throw Error('synthetic acknowledgment loss');}};
      await assert.rejects(prepareEnrollment({db,businessKey:rollbackBusiness,priceId:'price_fixture',now}),/acknowledgment loss/);
      const inspected=await a.runtimeStore.findUnique({where:{key:rollbackKey}});
      assert.ok(inspected);
      const next=await prepareEnrollment({db:b,businessKey:rollbackBusiness,priceId:'price_fixture',now:now+2000});
      assert.equal(next.trialStartAt,inspected.data.anchorAt);
    });
    await check('expired enrollment cannot restart a historical clock',async()=>{
      await assert.rejects(prepareEnrollment({db:a,businessKey,priceId:'price_fixture',now:Date.parse(first.serviceCutoffAt)}),{code:'TRIAL_CALENDAR_ENROLLMENT_STALE'});
    });
    await check('unrelated sentinel is preserved',async()=>{
      assert.deepEqual((await a.runtimeStore.findUnique({where:{key:sentinelKey}})).data,{untouched:true});
    });
    passed=true;
  } finally {
    try {
      await a.runtimeStore.deleteMany({where:{key:{in:owned}}});
      cleanup=(await a.runtimeStore.count({where:{key:{in:owned}}}))===0;
      assert.equal(cleanup,true);
    } finally {
      await Promise.all([a.$disconnect(),b.$disconnect()]);
      const files=['server/trialCalendarPolicy.js','server/stripeTrialBilling.js','server/index.js','tests/trial-calendar-postgres.test.js'];
      const out=path.join(__dirname,'../diagnostics/trial-calendar-ci');fs.mkdirSync(out,{recursive:true});
      fs.writeFileSync(path.join(out,'postgres.json'),JSON.stringify({
        sourceHead:process.env.TRIAL_CALENDAR_EXPECTED_HEAD,passed:passed&&cleanup,cleanup,cases:results,
        realPostgres:true,providerCalls:0,productionTouched:false,scope:'Synthetic enrollment metadata only; not Stripe or physical-message proof',
        sha256:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',f))).digest('hex')])),
      },null,2));
    }
  }
});
