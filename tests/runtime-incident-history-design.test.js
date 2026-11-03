const test = require('node:test');
const assert = require('node:assert/strict');
const { previewIncidentHistory: preview, ACTIVE_LIMIT, ACTIVE_WINDOW_MS, MAX_PREVIEW_RECORDS } = require('../server/runtimeIncidentHistoryDesign');
const { previewFixedExamples } = require('../scripts/preview-incident-history-design');
const now = '2026-11-02T12:00:00.000Z';
const old = '2026-10-01T12:00:00.000Z';
const record = (number, extra = {}) => ({ id: number.toString(16).padStart(24, '0'), generation: 1, occurrences: 1,
  severity: 'critical', remediationStatus: 'needs_user', firstDetectedAt: old, lastDetectedAt: old, ...extra });
const policy = { historyCapacity: 2, resolvedRetentionMs: ACTIVE_WINDOW_MS * 2 };
const run = (records, extra = {}) => preview({ records, now, ...extra });

test('history is not deleted merely because it leaves the seven-day active view', () => {
  const result = run([record(1)]);
  assert.equal(result.activeView.count, 0);
  assert.equal(result.history.suppliedGenerations, 1);
  assert.equal(result.history.expiredUnresolvedGenerations, 1);
  assert.deepEqual(result.mutationActions, []);
});

test('ordinary active cap does not truncate the supplied history or unresolved counts', () => {
  const records = Array.from({ length: ACTIVE_LIMIT + 1 }, (_, index) => record(index + 1, { lastDetectedAt: now }));
  const result = run(records);
  assert.equal(result.activeView.count, 100);
  assert.equal(result.history.suppliedGenerations, 101);
  assert.equal(result.history.unresolvedGenerations, 101);
});

test('pending sync remains visible past age and ordinary view cap without evicting history', () => {
  const recent = Array.from({ length: 100 }, (_, index) => record(index + 1, { lastDetectedAt: now }));
  const result = run([...recent, record(101, { syncRecoveryRequired: true })]);
  assert.equal(result.activeView.count, 101);
  assert.ok(result.activeView.ids.includes(record(101).id));
  assert.equal(result.history.suppliedGenerations, 101);
});

test('all unresolved severities survive history review age, not only sync or critical incidents', () => {
  const records = ['critical', 'warning', 'info'].map((severity, index) => record(index + 1, { severity }));
  const result = run(records, { policy });
  assert.equal(result.history.expiredUnresolvedGenerations, 3);
  assert.equal(result.history.resolvedOldGenerationsForPolicyReviewOnly, 0);
});

test('failed, needs-user and repair-ready are not silently treated as resolved', () => {
  const result = run(['failed', 'needs_user', 'repair_ready'].map((remediationStatus, index) => record(index + 1, { remediationStatus })), { policy });
  assert.equal(result.history.unresolvedGenerations, 3);
  assert.equal(result.history.resolvedOldGenerationsForPolicyReviewOnly, 0);
});

test('resolved age is a review count only and never overrides a preservation hold', () => {
  const result = run([record(1, { remediationStatus: 'resolved' }), record(2, { remediationStatus: 'recovered', preservationHold: true })], { policy });
  assert.equal(result.history.resolvedOldGenerationsForPolicyReviewOnly, 1);
  assert.equal(result.history.preservationHolds, 1);
  assert.deepEqual(result.mutationActions, []);
  assert.equal(result.canActivate, false);
});

test('missing policy never invents capacity, retention or acceptance', () => {
  const result = run([record(1)], { incoming: record(2) });
  assert.deepEqual(result.candidatePolicy, { historyCapacity: null, resolvedRetentionMs: null, ownerDecisionStillRequired: true });
  assert.equal(result.history.capacityState, 'undecided');
  assert.equal(result.admission.status, 'blocked_policy_undecided');
  assert.equal(result.admission.canAcknowledgeStored, false);
});

test('full and overfull histories never silently evict old records to admit new incidents', () => {
  for (const count of [2, 3]) {
    const result = run(Array.from({ length: count }, (_, index) => record(index + 1)), { policy, incoming: record(4) });
    assert.equal(result.history.suppliedGenerations, count);
    assert.equal(result.admission.status, 'blocked_requires_independent_durable_overflow_and_alert');
    assert.equal(result.admission.canAcknowledgeStored, false);
    assert.deepEqual(result.mutationActions, []);
  }
});

test('available capacity is not a durable commit, transition approval or live activation', () => {
  const result = run([record(1)], { policy, incoming: record(2) });
  assert.equal(result.admission.status, 'requires_durable_commit_and_transition_validation');
  assert.equal(result.admission.canAcknowledgeStored, false);
  assert.equal(result.runtimePolicyChanged, false);
  assert.equal(result.canActivate, false);
});

test('duplicate observations need no new history slot but cannot claim a new durable write', () => {
  const result = run([record(1), record(2)], { policy, incoming: record(1) });
  assert.equal(result.history.capacityState, 'full');
  assert.equal(result.admission.status, 'duplicate_no_change');
  assert.equal(result.admission.canAcknowledgeStored, false);
});

test('updates at capacity preserve generation and require independent transition validation', () => {
  const result = run([record(1), record(2)], { policy, incoming: record(1, { occurrences: 2, lastDetectedAt: now }) });
  assert.equal(result.admission.status, 'existing_generation_requires_transition_validation');
  assert.equal(result.history.suppliedGenerations, 2);
  assert.deepEqual(result.mutationActions, []);
});

test('recurrence generations stay distinct while only the latest generation projects into the view', () => {
  const result = run([record(1), record(1, { generation: 2, lastDetectedAt: now })]);
  assert.equal(result.history.suppliedGenerations, 2);
  assert.equal(result.history.distinctIncidents, 1);
  assert.deepEqual(result.activeView.ids, [record(1).id]);
  assert.throws(() => run([record(1), record(1)]), /DUPLICATE_GENERATION/);
});

test('older generations, decreased occurrences and altered first detection fail closed', () => {
  assert.throws(() => run([record(1, { generation: 2 })], { incoming: record(1) }), /STALE_GENERATION/);
  assert.throws(() => run([record(1, { occurrences: 2 })], { incoming: record(1) }), /CONFLICTING_UPDATE/);
  assert.throws(() => run([record(1)], { incoming: record(1, { firstDetectedAt: '2026-09-30T12:00:00.000Z' }) }), /CONFLICTING_UPDATE/);
  assert.throws(() => run([record(1, { lastDetectedAt: now })], { incoming: record(1, { generation: 2 }) }), /CONFLICTING_GENERATIONS/);
});

test('invalid or inconsistent times never become healthy history', () => {
  for (const mutation of [{ lastDetectedAt: 'invalid' }, { lastDetectedAt: '1' },
    { lastDetectedAt: '2026-02-30T12:00:00.000Z' }, { firstDetectedAt: now }, { lastDetectedAt: '2026-11-03T12:00:00.000Z' }]) {
    assert.throws(() => run([record(1, mutation)]));
  }
  assert.throws(() => preview({ records: [], now: 'invalid' }));
  assert.throws(() => run([record(1, { lastDetectedAt: now }), record(1, { generation: 2 })]), /CONFLICTING_GENERATIONS/);
});

test('invalid identities, counters, flags, states and raw payload fields are rejected', () => {
  for (const mutation of [{ id: '../private' }, { generation: 0 }, { occurrences: NaN }, { occurrences: '1' },
    { severity: 'unknown' }, { remediationStatus: 'unknown' }, { preservationHold: 'true' },
    { snapshot: { Caller: 'not accepted' } }, { payload: {} }, { businessName: 'not accepted' }]) {
    assert.throws(() => run([record(1, mutation)]));
  }
  assert.throws(() => run([record(1, { remediationStatus: 'resolved', syncRecoveryRequired: true })]), /CONFLICTING_SYNC_STATE/);
});

test('policy values cannot smuggle approval, an apply switch or a destructive command', () => {
  for (const candidate of [{ historyCapacity: 0 }, { historyCapacity: '2' }, { historyCapacity: Infinity },
    { resolvedRetentionMs: ACTIVE_WINDOW_MS - 1 }, { resolvedRetentionMs: -1 }, { approved: true }, { apply: true }]) {
    assert.throws(() => run([], { policy: candidate }));
  }
  assert.throws(() => run([], { apply: true }), /UNKNOWN_OPTION/);
});

test('preview is deterministic, non-mutating and bounds its input instead of truncating it', () => {
  const records = Object.freeze([Object.freeze(record(1))]);
  const before = JSON.stringify(records);
  assert.deepEqual(run(records, { policy: Object.freeze(policy) }), run(records, { policy }));
  assert.equal(JSON.stringify(records), before);
  assert.throws(() => run(Array(MAX_PREVIEW_RECORDS + 1).fill(record(1))), /INPUT_LIMIT/);
});

test('fixed command preview is synthetic and never presents fixture policy as approved settings', () => {
  const result = previewFixedExamples();
  assert.equal(result.syntheticOnly, true);
  assert.equal(result.livePolicyApproved, false);
  assert.match(result.note, /not recommendations or approved live settings/);
  for (const previewResult of [result.noPolicy, result.illustrativeFullHistory]) {
    assert.equal(previewResult.canActivate, false);
    assert.deepEqual(previewResult.mutationActions, []);
  }
});
