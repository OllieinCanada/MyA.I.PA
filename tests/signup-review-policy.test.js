const test = require('node:test');
const assert = require('node:assert/strict');
const { signupReviewPolicy } = require('../server/signupReviewPolicy');
test('routine intake flags notify without holding new applications', () => {
  for (const reason of ['manual_approval_enabled', 'submitted_too_fast', 'duplicate_submission', 'disposable_email']) {
    const result = signupReviewPolicy([reason]);
    assert.equal(result.reviewRequired, false);
    assert.deepEqual(result.advisoryReasons, [reason]);
  }
});
test('real failures, missing required details and unknown reasons do not become auto-approved', () => {
  for (const reason of ['missing_contact_detail', 'provisioning_unreachable', 'PROVISIONING_CONTEXT_MISMATCH', 'MAKE_SIGNUP_REJECTED', 'unknown_reason']) {
    assert.equal(signupReviewPolicy(['manual_approval_enabled', reason]).reviewRequired, true);
  }
});
test('an ordinary signup has no approval requirement', () => {
  assert.equal(signupReviewPolicy().reviewRequired, false);
});
