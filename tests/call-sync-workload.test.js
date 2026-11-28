'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCallSyncWorkload } = require('../server/callSyncWorkload');
const { createFixture } = require('./helpers/call-sync-workload-fixture');
const { completeSync } = require('../server/callSyncHealth');
const instant = { wait: async () => {} };

test('actual sweep skips unchanged terminal writes, not fresh details, routing, identity or request linking', async () => {
  const f = createFixture({ count: 3, policy: instant });
  const first = await f.run(), second = await f.run();
  assert.equal(first.rewritten, 3); assert.equal(second.unchanged, 3); assert.equal(second.rewritten, 0);
  assert.equal(second.synced, 3); assert.equal(completeSync(second), true);
  assert.deepEqual(f.counts, { reads: 6, details: 6, writes: 3, usage: 3, requestLinks: 6, fileWrites: 1, pauses: 6 });
});

test('late transcripts, notification artifacts and cost changes are noticed without relying on updatedAt', async () => {
  const f = createFixture({ policy: instant }); await f.run();
  for (const patch of [{ transcript: 'Updated synthetic transcript' }, { artifact: { messages: [{ role: 'tool', content: 'invented' }] } }, { cost: 0.25 }]) {
    Object.assign(f.calls[0], patch);
    assert.equal((await f.run()).rewritten, 1);
    assert.equal((await f.run()).unchanged, 1);
  }
  assert.equal(f.counts.writes, 4);
});

test('manual limited sync and live webhook upserts bypass pacing/deduplication and invalidate the old stamp', async () => {
  const f = createFixture({ policy: instant }); await f.run();
  assert.equal((await f.run({ limit: 1 })).rewritten, 1);
  assert.equal(f.counts.pauses, 1);
  assert.equal((await f.run()).rewritten, 1);
  await f.context.upsertVapiCall(f.calls[0], {});
  assert.equal(f.counts.pauses, 2);
  assert.equal((await f.run()).rewritten, 1);
});

test('missing/edited DB rows and changed canonical business routing cannot use a cached success', async () => {
  const f = createFixture({ policy: instant }); await f.run();
  f.rows.get(f.calls[0].id).transcript = null;
  assert.equal((await f.run()).rewritten, 1);
  f.rows.delete(f.calls[0].id);
  assert.equal((await f.run()).rewritten, 1);
  f.setRouteError(true);
  const quarantined = await f.run();
  assert.equal(quarantined.unchanged, 0); assert.equal(quarantined.routingErrors.length, 1);
  assert.equal(completeSync(quarantined), false);
  f.setRouteError(false); f.calls[0].businessId = 8;
  await assert.rejects(f.run(), { code: 'CALL_RECORD_IDENTITY_CONFLICT' });
});

test('failed trial usage is not certified: retry reconciles even after the Call write already committed', async () => {
  const f = createFixture({ policy: instant }); f.setUsageError(true);
  await assert.rejects(f.run(), { code: 'P2028' });
  f.setUsageError(false);
  assert.equal((await f.run()).rewritten, 1);
  assert.equal(f.counts.usage, 2);
  assert.equal((await f.run()).unchanged, 1);
});

test('failed fresh detail reads cannot use or seed cached completion, and incomplete requests still get repaired', async () => {
  const f = createFixture({ policy: instant }); await f.run(); f.setDetailError(true);
  const failed = await f.run();
  assert.equal(failed.unchanged, 0); assert.equal(failed.detailErrors.length, 1); assert.equal(completeSync(failed), false);
  f.setDetailError(false); f.setLinkError(true);
  assert.equal((await f.run()).rewritten, 1);
  f.setLinkError(false);
  assert.equal((await f.run()).rewritten, 1);
  assert.equal((await f.run()).unchanged, 1);
  f.setLinkError(true);
  await assert.rejects(f.run(), { code: 'notification_request_store_unavailable' });
});

test('active calls are never cached, even if unchanged', async () => {
  const f = createFixture({ policy: instant }); f.calls[0].status = 'in-progress';
  for (let i = 0; i < 3; i++) assert.equal((await f.run()).unchanged, 0);
  assert.equal(f.counts.writes, 3);
});

test('a missing fresh detail object cannot authorize a cache hit or seed a new stamp', async () => {
  const f = createFixture({ policy: instant }); await f.run();
  f.setMissingDetail(true);
  assert.equal((await f.run()).rewritten, 1);
  assert.equal((await f.run()).rewritten, 1);
  f.setMissingDetail(false);
  assert.equal((await f.run()).rewritten, 1);
  assert.equal((await f.run()).unchanged, 1);
});

test('file-save failure cannot certify a cached sweep', async () => {
  const f = createFixture({ policy: instant }); f.setFileError(true);
  await assert.rejects(f.run(), { code: 'ENOSPC' });
  f.setFileError(false);
  assert.equal((await f.run()).rewritten, 1);
  assert.equal((await f.run()).unchanged, 1);
});

test('paced sweep file merge preserves other webhook rows and newer same-call observations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const start = source.indexOf('function writeVapiCallSyncStore('), end = source.indexOf('function getWebhookReplayKey(', start);
  assert.ok(start >= 0 && end > start);
  const row = (at, id) => ({ syncedAt: `2026-11-01T12:00:0${at}.000Z`, localCallId: id });
  let saved;
  const context = { Date, vapiCallSyncPath: 'unused',
    readVapiCallSyncStore: () => ({ otherWebhook: row(2, 2), same: row(3, 3), edited: row(0, 4) }),
    fs: { writeFileSync: (_, text) => { saved = JSON.parse(text); } } };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  context.writeVapiCallSyncStore({ same: row(1, 1), edited: row(4, 4), untouchedStale: row(0, 5) }, ['same', 'edited']);
  assert.deepEqual(saved, { otherWebhook: row(2, 2), same: row(3, 3), edited: row(4, 4) });
});

test('cache expires without sliding on hits, refuses clock rollback, and is safe to lose on restart', async () => {
  let clock = 1000;
  const f = createFixture({ policy: { ...instant, now: () => clock, maxAgeMs: 100 } });
  await f.run(); clock = 1050; assert.equal((await f.run()).unchanged, 1);
  clock = 1100; assert.equal((await f.run()).rewritten, 1);
  clock = 1099; assert.equal((await f.run()).rewritten, 1);
  const fresh = createCallSyncWorkload(instant);
  assert.equal(fresh.unchanged(f.calls[0], f.rows.get(f.calls[0].id)), false);
});

test('bounded cache evicts and stores no raw provider/customer data or reusable completion receipts', () => {
  const w = createCallSyncWorkload({ ...instant, maxEntries: 1 });
  const call = id => ({ id, status: 'ended', endedAt: '2026-11-01', transcript: 'private synthetic text' });
  const row = id => ({ id: 1, externalId: id, externalProvider: 'vapi', status: 'COMPLETED' });
  for (const id of ['one', 'two']) { const result = {}; w.stage(call(id), row(id), result); w.commit(result); }
  assert.equal(w.unchanged(call('one'), row('one')), false);
  assert.equal(w.unchanged(call('two'), row('two')), true);
  assert.doesNotMatch(JSON.stringify(w), /private synthetic text/);
  for (const options of [{ pauseMs: 0 }, { pauseMs: 1001 }, { maxEntries: 1001 }, { maxAgeMs: Infinity }]) assert.throws(() => createCallSyncWorkload(options));
});

test('production default yields 100ms per history record and postpones only the initial history sweep', async () => {
  const waits = [], w = createCallSyncWorkload({ wait: async ms => waits.push(ms) });
  await w.pace(); await w.pace(); assert.deepEqual(waits, [100, 100]);
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.match(source, /setTimeout\(\(\) => runBackgroundJob\("Vapi call sync", syncVapiCalls, "initial"\), 30_000\)/);
  const webhook = source.slice(source.indexOf('async function ingestVapiEndOfCallReport'), source.indexOf('async function syncVapiCalls'));
  assert.doesNotMatch(webhook, /pace\(|skipUnchanged:\s*true|setTimeout/);
});
