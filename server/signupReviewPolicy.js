// Routine intake signals notify the owner without requiring approval.
// Unknown reasons and actual provider/recovery failures remain fail-closed.
const ADVISORY_REASONS = new Set([
  "manual_approval_enabled", "submitted_too_fast", "duplicate_submission", "disposable_email",
]);
function signupReviewPolicy(reasons = []) {
  const flags = [...new Set((Array.isArray(reasons) ? reasons : []).map(value => String(value).trim()).filter(Boolean))];
  const advisoryReasons = flags.filter(reason => ADVISORY_REASONS.has(reason));
  const blockingReasons = flags.filter(reason => !ADVISORY_REASONS.has(reason));
  return { advisoryReasons, blockingReasons, reviewRequired: blockingReasons.length > 0 };
}
module.exports = { signupReviewPolicy };
