// Only a completed call sync can recover this job. Connectivity probes cannot.
const { classifyOperationalError } = require('./operationalErrorClassifier');
const WORKFLOW = 'Vapi call sync background job';
const isSyncIncident = item => item?.snapshot?.Workflow === WORKFLOW;
const isActive = item => !['resolved', 'recovered', 'not_required'].includes(item?.remediation?.status);
const requiresSyncRecovery = item => isSyncIncident(item) && isActive(item);

function failureContext(previous, now, error) {
  const failures = previous.filter(item => isSyncIncident(item) && isActive(item));
  const firstFailure = Math.min(now, ...failures.map(item => Date.parse(item.diagnostics?.firstDetectedAt || item.detectedAt)).filter(Number.isFinite));
  const persistent = now - firstFailure >= 30 * 60_000;
  const classification = classifyOperationalError(error, { area: WORKFLOW });
  const delay = (['timeout', 'network', 'provider_outage', 'rate_limit'].includes(classification.category)
    && (!classification.provider || classification.provider === 'VAPI'))
    || (error?.code === 'VAPI_CALL_SYNC_PARTIAL' && classification.category === 'unknown');
  return {
    area: WORKFLOW,
    severity: persistent || !delay ? 'critical' : 'warning',
    reasonCode: delay ? 'VAPI_CALL_SYNC_DELAYED' : classification.reasonCode || 'VAPI_CALL_SYNC_FAILED',
    dedupeFingerprint: 'vapi-call-sync-delay-v1',
    whatFailed: !delay ? 'Vapi call sync failed and needs investigation' : persistent ? 'Vapi call sync has been delayed for 30 minutes or more' : 'Vapi call sync is delayed',
    impact: !delay ? classification.impact || 'Call sync failed; inspect the saved error before changing customer work.'
      : 'Call records may be out of date. This does not confirm failed calls, texts, or signups.',
    lastCheckpoint: 'The latest call sync did not fully complete.',
    snapshot: { 'Failure code': error?.code || error?.cause?.code || error?.name || 'UNKNOWN', 'First failed at': new Date(firstFailure).toISOString() },
  };
}

function completeSync(result) {
  return result && Number.isInteger(result.fetched) && result.fetched >= 0
    && Number.isInteger(result.synced) && result.synced >= 0
    && Array.isArray(result.detailErrors) && result.detailErrors.length === 0
    && Array.isArray(result.routingErrors)
    && result.synced + result.routingErrors.length === result.fetched;
}

function createCallSyncMonitor({ listIncidents, notifyFailure, recoverIncident, now = Date.now, log = console.error }) {
  let running = null;
  return function run(task) {
    // Coalesce overlapping scheduled ticks; never start an extra retry loop.
    if (running) return running;
    running = (async () => {
      const startedAt = now();
      let previous;
      try { previous = await listIncidents(); } catch (error) {
        // Still perform the job, but never claim recovery without its prior state.
        log('[vapi:sync] health history unavailable', { code: error.code || 'HISTORY_UNAVAILABLE' });
      }
      let result;
      let failure;
      try { result = await task(); } catch (error) { failure = error; }
      if (failure || !completeSync(result)) {
        // Do not hide a credential/implementation failure behind an earlier timeout.
        const detailError = detail => Object.assign(new Error('Vapi call detail lookup failed.'), {
          code: detail?.code || 'VAPI_CALL_SYNC_PARTIAL', providerStatus: detail?.providerStatus,
        });
        const detail = result?.detailErrors?.find(item => failureContext([], now(), detailError(item)).severity === 'critical')
          || result?.detailErrors?.[0];
        const error = failure || Object.assign(new Error('Vapi call sync returned incomplete call details.'), {
          code: detail?.code || 'VAPI_CALL_SYNC_PARTIAL', providerStatus: detail?.providerStatus,
        });
        try {
          const recorded = await notifyFailure(error, failureContext(previous || [], now(), error));
          if (recorded?.recorded && failure) failure.callSyncFailureRecorded = true;
        } catch (reportError) { log('[vapi:sync] delay report failed', { code: reportError.code || 'REPORT_FAILED' }); }
        if (failure) throw failure;
        return result;
      }
      for (const item of (previous || []).filter(item => isSyncIncident(item) && isActive(item))) {
        try {
          await recoverIncident(item.id, {
            status: 'recovered',
            syncRecovery: { workflow: WORKFLOW, startedAt: new Date(startedAt).toISOString(),
              completedAt: new Date(now()).toISOString(), lastFailureAt: item.diagnostics?.lastDetectedAt || item.detectedAt,
              occurrences: item.diagnostics?.occurrences, fetched: result.fetched, synced: result.synced },
            summary: 'A complete Vapi call sync succeeded. This confirms call-record sync recovery, not delivery of customer texts or signup completion.',
          });
        } catch (error) { log('[vapi:sync] recovery evidence could not be saved', { code: error.code || 'RECOVERY_STORE_FAILED' }); }
      }
      return result;
    })().finally(() => { running = null; });
    return running;
  };
}

module.exports = { WORKFLOW, isSyncIncident, requiresSyncRecovery, failureContext, completeSync, createCallSyncMonitor };
