// Uses only the existing injected monitor key. No env files or provider/admin credentials.
const { parseQuery, ENDINGS, STATUSES } = require('../server/callRecordVerification');
const URL_BASE = 'https://api.myaipa.ca/api/internal/operations/call-record-verification';
class VerificationError extends Error {
  constructor(category, message) { super(message); this.category = category; }
}
function failureReport(error) {
  return { readOnly: true, verification: 'unknown', savedRecordVerified: false,
    failureCategory: error instanceof VerificationError ? error.category : 'verification_unavailable' };
}
const allowedChecks = { providerRecord: ['verified', 'not_found', 'conflict', 'unknown'], businessOwnership: ['verified', 'mismatch', 'unknown'],
  carrierIdentity: ['verified', 'conflict', 'unknown'], savedCompletion: ['verified', 'not_completed', 'unknown'] };
function safeReport(data, ref) {
  if (!data || data.schemaVersion !== 1 || data.readOnly !== true || data.evidence !== 'saved_call_record'
    || data.liveProviderVerified !== false || data.callRef !== ref || typeof data.savedRecordVerified !== 'boolean'
    || !data.checks || Object.keys(data.checks).length !== 4
    || !Object.entries(allowedChecks).every(([key, values]) => values.includes(data.checks[key]))) throw Error('Unrecognized verification response.');
  const checks = Object.fromEntries(Object.keys(allowedChecks).map(key => [key, data.checks[key]]));
  let record = null;
  if (data.record != null) {
    const row = data.record;
    const date = v => v === null || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
      && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
    if ((!STATUSES.has(row.status) && row.status !== 'unknown') || (!ENDINGS.has(row.endedReason) && row.endedReason !== 'unknown')
      || !(row.durationSec === null || Number.isSafeInteger(row.durationSec) && row.durationSec >= 0 && row.durationSec <= 86400)
      || !date(row.startedAt) || !date(row.endedAt) || typeof row.callerLinked !== 'boolean') throw Error('Unrecognized saved metadata.');
    record = { status: row.status, endedReason: row.endedReason, durationSec: row.durationSec,
      startedAt: row.startedAt, endedAt: row.endedAt, callerLinked: row.callerLinked };
  }
  const verified = Object.values(checks).every(v => v === 'verified');
  if (data.savedRecordVerified !== verified || verified && (!record || record.status !== 'COMPLETED'
    || !(record.durationSec > 0) || !record.callerLinked || !['customer-ended-call', 'assistant-ended-call'].includes(record.endedReason)
    || !record.startedAt || !record.endedAt || Date.parse(record.endedAt) <= Date.parse(record.startedAt)
    || Math.abs(record.durationSec - (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000) > 2)) throw Error('Inconsistent verification response.');
  return { schemaVersion: 1, readOnly: true, evidence: 'saved_call_record', callRef: ref,
    releaseCommit: typeof data.releaseCommit === 'string' && /^[a-f0-9]{40}$/.test(data.releaseCommit) ? data.releaseCommit : 'unknown',
    savedRecordVerified: verified, checks, record, liveProviderVerified: false };
}
async function run({ env = process.env, fetchImpl = fetch } = {}) {
  let input;
  try { input = parseQuery({ callRef: env.CALL_REF, businessRef: env.BUSINESS_REF }); }
  catch (_) { throw new VerificationError('invalid_input', 'Exact call and business identifiers are required.'); }
  if (!env.MONITOR_API_KEY) throw new VerificationError('authentication_unavailable', 'Monitor authentication is unavailable.');
  const url = new URL(URL_BASE);
  url.searchParams.set('callRef', input.callRef); url.searchParams.set('businessRef', input.businessRef);
  let response;
  try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${env.MONITOR_API_KEY}`, accept: 'application/json' } }); }
  catch (_) { throw new VerificationError('network_unavailable', 'The verification request could not complete.'); }
  if (!response.ok) {
    const category = [401, 403].includes(response.status) ? 'authentication_unavailable'
      : response.status === 404 ? 'endpoint_unavailable' : response.status === 429 ? 'rate_limited' : 'service_unavailable';
    throw new VerificationError(category, `Read-only verification returned HTTP ${response.status}; result unknown.`);
  }
  try { return safeReport(await response.json(), input.callRef); }
  catch (_) { throw new VerificationError('invalid_response', 'The saved-state response could not be verified.'); }
}
function publicSummary(report) {
  const checks = Object.fromEntries(Object.entries(allowedChecks).map(([key, values]) =>
    [key, values.includes(report?.checks?.[key]) ? report.checks[key] : 'unknown']));
  return { schemaVersion: 1, readOnly: true, evidence: 'saved_call_record',
    savedRecordVerified: report?.savedRecordVerified === true && Object.values(checks).every(value => value === 'verified'),
    checks, liveProviderVerified: false };
}
if (require.main === module) run().then(report => { console.log(JSON.stringify(publicSummary(report), null, 2)); if (!report.savedRecordVerified) process.exitCode = 2; })
  .catch(error => { console.error(JSON.stringify(failureReport(error))); process.exitCode = 1; });
module.exports = { run, safeReport, failureReport, publicSummary };
