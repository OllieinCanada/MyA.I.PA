const crypto = require('node:crypto');
const { dispatchStagingIntakeNotification, ledgerKey } = require('./intakeLedger');
const { readProvisioningStep } = require('./provisioningState');
const active = new WeakSet();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const productionService = 'srv-d92503a8qa3s73crdpog';
function stagingWorkerEnabled(env = process.env) {
  return env.STAGING_INTAKE_WORKER_ENABLED === 'true' && env.INTAKE_LEDGER_MODE === 'staging' && env.APP_ENV === 'staging'
    && env.RENDER_SERVICE_ID !== productionService && /^[1-9]\d*$/.test(env.STAGING_INTAKE_BUSINESS_ID || '')
    && Number.isSafeInteger(Number(env.STAGING_INTAKE_BUSINESS_ID)) && Boolean(env.STAGING_INTAKE_ASSISTANT_ID);
}
function fail(code) { return Object.assign(new Error('Staging intake delivery requires review.'), { code }); }
async function assertItemScope(prisma, key, item, env) {
  if (!item || item.schemaVersion !== 1 || item.businessId !== Number(env.STAGING_INTAKE_BUSINESS_ID)
    || item.assistantId !== env.STAGING_INTAKE_ASSISTANT_ID || item.purpose !== 'owner-intake') throw fail('INTAKE_WORKER_SCOPE_MISMATCH');
  const call = await prisma.call.findUnique({ where: { id: item.callDbId } });
  const lead = await prisma.lead.findUnique({ where: { id: item.leadId } });
  if (!call || !lead || call.businessId !== item.businessId || lead.businessId !== item.businessId || lead.callId !== call.id
    || call.externalProvider !== 'vapi-staging-ledger' || typeof call.externalId !== 'string') throw fail('INTAKE_WORKER_SCOPE_MISMATCH');
  const expectedLedger = ledgerKey(String(item.businessId), 'staging-' + hash(call.externalId).slice(0,40));
  if (item.ledgerKey !== expectedLedger || key !== 'staging:intake-outbox:v1:' + hash(expectedLedger)
    || item.sourceEventId !== 'staging-intake:' + hash(expectedLedger)) throw fail('INTAKE_WORKER_SCOPE_MISMATCH');
}
async function restoreCompletedPublication({ prisma, key }) {
  const saved = await readProvisioningStep({ prisma, kind:'signup-sms', idempotencyKey:'staging-intake:' + hash(key) });
  if (saved.data?.status !== 'completed' || saved.data.result?.status !== 'SENT' || saved.data.result?.error) return false;
  // Reuses a completed database receipt. This callback must never execute.
  await dispatchStagingIntakeNotification({ prisma, key, sendHandoff:async()=>{ throw fail('INTAKE_CACHED_RESULT_REQUIRED'); } });
  return true;
}
async function readStagingQueueHealth({prisma,env=process.env,now=()=>new Date().toISOString()}) {
  if(!stagingWorkerEnabled(env))return{enabled:false};
  const rows=await prisma.runtimeStore.findMany({where:{key:{startsWith:'staging:intake-outbox:v1:'},AND:[
    {data:{path:['businessId'],equals:Number(env.STAGING_INTAKE_BUSINESS_ID)}},
    {OR:[{data:{path:['status'],equals:'pending'}},{data:{path:['status'],equals:'reconciliation_required'}}]},
  ]},orderBy:{updatedAt:'asc'},take:201});
  const pending=rows.filter(r=>r.data.status==='pending');
  return{enabled:true,checkedAt:now(),pending:pending.length,heldForReview:rows.length-pending.length,
    countsComplete:rows.length<201,oldestPendingAt:pending[0]?.data.createdAt||null};
}
async function drainStagingIntakeQueue({ prisma, env = process.env, sendHandoff, batchSize = 5, now = () => new Date().toISOString() }) {
  if (!stagingWorkerEnabled(env)) return { enabled:false, checked:0, submitted:0, reconciliationRequired:0 };
  if (typeof sendHandoff !== 'function' || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw fail('INTAKE_WORKER_CONFIGURATION_REQUIRED');
  if (active.has(prisma)) return { enabled:true, busy:true, checked:0, submitted:0, reconciliationRequired:0 };
  active.add(prisma);
  const report = { enabled:true, checked:0, submitted:0, reconciliationRequired:0, busyJobs:0 };
  const healthKey = `staging:intake-worker:v1:${env.STAGING_INTAKE_BUSINESS_ID}`;
  try {
    const rows = await prisma.runtimeStore.findMany({ where:{ key:{ startsWith:'staging:intake-outbox:v1:' }, AND:[
      {data:{path:['businessId'],equals:Number(env.STAGING_INTAKE_BUSINESS_ID)}}, {data:{path:['status'],equals:'pending'}},
    ] }, orderBy:{updatedAt:'asc'}, take:batchSize });
    for (const row of rows) {
      report.checked++;
      try {
        await assertItemScope(prisma,row.key,row.data,env);
        await dispatchStagingIntakeNotification({ prisma,key:row.key,sendHandoff:async item=>{
          if (!stagingWorkerEnabled(env)) throw fail('INTAKE_WORKER_DISABLED');
          await assertItemScope(prisma,row.key,item,env);
          return sendHandoff(item);
        } });
        report.submitted++;
      } catch(error) {
        if (error.code === 'PROVISIONING_ALREADY_IN_PROGRESS') { report.busyJobs++; continue; }
        const scopeFailure = /SCOPE_MISMATCH|OUTBOX_STALE/.test(error.code || '');
        if (!scopeFailure && await restoreCompletedPublication({prisma,key:row.key}).catch(()=>false)) { report.submitted++; continue; }
        // Never infer non-delivery from a timeout or failed state write. A held
        // item is not selected by this worker again and is never blindly resent.
        const current = await prisma.runtimeStore.findUnique({where:{key:row.key}});
        if (current?.data.status === 'submitted') { report.submitted++; continue; }
        const data = { ...current?.data, status:'reconciliation_required', lastErrorCode:String(error.code || 'INTAKE_DISPATCH_UNCONFIRMED').replace(/[^A-Z0-9_]/gi,'_').slice(0,100), lastCheckedAt:now() };
        await prisma.runtimeStore.upsert({where:{key:row.key},create:{key:row.key,data},update:{data}});
        report.reconciliationRequired++;
      }
    }
    const health = { lastRun:report,backlog:await readStagingQueueHealth({prisma,env,now}),lastSuccessfulRunAt:now(),providerDeliveryProven:false };
    await prisma.runtimeStore.upsert({where:{key:healthKey},create:{key:healthKey,data:health},update:{data:health}});
    return report;
  } finally { active.delete(prisma); }
}
module.exports = { stagingWorkerEnabled, drainStagingIntakeQueue, assertItemScope,readStagingQueueHealth };
