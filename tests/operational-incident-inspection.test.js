const test = require('node:test');
const assert = require('node:assert/strict');
const { projectIssue, classifyIssue } = require('../scripts/inspect-operational-incidents');
const deployed = '2026-11-13T02:00:46.521Z';
test('projects only safe incident fields, not provider headers or raw records', () => {
  const item = projectIssue({ id: 'a'.repeat(24), kind: 'runtime_incident', title: 'api_key=secret-value-123456',
    raw: { secret: 'never-copy' }, snapshot: { Authorization: 'Bearer never-copy', Route: '/api/example' },
    diagnostics: { firstDetectedAt: '2026-11-12T00:00:00Z', lastDetectedAt: '2026-11-12T00:00:01Z', occurrences: 2 } });
  const serialized = JSON.stringify(item); assert.ok(!serialized.includes('secret-value')); assert.ok(!serialized.includes('never-copy'));
  assert.equal(item.occurrences, 2); assert.equal(item.snapshot.Route, '/api/example');
});
test('a historical incident is not presented as a fresh current reproduction or recovery', () => {
  const result = classifyIssue({ kind: 'runtime_incident', lastDetectedAt: '2026-11-07T01:43:39Z' }, deployed);
  assert.equal(result, 'historical_occurrence_unresolved_not_reproduced_now');
  assert.equal(classifyIssue({ kind: 'runtime_incident', lastDetectedAt: '2026-11-13T03:00:00Z' }, deployed), 'recorded_since_deploy_not_reproduced_now');
});
test('current account and duplicate projections are not relabeled as new runtime failures', () => {
  assert.equal(classifyIssue({ kind: 'subscription_paused' }, deployed), 'paused_account_state_not_a_new_runtime_failure');
  assert.equal(classifyIssue({ kind: 'signup_duplicate' }, deployed), 'current_duplicate_projection_not_a_stored_new_occurrence');
});
test('a business name alone is not proof of a synthetic artifact', () => {
  assert.equal(projectIssue({ businessName: 'Macdoopers electrical' }).syntheticLabelPresent, false);
  const item = projectIssue({ title: 'Synthetic fixture test' }); assert.equal(item.syntheticLabelPresent, true);
  assert.equal(classifyIssue(item, deployed), 'synthetic_label_present_origin_unverified_not_excluded');
});
test('non-signup attention is not mislabeled signup state or a new runtime outage', () => {
  for (const kind of ['call_tool_failed', 'owner_text_failed', 'high_priority_support', 'unknown_future_kind']) {
    const item = Object.freeze({ kind });
    assert.equal(classifyIssue(item, deployed), 'current_attention_record_underlying_state_needs_verification');
    assert.deepEqual(item, { kind });
  }
  assert.equal(classifyIssue({ kind: 'signup_failed' }, deployed), 'current_signup_state_underlying_record_needs_verification');
});
