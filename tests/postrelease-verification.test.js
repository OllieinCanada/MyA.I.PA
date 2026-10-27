const test = require('node:test');
const assert = require('node:assert/strict');
const { KEY, completion, saveCompletion, inspectCompletion } = require('../server/callSyncReceipt');
const { createCallSyncMonitor } = require('../server/callSyncHealth');
const { inspectPostRelease } = require('../server/postReleaseVerification');
const { run, project } = require('../scripts/verify-postrelease');
const sha = 'a'.repeat(40), now = Date.parse('2026-10-27T03:30:00Z');
const receipt = () => completion({ releaseCommit: sha, startedAt: new Date(now - 5000).toISOString(),
  completedAt: new Date(now - 1000).toISOString(), fetched: 2, synced: 1, skippedUnmapped: 1 });
const good = () => ({ fetched: 2, synced: 1, detailErrors: [], routingErrors: [{}] });

test('every complete scheduled run records only finite completion metadata without prior incidents', async () => {
  const seen = [];
  const monitor = createCallSyncMonitor({ listIncidents: async () => [], notifyFailure: async () => ({}),
    recoverIncident: async () => assert.fail('no incident to recover'), now: () => now,
    recordCompletion: async r => seen.push(r) });
  await monitor(async () => ({ ...good(), results: [{ privateCustomer: 'DO_NOT_EXPORT' }] }));
  assert.equal(seen.length, 1); assert.equal(seen[0].synced, 1);
  assert.doesNotMatch(JSON.stringify(seen), /DO_NOT_EXPORT|results|privateCustomer/);
  await monitor(async () => ({ ...good(), detailErrors: [{}] }));
  await assert.rejects(monitor(async () => { throw Error('synthetic'); }));
  assert.equal(seen.length, 1, 'partial/failed runs must never record completion');
});
test('evidence storage failure does not replay or change the successful sync result', async () => {
  let calls = 0, logs = 0;
  const monitor = createCallSyncMonitor({ listIncidents: async () => [], notifyFailure: async () => ({}),
    recoverIncident: async () => {}, recordCompletion: async () => { throw Error('SECRET'); },
    log: (message, fields) => { logs++; assert.doesNotMatch(JSON.stringify([message, fields]), /SECRET/); } });
  const result = await monitor(async () => { calls++; return good(); });
  assert.equal(result.synced, 1); assert.equal(calls, 1); assert.equal(logs, 1);
});
test('missing, empty, stale, previous-release and future evidence never pass', () => {
  assert.equal(inspectCompletion(receipt(), sha, now).completedOnRelease, true);
  for (const [data, release, clock] of [[null, sha, now], [{ ...receipt(), schemaVersion: 2 }, sha, now],
    [{ ...receipt(), fetched: 0, synced: 0, skippedUnmapped: 0 }, sha, now],
    [receipt(), 'b'.repeat(40), now], [receipt(), sha, now + 1800000], [receipt(), sha, now - 10000],
    [{ ...receipt(), fetched: 99 }, sha, now]]) assert.equal(inspectCompletion(data, release, clock).completedOnRelease, false);
});
test('completion persistence writes only one bounded metadata key', async () => {
  let writes = 0;
  const prisma = { $transaction: async (fn, options) => {
    assert.deepEqual(options, { maxWait: 500, timeout: 1500 });
    return fn({ $executeRawUnsafe: async () => {}, runtimeStore: { upsert: async args => {
      writes++; assert.equal(args.where.key, KEY); assert.deepEqual(args.create.data, receipt());
    } } });
  } };
  await saveCompletion({ prisma, ...receipt(), privateValue: 'SECRET' });
  assert.equal(writes, 1);
  await assert.rejects(saveCompletion({ prisma, ...receipt(), fetched: -1 })); assert.equal(writes, 1);
});
function database({ data = receipt(), failures = 0, historical = 2, healthError = false } = {}) {
  const commands = [];
  return { commands, prisma: { $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, 'RepeatableRead');
    return fn({ $executeRawUnsafe: async command => commands.push(command),
      $queryRaw: async () => { if (healthError) throw Error('SECRET'); return [{ pending: 0, processing: 0, completed: 3, failed: 0, expiredLeases: 0 }]; },
      runtimeStore: { findUnique: async ({ where }) => where.key === KEY ? { data } : { data: { lastSuccessfulRunAt: now } } },
      runtimeIncidentRecord: { count: async ({ where }) => where.reasonCode ? historical : where.payload ? failures : 4 },
    });
  } } };
}
test('probe is a read-only snapshot; healthy callbacks cannot reconcile historical outcomes', async () => {
  const f = database(); const r = await inspectPostRelease({ prisma: f.prisma, releaseCommit: sha, now });
  assert.equal(f.commands[0], 'SET TRANSACTION READ ONLY'); assert.equal(r.sync.completedOnRelease, true);
  assert.equal(r.sms.workerStatus, 'healthy'); assert.equal(r.sms.historicalIncidentCount, 2);
  assert.equal(r.sms.originalOperationOutcomes, 'unknown'); assert.equal(r.sms.providerDeliveryVerified, false);
  assert.equal(r.sms.incidentClosurePermitted, false); assert.equal(r.runtime.activeCriticalCount, 4);
  assert.doesNotMatch(JSON.stringify(r), /MessageSid|businessName|phone|SECRET/);
});
test('newer unresolved sync failures and missing receipt data remain unverified', async () => {
  const f = database({ failures: 1, healthError: true });
  const r = await inspectPostRelease({ prisma: f.prisma, releaseCommit: sha, now });
  assert.equal(r.sync.status, 'unresolved_failure'); assert.equal(r.sync.completedOnRelease, false);
  assert.equal(r.sms.workerStatus, 'unavailable');
});
test('client makes one fixed GET without redirects, environment files or actions, and strips extra data', async () => {
  const f = database(); const payload = await inspectPostRelease({ prisma: f.prisma, releaseCommit: sha, now });
  let calls = 0;
  const r = await run({ env: { MONITOR_API_KEY: 'synthetic' }, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.myaipa.ca/api/internal/operations/postrelease-verification');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ ...payload, SECRET: 'PRIVATE_CUSTOMER' }) };
  } });
  assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(r), /SECRET|PRIVATE_CUSTOMER/);
  assert.throws(() => project({ ...payload, sync: { status: 'verified', completedOnRelease: true } }));
  await assert.rejects(run({ env: {}, fetchImpl: async () => assert.fail('must not request without auth') }));
});
