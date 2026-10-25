const test = require('node:test');
const assert = require('node:assert/strict');
const { newManifest, recordGate, invalidateGates, assertFreshHealth } = require('../scripts/provider-hardening-evidence');
const { assessSamples, collectReliability } = require('../scripts/verify-provider-reliability');
const { assertIntakeEvidence } = require('../scripts/record-provider-hardening-handoff');
const commit = 'a'.repeat(40);

test('handoff refuses stale, duplicated or real-provider intake evidence', () => {
  const report = { checkedAt: new Date().toISOString(), passed: true, concurrency: true, processRestart: true,
    latestConfirmedValuesOnly: true, crossTenantRejected: true, authenticationRequired: true,
    staleAndLateUpdatesRejected: true, transactionRollbackVerified: true, legacyRetryOwnerSeparated: true,
    productionTouched: false, realProviderRequests: 0, canonicalRecordsForCompletedCall: 1,
    leadsForCompletedCall: 1, notificationHandoffs: 1, fakeProviderAcceptances: 1 };
  assert.doesNotThrow(() => assertIntakeEvidence(report, 0));
  assert.throws(() => assertIntakeEvidence(report, Date.now() + 1000));
  assert.throws(() => assertIntakeEvidence(report, Number.NaN));
  for (const change of [{ leadsForCompletedCall: 2 }, { realProviderRequests: 1 }, { productionTouched: true }, { legacyRetryOwnerSeparated: false }]) {
    assert.throws(() => assertIntakeEvidence({ ...report, ...change }, 0));
  }
});
test('expired or failed live health evidence cannot authorize the next operational stage', () => {
  const manifest = newManifest(commit);
  assert.throws(() => assertFreshHealth(manifest));
  recordGate(manifest, 'health', { status: 'PASS', evidence: 'fixture' });
  assert.doesNotThrow(() => assertFreshHealth(manifest));
  assert.throws(() => assertFreshHealth(manifest, Date.now() + 600001));
  invalidateGates(manifest, ['health'], 'new failed check');
  assert.throws(() => assertFreshHealth(manifest));
});
test('missing prerequisites and unsupported statuses cannot become passing evidence', () => {
  const manifest = newManifest(commit);
  assert.throws(() => recordGate(manifest, 'restore', { status: 'PASS', evidence: 'fixture', prerequisites: ['health'] }));
  assert.throws(() => recordGate(manifest, 'health', { status: 'maybe', evidence: 'fixture' }));
  recordGate(manifest, 'health', { status: 'PASS', evidence: 'fixture' });
  recordGate(manifest, 'restore', { status: 'PASS', evidence: 'fixture', prerequisites: ['health'] });
});
test('changes invalidate earlier affected checks and every dependent gate, preserving unrelated evidence', () => {
  const manifest = newManifest(commit);
  for (const key of ['health', 'funding', 'restore', 'chain', 'intake', 'liveCanary', 'release']) recordGate(manifest, key, { status: 'PASS', evidence: 'fixture' });
  invalidateGates(manifest, ['restore'], 'durable record format changed');
  assert.equal(manifest.gates.health.status, 'PASS');
  assert.equal(manifest.gates.funding.status, 'PASS');
  for (const key of ['restore', 'chain', 'intake', 'liveCanary', 'release']) assert.equal(manifest.gates[key].status, 'STALE');
});
test('healthy worker requires advancing timestamps and the exact release, not a green homepage', () => {
  const samples = [1, 2, 3].map(i => ({ httpStatus: 200, ready: true, releaseCommit: commit,
    worker: { status: 'healthy', lastSuccessfulRunAt: new Date(i * 60000).toISOString(), workerAgeSeconds: 2,
      oldestPendingAgeSeconds: null, counts: { pending: 0, failed: 0, expiredLeases: 0 } } }));
  assert.equal(assessSamples(samples, commit), true);
  samples[0].worker.workerAgeSeconds = null;
  assert.equal(assessSamples(samples, commit), false);
  samples[0].worker.workerAgeSeconds = 2;
  assert.equal(assessSamples(samples, 'b'.repeat(40)), false);
  samples[2].worker.lastSuccessfulRunAt = samples[1].worker.lastSuccessfulRunAt;
  assert.equal(assessSamples(samples, commit), false);
});
test('collector uses GET only, paginates evidence, and keeps 24-hour observation pending', async () => {
  let successes = 0, pages = 0;
  const requests = [];
  const deployedAt = '2026-10-25T04:57:00.000Z';
  const fetchImpl = async (input, options = {}) => {
    assert.equal(options.method || 'GET', 'GET');
    requests.push(String(input));
    const url = new URL(input);
    let body;
    if (url.pathname.endsWith('/deploys')) body = [{ deploy: { status: 'live', commit: { id: commit }, finishedAt: deployedAt } }];
    else if (url.pathname.endsWith('/security-readiness')) body = { ok: true, releaseCommit: commit,
      versions: { bodyParser: '1.20.9', nodemailer: '10.1.4' }, requestCompression: 'rejected-before-body-parsing' };
    else if (url.pathname.endsWith('/ready')) body = { ok: true, releaseCommit: commit };
    else if (url.pathname.endsWith('/operations/health')) body = { issues: [], twilioReceipts: { status: 'healthy',
      lastSuccessfulRunAt: new Date(++successes * 60000).toISOString(), workerAgeSeconds: 1,
      oldestPendingAgeSeconds: null, counts: { pending: 0, failed: 0, expiredLeases: 0 } } };
    else if (url.pathname === '/v1/logs') body = { logs: [], hasMore: pages++ === 0,
      nextStartTime: '2026-10-25T04:58:00Z', nextEndTime: '2026-10-25T05:00:00Z' };
    else body = { ownerId: 'fixture-owner', serviceDetails: { envSpecificDetails: { buildCommand: 'npm ci --include=dev --legacy-peer-deps && npm run backend:prepare' } } };
    return { ok: true, status: 200, json: async () => body };
  };
  const result = await collectReliability({ credentials: { host: 'https://api.render.com/v1', key: 'fixture' },
    token: 'fixture', commit, fetchImpl, wait: async () => {} });
  assert.equal(result.currentHealthPassed, true);
  assert.equal(result.logEvidence[0].pages, 2);
  assert.equal(result.observation.status, 'PENDING_OBSERVATION');
  assert.equal(result.productionWrites, 0);
  assert.ok(requests.every(url => !/acknowledge|retry|provisioning-canary/.test(url)));
});
