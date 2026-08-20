const test = require("node:test");
const assert = require("node:assert/strict");
const { redactOperationalSignupIssues } = require("../scripts/monitor-production");

test("production monitor keeps signup diagnostics actionable without customer data", () => {
  const issues = redactOperationalSignupIssues({
    issues: [
      {
        kind: "signup_failed",
        severity: "critical",
        targetType: "signup",
        targetId: "1234567890abcdef12345678",
        ageMinutes: 42,
        actions: ["reopen_signup"],
        diagnostics: {
          status: "setup_error",
          makeError: true,
          ownerEmail: "private@example.com",
          ownerPhone: "+19055550123",
        },
        ownerEmail: "private@example.com",
      },
      {
        kind: "owner_text_failed",
        severity: "critical",
        targetType: "lead_handoff",
        targetId: "database-record-id",
      },
    ],
  });

  assert.deepEqual(issues, [{
    kind: "signup_failed",
    severity: "critical",
    ageMinutes: 42,
    targetId: "1234567890abcdef12345678",
    actions: ["reopen_signup"],
    diagnostics: {
      status: "setup_error",
      makeError: true,
    },
  }]);
  assert.equal(JSON.stringify(issues).includes("private@example.com"), false);
  assert.equal(JSON.stringify(issues).includes("9055550123"), false);
  assert.equal(JSON.stringify(issues).includes("database-record-id"), false);
});
