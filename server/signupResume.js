const { signupBusinessKey, isClosedSignup } = require('./signupBusinessIdentity');

function resumeError() {
  return Object.assign(new Error('The existing signup ownership could not be confirmed.'), { code: 'SIGNUP_RESUME_OWNERSHIP_UNCONFIRMED', statusCode: 409 });
}

// A server-owned alias is not authority on its own. Require verified contact,
// exact business identity on both durable attempts, and an open canonical owner.
async function resolveSignupResume({ attempt, records, loadAttempt, verified = false }) {
  if (!attempt) throw resumeError();
  const source = records.filter(record => record.signupAttemptId === attempt.eventKey);
  const record = source[0] || {};
  const targetId = record.canonicalSignupAttemptId;
  if (!targetId) return { attempt, record, resumed: false };
  if (source.length !== 1 || !verified || !/^signup_[a-f0-9]{32}$/.test(targetId)
    || targetId === attempt.eventKey || attempt.archivedAt || attempt.rejectedAt || record.archivedAt || record.rejectedAt
    || (isClosedSignup(record) && record.status !== 'superseded_duplicate')
    || (isClosedSignup(attempt) && attempt.status !== 'superseded_duplicate')) throw resumeError();
  const targets = records.filter(item => item.signupAttemptId === targetId);
  const target = targets[0];
  const canonical = await loadAttempt(targetId);
  const key = signupBusinessKey(attempt);
  if (targets.length !== 1 || !canonical || !key || key !== signupBusinessKey(record)
    || key !== signupBusinessKey(target) || key !== signupBusinessKey(canonical)
    || isClosedSignup(target) || isClosedSignup(canonical) || target.canonicalSignupAttemptId) throw resumeError();
  return { attempt: canonical, record: target, resumed: true };
}

module.exports = { resolveSignupResume };
