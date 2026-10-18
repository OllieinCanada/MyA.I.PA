const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSignupResume } = require('../server/signupResume');
const sourceId = `signup_${'a'.repeat(32)}`, targetId = `signup_${'b'.repeat(32)}`;
function fixture() {
  const identity = { businessName: 'Fixture Electrical', ownerEmail: 'owner@example.invalid', ownerPhone: '+19055550123' };
  const attempt = { ...identity, eventKey: sourceId, status: 'superseded_duplicate' };
  const canonical = { ...identity, eventKey: targetId, status: 'setup_ready' };
  const records = [{ ...identity, signupAttemptId: sourceId, canonicalSignupAttemptId: targetId },
    { ...identity, signupAttemptId: targetId, status: 'setup_ready' }];
  return { attempt, records, verified: true, loadAttempt: async id => id === targetId ? canonical : null, canonical };
}
test('verified alias reads its canonical ready, running or failed attempt without mutations', async () => {
  for (const status of ['setup_ready','provisioning','setup_error','review_required']) {
    const input = fixture(); input.canonical.status = status;
    const before = JSON.stringify(input);
    const view = await resolveSignupResume(input);
    assert.equal(view.attempt, input.canonical); assert.equal(view.record, input.records[1]); assert.equal(view.resumed, true);
    assert.equal(JSON.stringify(input), before);
  }
});
test('a matching name or email alone never grants access, nor does an unverified link', async () => {
  for (const mutate of [f=>f.verified=false, f=>f.records[1].ownerPhone='+19055550999', f=>f.canonical.ownerEmail='another@example.invalid',
    f=>f.attempt.businessName='Different Electrical', f=>f.records[0].ownerEmail='wrong@example.invalid',
    f=>f.records.push({...f.records[1]}), f=>f.records[1].canonicalSignupAttemptId=sourceId,
    f=>f.canonical.status='archived', f=>f.records[1].status='abandoned_archived', f=>f.attempt.status='archived',
    f=>f.attempt.archivedAt='now', f=>f.records[0].canonicalSignupAttemptId=sourceId]) {
    const f=fixture(); mutate(f);
    await assert.rejects(resolveSignupResume(f), { code: 'SIGNUP_RESUME_OWNERSHIP_UNCONFIRMED' });
  }
});
test('ordinary attempts stay bound to themselves without another-owner lookup', async () => {
  const f=fixture(); delete f.records[0].canonicalSignupAttemptId;
  f.loadAttempt=()=>{throw Error('must not look up');};
  assert.equal((await resolveSignupResume(f)).attempt,f.attempt);
});
