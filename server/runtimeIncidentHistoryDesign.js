'use strict';

// Offline design preview only. No runtime store imports, I/O, approvals or executor.
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_LIMIT = 100;
const MAX_PREVIEW_RECORDS = 5000; // Input bound, never a storage retention limit.
const CLOSED = new Set(['resolved', 'recovered', 'not_required']);
const STATUSES = new Set(['queued', 'repairing', 'verifying', 'resolved', 'recovered', 'repair_dispatched', 'repair_ready', 'needs_user', 'failed', 'not_required']);
const KEYS = new Set(['id', 'generation', 'occurrences', 'severity', 'remediationStatus', 'firstDetectedAt', 'lastDetectedAt', 'syncRecoveryRequired', 'preservationHold']);
const fail = code => { throw new Error(code); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('HISTORY_PREVIEW_INVALID_TIME');
  return Date.parse(value);
}
function normalize(record, nowMs) {
  if (!plain(record) || Object.keys(record).some(key => !KEYS.has(key))) fail('HISTORY_PREVIEW_METADATA_ONLY');
  if (typeof record.id !== 'string' || !/^[a-f0-9]{24}$/i.test(record.id)
    || !Number.isSafeInteger(record.generation) || record.generation < 1
    || !Number.isSafeInteger(record.occurrences) || record.occurrences < 1
    || !['critical', 'warning', 'info'].includes(record.severity)
    || !STATUSES.has(record.remediationStatus)) fail('HISTORY_PREVIEW_INVALID_RECORD');
  for (const flag of ['syncRecoveryRequired', 'preservationHold']) if (record[flag] !== undefined && typeof record[flag] !== 'boolean') fail('HISTORY_PREVIEW_INVALID_FLAG');
  const first = timestamp(record.firstDetectedAt), last = timestamp(record.lastDetectedAt);
  if (first > last || last > nowMs) fail('HISTORY_PREVIEW_INCONSISTENT_TIME');
  if (record.syncRecoveryRequired && CLOSED.has(record.remediationStatus)) fail('HISTORY_PREVIEW_CONFLICTING_SYNC_STATE');
  return { id: record.id.toLowerCase(), generation: record.generation, occurrences: record.occurrences,
    severity: record.severity, remediationStatus: record.remediationStatus,
    firstDetectedAt: new Date(first).toISOString(), lastDetectedAt: new Date(last).toISOString(),
    syncRecoveryRequired: record.syncRecoveryRequired === true, preservationHold: record.preservationHold === true };
}
const key = record => record.id + ':' + record.generation;
const newest = (left, right) => Date.parse(right.lastDetectedAt) - Date.parse(left.lastDetectedAt)
  || left.id.localeCompare(right.id) || right.generation - left.generation;

function previewIncidentHistory({ records, incoming = null, policy = null, now, ...extra } = {}) {
  if (Object.keys(extra).length) fail('HISTORY_PREVIEW_UNKNOWN_OPTION');
  const nowMs = timestamp(now);
  if (!Array.isArray(records) || records.length > MAX_PREVIEW_RECORDS) fail('HISTORY_PREVIEW_INPUT_LIMIT');
  if (policy !== null && (!plain(policy) || Object.keys(policy).some(name => !['historyCapacity', 'resolvedRetentionMs'].includes(name)))) fail('HISTORY_PREVIEW_INVALID_POLICY');
  const historyCapacity = policy?.historyCapacity ?? null, resolvedRetentionMs = policy?.resolvedRetentionMs ?? null;
  if (historyCapacity !== null && (!Number.isSafeInteger(historyCapacity) || historyCapacity < 1 || historyCapacity > 100000)) fail('HISTORY_PREVIEW_INVALID_CAPACITY');
  if (resolvedRetentionMs !== null && (!Number.isSafeInteger(resolvedRetentionMs) || resolvedRetentionMs < ACTIVE_WINDOW_MS)) fail('HISTORY_PREVIEW_INVALID_RETENTION');
  const history = records.map(record => normalize(record, nowMs));
  const byKey = new Map();
  const latestGeneration = new Map();
  for (const record of history) {
    if (byKey.has(key(record))) fail('HISTORY_PREVIEW_DUPLICATE_GENERATION');
    byKey.set(key(record), record);
    const previous = latestGeneration.get(record.id);
    if (!previous || record.generation > previous.generation) latestGeneration.set(record.id, record);
  }
  const chronological = [...history].sort((left, right) => left.id.localeCompare(right.id) || left.generation - right.generation);
  for (let index = 1; index < chronological.length; index++) {
    const previous = chronological[index - 1], current = chronological[index];
    if (previous.id === current.id && Date.parse(current.lastDetectedAt) < Date.parse(previous.lastDetectedAt)) fail('HISTORY_PREVIEW_CONFLICTING_GENERATIONS');
  }
  // Current-view projection is separate from the complete supplied history.
  // Only latest generations participate. Pending sync remains visible beyond TTL/cap.
  const latest = [...latestGeneration.values()].sort(newest);
  const recent = latest.filter(record => nowMs - Date.parse(record.lastDetectedAt) <= ACTIVE_WINDOW_MS).slice(0, ACTIVE_LIMIT);
  const visible = [...new Map([...recent, ...latest.filter(record => record.syncRecoveryRequired)].map(record => [record.id, record])).values()].sort(newest);
  const isUnresolved = record => !CLOSED.has(record.remediationStatus);
  const reviewOnly = history.filter(record => resolvedRetentionMs !== null && !isUnresolved(record)
    && !record.preservationHold && nowMs - Date.parse(record.lastDetectedAt) >= resolvedRetentionMs);
  let admission = { status: 'not_requested', canAcknowledgeStored: false };
  if (incoming !== null) {
    const next = normalize(incoming, nowMs), previous = byKey.get(key(next)), latestForId = latestGeneration.get(next.id);
    if (latestForId && next.generation < latestForId.generation) fail('HISTORY_PREVIEW_STALE_GENERATION');
    if (latestForId && next.generation > latestForId.generation
      && Date.parse(next.lastDetectedAt) < Date.parse(latestForId.lastDetectedAt)) fail('HISTORY_PREVIEW_CONFLICTING_GENERATIONS');
    if (previous) {
      if (next.firstDetectedAt !== previous.firstDetectedAt || next.occurrences < previous.occurrences
        || Date.parse(next.lastDetectedAt) < Date.parse(previous.lastDetectedAt)) fail('HISTORY_PREVIEW_CONFLICTING_UPDATE');
      admission = { status: JSON.stringify(previous) === JSON.stringify(next) ? 'duplicate_no_change' : 'existing_generation_requires_transition_validation', canAcknowledgeStored: false };
    } else {
      const full = historyCapacity !== null && history.length >= historyCapacity;
      admission = { status: historyCapacity === null ? 'blocked_policy_undecided' : full
        ? 'blocked_requires_independent_durable_overflow_and_alert' : 'requires_durable_commit_and_transition_validation',
      canAcknowledgeStored: false };
    }
  }
  return {
    schemaVersion: 1, kind: 'incident_history_design_preview', runtimePolicyChanged: false,
    canActivate: false, mutationActions: [],
    candidatePolicy: { historyCapacity, resolvedRetentionMs, ownerDecisionStillRequired: true },
    activeView: { windowMs: ACTIVE_WINDOW_MS, ordinaryLimit: ACTIVE_LIMIT, ids: visible.map(record => record.id), count: visible.length },
    history: { suppliedGenerations: history.length, distinctIncidents: latest.length,
      unresolvedGenerations: history.filter(isUnresolved).length,
      expiredUnresolvedGenerations: history.filter(record => isUnresolved(record) && nowMs - Date.parse(record.lastDetectedAt) > ACTIVE_WINDOW_MS).length,
      preservationHolds: history.filter(record => record.preservationHold).length,
      resolvedOldGenerationsForPolicyReviewOnly: reviewOnly.length,
      capacityState: historyCapacity === null ? 'undecided' : history.length > historyCapacity ? 'over_capacity' : history.length === historyCapacity ? 'full' : 'within_capacity' },
    admission,
    blockers: ['DESIGN_ONLY_NO_RUNTIME_INTEGRATION', 'OWNER_RETENTION_POLICY_NOT_APPROVED', 'DURABLE_STORAGE_AND_OVERFLOW_NOT_PROVEN', 'PRIVACY_AND_ERASURE_BOUNDARIES_NOT_APPROVED'],
  };
}

module.exports = { ACTIVE_LIMIT, ACTIVE_WINDOW_MS, MAX_PREVIEW_RECORDS, previewIncidentHistory };
