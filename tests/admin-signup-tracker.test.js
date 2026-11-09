const test = require('node:test');
const assert = require('node:assert/strict');
const { STALL_MS, activity, checkpoint, progressSignature, trackProgress, trackerRow, dashboard, businessInfo, infoRevision, validateInfo, updateInfo, createStallProcessor, applyTrackerChange, createTrackerBatchSaver, episodeKey, stallMessage } = require('../server/adminSignupTracker');
const at = Date.parse('2026-11-06T17:00:00Z');
const id = 'signup_' + 'a'.repeat(32);
const fixture = extra => ({ signupAttemptId: id, businessName: 'Example Electrical', status: 'setup_started', signedUpAt: new Date(at).toISOString(), identityVerified: true, ...extra });
function store(records, start = at) {
  let now = start;
  const state = new Map(records.map(r => [r.signupAttemptId, r]));
  return { list: () => [...state.values()], setNow: n => { now = n; }, saveMany: changes => {
    for (const change of changes) { const previous = state.get(change.attemptId); if (previous) state.set(change.attemptId, applyTrackerChange(previous, change, now)); }
  }, save: record => {
    const previous = state.get(record.signupAttemptId) || {};
    const next = { ...record, onboardingTracker: trackProgress(previous, record, now) };
    state.set(record.signupAttemptId, next); return next;
  } };
}
test('explicit active setup, customer-wait and inactive statuses are separated', () => {
  for (const status of ['signup_received', 'setup_started', 'provisioning', 'provisioning_pending', 'provisioning_unknown', 'agent_testing', 'setup_error', 'review_required', 'checkout_started', 'checkout_completed']) assert.equal(activity(fixture({ status })), 'working', status);
  for (const status of ['pending_verification', 'pending_email_verification']) assert.equal(activity(fixture({ status })), 'waiting_customer');
  for (const extra of [{ status: 'setup_ready' }, { status: 'business_exists' }]) assert.equal(activity(fixture(extra)), 'ready');
  for (const extra of [{ status: 'subscription_paused' }, { subscriptionStatus: 'paused' }, { pausedAt: 'now' }, { intakePaused: true }]) assert.equal(activity(fixture(extra)), 'paused');
  for (const extra of [{ status: 'archived' }, { supersededAt: 'now' }, { canonicalSignupAttemptId: 'other' }, { archivedAt: 'now' }]) assert.equal(activity(fixture(extra)), 'closed');
  assert.equal(activity(fixture({ status: 'subscription_trialing' })), 'inactive');
  assert.equal(activity(fixture({ status: 'future_unknown' })), 'inactive');
});
test('customer verification waiting is visible and counts toward the requested heads-up, not proof of technical failure', () => {
  const r = fixture({ status: 'pending_verification' }); r.onboardingTracker = trackProgress({}, r, at);
  const row = trackerRow(r, at + STALL_MS);
  assert.equal(row.stalled, true); assert.equal(row.mode, 'waiting_customer');
  assert.match(stallMessage(row, new Date(at).toISOString()), /not proof of a technical failure/);
});
test('new registration is a real progress event; ten-minute boundary is inclusive', () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at);
  assert.equal(r.onboardingTracker.lastProgressAt, new Date(at).toISOString());
  assert.equal(trackerRow(r, at + STALL_MS - 1).stalled, false);
  assert.equal(trackerRow(r, at + STALL_MS).stalled, true);
  assert.equal(trackerRow(r, at - 1).elapsedMs, 0);
});
test('polling, bookkeeping, unrelated edits and generic updatedAt never reset progress', () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at);
  for (const extra of [{ updatedAt: new Date(at + 100000).toISOString() }, { agentTestPolledAt: 'now' }, { setupFollowupSmsPolledAt: 'now' }, { onboardingStallAlertQueuedAt: 'now', onboardingStallAlertRevision: 1 }, { serviceArea: 'New area', businessAddress: 'New address', adminBusinessInfoSavedAt: 'now' }, { vapiCost: 99 }, { status: 'setup_error', phoneProvisioningCode: 'PROVIDER_FAILED' }]) {
    const next = { ...r, ...extra };
    assert.equal(progressSignature(next), progressSignature(r));
    assert.deepEqual(trackProgress(r, next, at + 100000), r.onboardingTracker);
  }
});
test('an observed setup checkpoint advances revision and starts a fresh stall episode', () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at);
  const next = { ...r, twilioPhoneNumber: '+12895550101' };
  const t = trackProgress(r, next, at + 500000);
  assert.equal(t.revision, 2); assert.equal(t.lastProgressAt, new Date(at + 500000).toISOString());
  assert.equal(t.trackingStartedAt, r.onboardingTracker.trackingStartedAt);
});
test('legacy rows are not declared recently progressed or immediately stuck', () => {
  const r = fixture({ updatedAt: new Date(at + 1000000).toISOString() });
  assert.equal(trackerRow(r, at + 1000000).stalled, false);
  r.onboardingTracker = trackProgress(r, r, at + 1000000);
  assert.equal(r.onboardingTracker.lastProgressAt, null);
  assert.equal(r.onboardingTracker.timeBasis, 'tracking_started');
  assert.equal(trackerRow(r, at + 1000000).elapsedMs, 0);
  assert.equal(trackerRow(r, at + 1000000 + STALL_MS).stalled, true);
});
test('paused, closed and ready rows never become stuck despite old trackers', () => {
  for (const status of ['setup_ready', 'archived', 'subscription_paused', 'subscription_trialing']) {
    const r = fixture({ status }); r.onboardingTracker = trackProgress({}, r, at);
    assert.equal(trackerRow(r, at + 20 * STALL_MS).stalled, false);
  }
});
test('summary uses active onboarding and does not confuse eight old paused trials with stuck signups', () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at);
  const result = dashboard([r, ...Array.from({ length: 8 }, (_, i) => fixture({ status: 'subscription_paused', signupAttemptId: String(i) }))], at + STALL_MS);
  assert.equal(result.summary.active, 1); assert.equal(result.summary.stalled, 1);
});
test('one alert is queued per episode; restarts/polls do not resend, progress permits a new episode', async () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at);
  const db = store([r]); db.setNow(at + STALL_MS);
  const calls = [], run = () => createStallProcessor({ ...db, now: () => now, enqueue: async p => { calls.push(p); return { queued: true }; }, frontendUrl: 'https://www.myaipa.ca' });
  let now = at + STALL_MS;
  await run()(); await run()(); assert.equal(calls.length, 1);
  assert.match(calls[0].adminUrl, /tab=signups$/); assert.doesNotMatch(calls[0].text, /@|\+1289/);
  now += 1; db.setNow(now); db.save({ ...db.list()[0], twilioPhoneNumber: '+12895550101' });
  now += STALL_MS; db.setNow(now); await run()(); assert.equal(calls.length, 2);
  assert.notEqual(calls[0].dedupeKey, calls[1].dedupeKey);
});
test('failed enqueue remains retryable and a durable duplicate queue receipt is marked handled', async () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at);
  const db = store([r], at + STALL_MS); let attempts = 0;
  const run = createStallProcessor({ ...db, now: () => at + STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: async () => ++attempts === 1 ? { queued: false } : { duplicate: true } });
  await run(); assert.equal(db.list()[0].onboardingStallAlertRevision, undefined);
  await run(); await run(); assert.equal(attempts, 2);
});
test('first monitoring pass initializes only active legacy rows and does not send old-account alerts', async () => {
  const db = store([fixture(), fixture({ signupAttemptId: 'signup_' + 'b'.repeat(32), subscriptionStatus: 'paused' })]); let sends = 0;
  const result = await createStallProcessor({ ...db, now: () => at, enqueue: async () => { sends++; }, frontendUrl: 'https://www.myaipa.ca' })();
  assert.equal(result.initialized, 1); assert.equal(sends, 0);
});
test('overlapping background ticks share a running guard', async () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at); const db = store([r], at + STALL_MS);
  let finish; const run = createStallProcessor({ ...db, now: () => at + STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: () => new Promise(resolve => { finish = resolve; }) });
  const first = run(); assert.equal((await run()).reason, 'already_running');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish({ queued: true }); await first;
});
test('progress during enqueue does not overwrite the newer checkpoint', async () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at); const db = store([r], at + STALL_MS);
  const run = createStallProcessor({ ...db, now: () => at + STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: async () => { db.save({ ...db.list()[0], twilioPhoneNumber: '+12895550101' }); return { queued: true }; } });
  await run(); assert.equal(db.list()[0].onboardingTracker.revision, 2); assert.equal(db.list()[0].onboardingStallAlertRevision, undefined);
});
test('editor changes only canonical permitted fields, preserves identity/progress and is replay-safe', () => {
  const r = fixture({ ownerEmail: 'private@example.test', twilioPhoneNumber: '+12895550101', subscriptionId: 'private-billing' }); r.onboardingTracker = trackProgress({}, r, at);
  const db = store([r], at + 1000), details = { ...businessInfo(r), serviceArea: 'Hamilton', serviceSummary: 'Repairs' };
  const first = updateInfo({ records: db.list(), attemptId: id, input: { expectedRevision: infoRevision(r), details }, save: db.save });
  assert.equal(first.record.serviceArea, 'Hamilton'); assert.equal(first.record.businessName, r.businessName); assert.equal(first.record.ownerEmail, r.ownerEmail); assert.equal(first.record.subscriptionId, r.subscriptionId);
  assert.deepEqual(first.record.onboardingTracker, r.onboardingTracker);
  assert.equal(updateInfo({ records: db.list(), attemptId: id, input: { expectedRevision: infoRevision(r), details }, save: db.save }).replayed, true);
  assert.throws(() => updateInfo({ records: db.list(), attemptId: id, input: { expectedRevision: infoRevision(r), details: { ...details, serviceArea: 'Toronto' } }, save: db.save }), { code: 'SIGNUP_INFO_STALE' });
});
test('editor rejects identity, contact, routing, billing and unknown changes server-side', () => {
  for (const key of ['businessName', 'ownerEmail', 'ownerPhone', 'businessPhone', 'vapiAssistantId', 'subscriptionId', 'status', 'onboardingTracker', '__proto__']) {
    const input = { ...businessInfo(fixture()), [key]: 'override' };
    assert.throws(() => validateInfo(input), { code: 'SIGNUP_INFO_FIELD_FORBIDDEN' });
  }
});
test('editor validates exact normalized length, controls and non-credential website URLs', () => {
  for (const extra of [{ serviceArea: 'x'.repeat(161) }, { businessAddress: 'x\u0001' }, { businessWebsite: 'javascript:alert(1)' }, { businessWebsite: 'https://user:pass@example.test' }]) assert.throws(() => validateInfo({ ...businessInfo(fixture()), ...extra }));
  assert.equal(validateInfo({ ...businessInfo(fixture()), businessWebsite: 'https://example.test' }).businessWebsite, 'https://example.test');
});
test('editor refuses ambiguous, closed and malformed targets', () => {
  const r = fixture(), input = { expectedRevision: infoRevision(r), details: businessInfo(r) }, save = () => assert.fail('must not save');
  for (const records of [[], [r, { ...r }], [fixture({ status: 'archived' })]]) assert.throws(() => updateInfo({ records, attemptId: id, input, save }));
  assert.throws(() => updateInfo({ records: [r], attemptId: 'other', input, save }));
  assert.throws(() => updateInfo({ records: [r], attemptId: id, input: { ...input, publish: true }, save }));
});
test('tracker API projection exposes no private payloads, credentials or contact numbers', () => {
  const output = JSON.stringify(dashboard([fixture({ payload: { key: 'never-print' }, ownerPhone: '+12895550101', ownerEmail: 'private@example.test', apiKey: 'secret-value' })], at));
  assert.doesNotMatch(output, /never-print|secret-value|private@example|5550101|payload/);
});
test('durable outbox dedupes a crash after enqueue but before marking the signup episode', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { enqueueTelegramMessage } = require('../server/telegramOutbox');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-tracker-outbox-'));
  const filePath = path.join(directory, 'outbox.json');
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at); const db = store([r], at + STALL_MS);
  let crash = true;
  const dependencies = { ...db, now: () => at + STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: input => enqueueTelegramMessage({ ...input, filePath, now: at + STALL_MS }),
    saveMany: changes => { if (crash && changes.some(c => c.kind === 'alert_queued')) { crash = false; throw Error('synthetic loss after durable enqueue'); } return db.saveMany(changes); } };
  await assert.rejects(createStallProcessor(dependencies)(), /synthetic loss/);
  await createStallProcessor(dependencies)(); await createStallProcessor(dependencies)();
  const disk = JSON.parse(fs.readFileSync(filePath));
  assert.equal(disk.items.length, 1); assert.equal(db.list()[0].onboardingStallAlertRevision, 1);
  // Evidence is a synthetic temp file; no Telegram transport or credentials loaded.
});
test('malformed revision/timing metadata is repaired on the next tick without fake progress', async () => {
  for (const bad of [{ revision: undefined }, { revision: '1' }, { revision: Number.MAX_SAFE_INTEGER }, { timerStartedAt: 'invalid' }, { trackingStartedAt: '' }]) {
    const r = fixture(); r.onboardingTracker = { ...trackProgress({}, r, at), ...bad }; const db = store([r], at + STALL_MS);
    let queued = 0;
    await createStallProcessor({ ...db, now: () => at + STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: async () => { queued++; return { queued: true }; } })();
    assert.equal(queued, 0); assert.equal(db.list()[0].onboardingTracker.lastProgressAt, null);
    assert.equal(db.list()[0].onboardingTracker.timeBasis, 'tracking_started'); assert.ok(Number.isSafeInteger(db.list()[0].onboardingTracker.revision));
  }
});
test('a full tick does one snapshot read and one batch metadata write, independent of row count', async () => {
  const records = Array.from({ length: 25 }, (_, i) => { const r = fixture({ signupAttemptId: 'signup_' + i.toString(16).padStart(32, '0') }); r.onboardingTracker = trackProgress({}, r, at); return r; });
  const db = store(records, at + STALL_MS); let reads = 0, writes = 0, yields = 0, queued = 0;
  await createStallProcessor({ list: () => { reads++; return db.list(); }, saveMany: changes => { writes++; assert.equal(changes.length, 25); db.saveMany(changes); },
    now: () => at + STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: async () => { queued++; return { queued: true }; }, yieldControl: async () => { yields++; } })();
  assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(queued, 25); assert.ok(yields >= 4);
  assert.ok(db.list().every(r => r.onboardingStallAlertEpisode === episodeKey(r.onboardingTracker)));
});
test('the actual canonical batch saver uses one store read/write for 25 conditional updates', () => {
  const data = {}, changes = [];
  for (let i = 0; i < 25; i++) {
    const r = fixture({ signupAttemptId: 'signup_' + i.toString(16).padStart(32, '0') });
    data[r.signupAttemptId] = r; changes.push({ kind: 'initialize', attemptId: r.signupAttemptId });
  }
  let reads = 0, writes = 0;
  const save = createTrackerBatchSaver({ read: () => { reads++; return data; }, write: () => { writes++; }, findKey: (_store, query) => query.signupAttemptId, now: () => at });
  assert.equal(save(changes).changed, 25); assert.equal(reads, 1); assert.equal(writes, 1);
  assert.ok(Object.values(data).every(r => r.onboardingTracker.timeBasis === 'tracking_started'));
  save(changes); assert.equal(reads, 2); assert.equal(writes, 1, 'An unchanged batch does not rewrite the store');
});
test('batch merge preserves concurrent provider progress, canonical fields and derived readiness', () => {
  const r = fixture({ privateProviderState: 'preserve' }); r.onboardingTracker = trackProgress({}, r, at);
  const change = { kind: 'alert_queued', attemptId: id, expectedEpisode: episodeKey(r.onboardingTracker), detectedAt: new Date(at + STALL_MS).toISOString() };
  const progressed = { ...r, twilioPhoneNumber: '+12895550101', serviceArea: 'Concurrent admin edit' };
  progressed.onboardingTracker = trackProgress(r, progressed, at + 1);
  const data = { canonical: progressed }; let writes = 0;
  const save = createTrackerBatchSaver({ read: () => data, write: () => { writes++; }, findKey: () => 'canonical', now: () => at + STALL_MS });
  assert.equal(save([change]).changed, 0); assert.equal(writes, 0); assert.equal(data.canonical.serviceArea, 'Concurrent admin edit');
  assert.equal(data.canonical.privateProviderState, 'preserve');
  data.canonical = { ...r, status: 'setup_ready', onboardingTracker: undefined };
  const normalized = createTrackerBatchSaver({ read: () => data, write: () => { writes++; }, findKey: () => 'canonical', normalize: record => ({ ...record, status: 'agent_testing' }), now: () => at });
  normalized([{ kind: 'initialize', attemptId: id }]);
  assert.equal(data.canonical.status, 'setup_ready', 'Metadata initialization must not rewrite the canonical workflow status');
  assert.equal(data.canonical.onboardingTracker.signature, progressSignature({ ...data.canonical, status: 'agent_testing' }));
});
test('verified email never hides required SMS, or vice versa; explicit pending status remains authoritative', () => {
  for (const extra of [{ smsVerificationRequired: true, emailVerified: true }, { emailVerificationRequired: true, smsVerified: true }, { smsVerificationRequired: true, emailVerificationRequired: true, emailVerified: true }, { status: 'pending_verification', identityVerified: true }]) {
    const r = fixture({ identityVerified: true, ...extra });
    assert.equal(activity(r), 'waiting_customer'); assert.notEqual(checkpoint(r).progress.steps[0].status, 'done');
  }
  const r = fixture({ smsVerificationRequired: true, smsVerified: true, emailVerified: false });
  assert.equal(activity(r), 'working'); assert.equal(checkpoint(r).progress.steps[0].status, 'done');
});
test('a persisted episode marker prevents repeated queueing even after outbox receipt compaction', async () => {
  const r = fixture(); r.onboardingTracker = trackProgress({}, r, at); const db = store([r], at + STALL_MS);
  let queued = 0;
  await createStallProcessor({ ...db, now: () => at + STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: async () => { queued++; return { queued: true }; } })();
  const restarted = store(JSON.parse(JSON.stringify(db.list())), at + 100 * STALL_MS);
  // The queue has no dedupe history left. Canonical metadata alone must stop it.
  await createStallProcessor({ ...restarted, now: () => at + 100 * STALL_MS, frontendUrl: 'https://www.myaipa.ca', enqueue: async () => { queued++; return { queued: true }; } })();
  assert.equal(queued, 1);
});
