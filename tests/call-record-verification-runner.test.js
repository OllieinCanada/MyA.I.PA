const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectCallRecord, makeReferences } = require('../server/callRecordVerification');
const { run, safeReport, failureReport, publicSummary } = require('../scripts/verify-saved-call-record');
const callId = '12345678-1234-7000-8000-123456789abc';
const query = makeReferences(callId, 37);
const env = { CALL_REF: query.callRef, BUSINESS_REF: query.businessRef, MONITOR_API_KEY: 'synthetic-monitor-key' };
async function report() {
  return inspectCallRecord({ query, prisma: { $transaction: async fn => fn({
    $executeRawUnsafe: async () => {}, call: { count: async () => 1, findMany: async () => [{
      externalId: callId, id: 1, businessId: 37, callerId: 2, status: 'COMPLETED', durationSec: 10,
      startedAt: new Date('2026-10-26T17:00:00Z'), endedAt: new Date('2026-10-26T17:00:10Z'),
      endedReason: 'assistant-ended-call', twilioCallSid: 'CA' + '2'.repeat(32),
    }] },
  }) } });
}
test('runner makes exactly one fixed-host GET using existing injected authentication and no redirects', async () => {
  const data = await report(); let calls = 0;
  const result = await run({ env, fetchImpl: async (url, options) => {
    calls++; assert.equal(url.origin, 'https://api.myaipa.ca');
    assert.equal(url.pathname, '/api/internal/operations/call-record-verification');
    assert.equal(url.searchParams.get('callRef'), query.callRef); assert.equal(url.searchParams.get('businessRef'), query.businessRef);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer synthetic-monitor-key'); return { ok: true, json: async () => data };
  } });
  assert.equal(calls, 1); assert.equal(result.savedRecordVerified, true); assert.equal(result.liveProviderVerified, false);
});
test('missing authentication or malformed arguments stop before network I/O', async () => {
  for (const change of [{ MONITOR_API_KEY: '' }, { CALL_REF: 'all' }, { BUSINESS_REF: '37;curl bad' }]) {
    await assert.rejects(run({ env: { ...env, ...change }, fetchImpl: () => assert.fail('No network request allowed') }));
  }
});
test('HTTP errors remain unknown and their response bodies are never inspected or printed', async () => {
  await assert.rejects(run({ env, fetchImpl: async () => ({ ok: false, status: 401,
    json: () => assert.fail('No raw response body') }) }), /HTTP 401/);
});
test('access and network failures are classified without exporting raw errors or credentials', async () => {
  for (const [status, category] of [[401, 'authentication_unavailable'], [404, 'endpoint_unavailable'], [503, 'service_unavailable']]) {
    try { await run({ env, fetchImpl: async () => ({ ok: false, status }) }); assert.fail('Expected an unavailable check'); }
    catch (error) { assert.equal(failureReport(error).failureCategory, category); }
  }
  try { await run({ env, fetchImpl: async () => { throw Error('PRIVATE_CONNECTION_AND_TOKEN'); } }); assert.fail('Expected a network failure'); }
  catch (error) { assert.equal(failureReport(error).failureCategory, 'network_unavailable'); assert.doesNotMatch(JSON.stringify(failureReport(error)), /PRIVATE/); }
  assert.doesNotMatch(JSON.stringify(failureReport(Error('PRIVATE_CREDENTIAL'))), /PRIVATE/);
});
test('runner omits unexpected response fields and refuses inconsistent success or unsafe metadata', async () => {
  const good = await report();
  assert.doesNotMatch(JSON.stringify(safeReport({ ...good, token: 'PRIVATE_TOKEN', record: { ...good.record, transcript: 'PRIVATE_TRANSCRIPT' } }, query.callRef)), /PRIVATE|token|transcript/);
  for (const bad of [{ ...good, callRef: '0'.repeat(64) }, { ...good, liveProviderVerified: true },
    { ...good, savedRecordVerified: false }, { ...good, record: null },
    { ...good, record: { ...good.record, durationSec: 9999 } },
    { ...good, record: { ...good.record, endedReason: 'PRIVATE_REASON' } },
    { ...good, checks: { ...good.checks, businessOwnership: 'unknown' } }]) assert.throws(() => safeReport(bad, query.callRef));
});
test('missing saved data stays a failing verification result rather than a passing empty report', async () => {
  const good = await report(); const result = safeReport({ ...good, savedRecordVerified: false, record: null,
    checks: { providerRecord: 'not_found', businessOwnership: 'unknown', carrierIdentity: 'unknown', savedCompletion: 'unknown' } }, query.callRef);
  assert.equal(result.savedRecordVerified, false);
});
test('production workflow is manual, main-only, read-permission and uses existing monitor injection', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/verify-saved-call.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /contents: read/); assert.match(workflow, /secrets\.MONITOR_API_KEY/);
  assert.doesNotMatch(workflow, /pull_request:|schedule:|push:|contents: write|ADMIN_PASSWORD|VAPI_API_KEY|TWILIO_AUTH_TOKEN|\$\{\{ inputs\.[^}]+\}\}.*\n.*curl/);
});

test('public workflow output includes only anonymous checks, without references or per-call metadata', async () => {
  const data = await report(); const output = publicSummary(safeReport(data, query.callRef));
  assert.equal(output.savedRecordVerified, true);
  assert.deepEqual(Object.keys(output), ['schemaVersion', 'readOnly', 'evidence', 'savedRecordVerified', 'checks', 'liveProviderVerified']);
  assert.doesNotMatch(JSON.stringify(output), /12345678|2026-|duration|startedAt|callRef|businessRef|[a-f0-9]{64}/);
  assert.doesNotMatch(JSON.stringify(publicSummary({ savedRecordVerified: 'PRIVATE_VALUE', checks: { providerRecord: 'PRIVATE_VALUE' } })), /PRIVATE/);
});
