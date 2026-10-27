// Fixed GET only. No env-file loading, provider clients, workers or incident actions.
const { projectEvidence } = require('../server/runtimeReceiptEvidence');
function project(r) {
  const statuses = ['unknown', 'previous_release', 'stale', 'empty_result', 'verified', 'unresolved_failure'];
  const workers = ['healthy', 'warning', 'critical', 'unknown', 'unavailable'];
  const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000;
  if (r?.schemaVersion !== 1 || r.readOnly !== true || !/^[a-f0-9]{40}$/.test(r.releaseCommit || '')
    || r.scope !== 'runtime_and_saved_callbacks' || !statuses.includes(r.sync?.status)
    || r.sync.completedOnRelease !== (r.sync.status === 'verified') || !count(r.runtime?.activeCriticalCount)
    || !workers.includes(r.sms?.workerStatus) || !count(r.sms.historicalIncidentCount)
    || r.sms.originalOperationOutcomes !== 'unknown' || r.sms.providerDeliveryVerified !== false
    || r.sms.incidentClosurePermitted !== false) throw Error('Unknown evidence');
  const sync = { status: r.sync.status, completedOnRelease: r.sync.completedOnRelease };
  if (sync.completedOnRelease) {
    if (!['fetched', 'synced', 'skippedUnmapped'].every(k => count(r.sync[k]))
      || r.sync.fetched === 0 || r.sync.fetched !== r.sync.synced + r.sync.skippedUnmapped) throw Error('Unknown accounting');
    for (const k of ['fetched', 'synced', 'skippedUnmapped']) sync[k] = r.sync[k];
  }
  const counts = {};
  if (r.sms.counts) for (const k of ['pending', 'processing', 'completed', 'failed', 'expiredLeases']) {
    if (!count(r.sms.counts[k])) throw Error('Unknown receipt counts'); counts[k] = r.sms.counts[k];
  }
  return { schemaVersion: 1, readOnly: true, releaseCommit: r.releaseCommit, scope: r.scope,
    sync, runtime: { activeCriticalCount: r.runtime.activeCriticalCount },
    ...(r.investigation ? { investigation: projectEvidence(r.investigation) } : {}),
    sms: { workerStatus: r.sms.workerStatus, counts, historicalIncidentCount: r.sms.historicalIncidentCount,
      originalOperationOutcomes: 'unknown', providerDeliveryVerified: false, incidentClosurePermitted: false } };
}
async function run({ env = process.env, fetchImpl = fetch } = {}) {
  if (!env.MONITOR_API_KEY) throw Error('Authentication unavailable');
  const response = await fetchImpl('https://api.myaipa.ca/api/internal/operations/postrelease-verification', {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${env.MONITOR_API_KEY}`, accept: 'application/json' } });
  if (!response.ok) throw Error('Evidence unavailable');
  return project(await response.json());
}
if (require.main === module) run().then(r => { console.log(JSON.stringify(r, null, 2));
  // Historical original outcomes remain unknown even when the worker is healthy.
  process.exitCode = 2;
}).catch(() => { console.error(JSON.stringify({ readOnly: true, error: 'postrelease_evidence_unavailable' })); process.exitCode = 1; });
module.exports = { run, project };
