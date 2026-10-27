// Metadata only. Never run a worker, prune incidents, fetch a provider or expose payloads.
const { inspectReceiptState } = require('./twilioReceiptInspection');
const SMS_WORKFLOW = 'saved Twilio delivery reports background job';
const REASONS = new Set(['DATABASE_QUERY_IMPLEMENTATION_FAILED', 'DATABASE_TRANSACTION_TIMEOUT',
  'DATABASE_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_CONNECTION_FAILED', 'PROVIDER_UNAVAILABLE',
  'VAPI_CALL_SYNC_DELAYED', 'VOICE_ASSISTANT_REQUEST_DEADLINE', 'VOICE_TRIAL_RESERVATION_BUSY',
  'VOICE_ASSISTANT_SELECTION_FAILED', 'VOICE_ROUTE_IDENTITY_UNPROVEN', 'CALL_RECORD_IDENTITY_CONFLICT',
  'CALL_RECORD_DUPLICATE_WRITE_FAILED', 'SMS_CONFIRMATION_REJECTED', 'CALL_NOTIFICATION_UNCONFIRMED',
  'MESSAGE_DELIVERY_FAILED']);
const CODES = new Set(['P2028', 'P2034', 'P1001', 'P1002', 'P1017', '40001', '40P01', '55P03',
  'ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'TWILIO_RECEIPT_PROCESSING_FAILED',
  'TWILIO_WORKER_LEASE_LOST', 'TWILIO_WORKER_FAILED']);
const WORKFLOWS = new Set([SMS_WORKFLOW, 'Vapi call sync background job', 'AI call setup', 'call notifications',
  'API process crash', 'website browser']);
const REMEDIATIONS = new Set(['queued', 'repairing', 'verifying', 'resolved', 'recovered',
  'repair_dispatched', 'repair_ready', 'needs_user', 'failed', 'not_required']);
const JOB_STATES = new Set(['pending', 'processing', 'completed', 'failed']);
const DELIVERY_STATES = new Set(['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered',
  'read', 'failed', 'undelivered', 'canceled']);
const integer = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000 ? n : null;
function iso(value) {
  const s = value instanceof Date ? value.toISOString() : value;
  return typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)
    && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s ? s : null;
}
function incident(row) {
  if (!/^[a-f0-9]{24}$/.test(row?.id || '')) throw Error('Unknown incident metadata');
  return { id: row.id, severity: ['critical', 'warning'].includes(row.severity) ? row.severity : 'unknown',
    reasonCode: REASONS.has(row.reasonCode) ? row.reasonCode : 'unknown',
    remediation: REMEDIATIONS.has(row.remediation) ? row.remediation : 'unknown',
    occurrences: integer(row.occurrences), firstDetectedAt: iso(row.firstDetectedAt), lastDetectedAt: iso(row.lastDetectedAt),
    workflow: WORKFLOWS.has(row.workflow) ? row.workflow : 'unknown',
    providerCode: CODES.has(row.providerCode) ? row.providerCode : null,
    underlyingCode: CODES.has(row.underlyingCode) || REASONS.has(row.underlyingCode) ? row.underlyingCode : null,
    releaseCommit: /^[a-f0-9]{40}$/.test(row.releaseCommit || '') ? row.releaseCommit : null,
    route: row.route === '/api/webhooks/voice' ? row.route : null };
}
function job(row) {
  const out = { jobRef: /^[a-f0-9]{64}$/.test(row?.jobRef || '') ? row.jobRef : null,
    jobState: JOB_STATES.has(row?.jobState) ? row.jobState : 'unknown',
    reportedDeliveryState: DELIVERY_STATES.has(row?.reportedDeliveryState) ? row.reportedDeliveryState : 'unknown',
    attempts: integer(row?.attempts), lastErrorCode: row?.lastErrorCode === null ? null
      : CODES.has(row?.lastErrorCode) ? row.lastErrorCode : 'unknown' };
  for (const key of ['receivedAt', 'completedAt', 'createdAt', 'lastUpdatedAt', 'leaseExpiresAt', 'nextAttemptAt']) out[key] = iso(row?.[key]);
  return out;
}
// Apply the same allowlist again at the CLI boundary: extra response fields are never logged.
function projectEvidence(data) {
  if (data?.schemaVersion !== 1 || data.readOnly !== true || !Array.isArray(data.incidents)
    || data.incidents.length > 20 || !Array.isArray(data.receiptWindows) || data.receiptWindows.length > 8
    || typeof data.incidentsTruncated !== 'boolean' || typeof data.receiptWindowsTruncated !== 'boolean') throw Error('Unknown incident evidence');
  const incidents = data.incidents.map(incident);
  const receiptWindows = data.receiptWindows.map(w => {
    if (!incidents.some(i => i.id === w.incidentId && i.workflow === SMS_WORKFLOW)
      || !['first_detected', 'last_detected'].includes(w.anchor) || !iso(w.from) || !iso(w.to)
      || Date.parse(w.to) - Date.parse(w.from) !== 120000 || !Array.isArray(w.jobs) || w.jobs.length > 25
      || typeof w.hasMore !== 'boolean' || typeof w.metadataComplete !== 'boolean') throw Error('Unknown receipt candidates');
    const jobs = w.jobs.map(job);
    const complete = jobs.length > 0 && jobs.every(j => j.jobRef && j.jobState !== 'unknown'
      && j.reportedDeliveryState !== 'unknown' && j.attempts !== null && j.receivedAt && j.createdAt
      && j.lastUpdatedAt && j.lastErrorCode !== 'unknown'
      && (j.jobState !== 'completed' || j.completedAt)
      && (j.jobState !== 'failed' || j.lastErrorCode)
      && (j.jobState !== 'pending' || j.nextAttemptAt)
      && (j.jobState !== 'processing' || j.leaseExpiresAt));
    return { incidentId: w.incidentId, anchor: w.anchor, from: w.from, to: w.to,
      correlation: 'time_window_candidates_only', jobs, hasMore: w.hasMore,
      metadataComplete: w.metadataComplete && complete };
  });
  return { schemaVersion: 1, readOnly: true, incidents, incidentsTruncated: data.incidentsTruncated,
    receiptWindowsTruncated: data.receiptWindowsTruncated, receiptWindows,
    historicalCoverage: 'not_an_audit_trail', originalOperationOutcomes: 'unknown',
    providerDeliveryVerified: false, incidentClosurePermitted: false };
}
async function inspectEvidence(tx) {
  // Static SQL projects only permitted JSON scalars; complete incident payloads never leave the database.
  const rows = await tx.$queryRaw`SELECT id, severity, "reasonCode", remediation,
    "recurrenceCount" AS occurrences, "firstDetectedAt", "lastDetectedAt",
    payload #>> '{snapshot,Workflow}' AS workflow,
    payload #>> '{snapshot,Provider code}' AS "providerCode",
    payload #>> '{snapshot,Underlying code}' AS "underlyingCode",
    payload #>> '{snapshot,Release}' AS "releaseCommit", payload #>> '{snapshot,Route}' AS route
    FROM "RuntimeIncidentRecord" WHERE
      (severity = 'critical' AND remediation NOT IN ('resolved', 'recovered', 'not_required'))
      OR ("reasonCode" IN ('DATABASE_QUERY_IMPLEMENTATION_FAILED', 'PROVIDER_TIMEOUT')
        AND payload #>> '{snapshot,Workflow}' = 'saved Twilio delivery reports background job')
    ORDER BY "lastDetectedAt" DESC, id ASC LIMIT 21`;
  if (!Array.isArray(rows) || rows.length > 21) throw Error('Unknown incident rows');
  const incidents = rows.slice(0, 20).map(incident), receiptWindows = [];
  const historical = incidents.filter(i => i.workflow === SMS_WORKFLOW);
  for (const i of historical.slice(0, 4)) {
    const anchors = [['first_detected', i.firstDetectedAt], ['last_detected', i.lastDetectedAt]];
    for (const [anchor, at] of anchors) {
      if (!at || (anchor === 'last_detected' && at === i.firstDetectedAt)) continue;
      const from = new Date(Date.parse(at) - 60000).toISOString(), to = new Date(Date.parse(at) + 60000).toISOString();
      const candidates = await inspectReceiptState({ prisma: tx, query: { from, to } });
      receiptWindows.push({ incidentId: i.id, anchor, from, to, jobs: candidates.jobs,
        hasMore: candidates.pagination.hasMore, metadataComplete: candidates.metadataComplete });
    }
  }
  return projectEvidence({ schemaVersion: 1, readOnly: true, incidents, incidentsTruncated: rows.length > 20,
    receiptWindowsTruncated: historical.length > 4, receiptWindows });
}
module.exports = { inspectEvidence, projectEvidence };
