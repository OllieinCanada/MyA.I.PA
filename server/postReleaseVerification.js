const { KEY, inspectCompletion } = require('./callSyncReceipt');
const { readTwilioReceiptHealth } = require('./twilioReceiptHealth');
const ACTIVE = { notIn: ['resolved', 'recovered', 'not_required'] };
async function inspectPostRelease({ prisma, releaseCommit, now = Date.now() }) {
  if (!/^[a-f0-9]{40}$/.test(releaseCommit || '') || !Number.isFinite(now)) throw Error('Release unknown');
  return prisma.$transaction(async tx => {
    // Do not call incident-list helpers: they prune old records as a side effect.
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1500ms'");
    const saved = await tx.runtimeStore.findUnique({ where: { key: KEY }, select: { data: true } });
    const sync = inspectCompletion(saved?.data, releaseCommit, now);
    const newerFailures = saved?.data?.startedAt ? await tx.runtimeIncidentRecord.count({ where: {
      remediation: ACTIVE, payload: { path: ['snapshot', 'Workflow'], equals: 'Vapi call sync background job' },
      lastDetectedAt: { gte: new Date(saved.data.startedAt) },
    } }) : null;
    if (sync.completedOnRelease && newerFailures !== 0) { sync.status = 'unresolved_failure'; sync.completedOnRelease = false; }
    const health = await readTwilioReceiptHealth({ prisma: tx, now });
    const historicalCount = await tx.runtimeIncidentRecord.count({ where: {
      reasonCode: { in: ['DATABASE_QUERY_IMPLEMENTATION_FAILED', 'PROVIDER_TIMEOUT'] },
      payload: { path: ['snapshot', 'Workflow'], equals: 'saved Twilio delivery reports background job' },
    } });
    const critical = await tx.runtimeIncidentRecord.count({ where: { severity: 'critical', remediation: ACTIVE } });
    if (![critical, historicalCount].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Unknown counts');
    return { schemaVersion: 1, readOnly: true, releaseCommit, scope: 'runtime_and_saved_callbacks',
      sync, runtime: { activeCriticalCount: critical },
      sms: { workerStatus: health.status, ...(health.counts ? { counts: health.counts } : {}),
        historicalIncidentCount: historicalCount, originalOperationOutcomes: 'unknown',
        providerDeliveryVerified: false, incidentClosurePermitted: false } };
  }, { maxWait: 500, timeout: 3000, isolationLevel: 'RepeatableRead' });
}
function handler({ prisma, getRelease }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (Object.keys(req.query || {}).length) return res.status(400).json({ readOnly: true, error: 'unexpected_query' });
    try { return res.json(await inspectPostRelease({ prisma, releaseCommit: getRelease() })); }
    catch (_) { return res.status(503).json({ readOnly: true, error: 'postrelease_evidence_unavailable' }); }
  };
}
module.exports = { inspectPostRelease, handler };
