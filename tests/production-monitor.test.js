const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildTelegramChecklist,
  redactOperationalSignupIssues,
} = require("../scripts/monitor-production");

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
          retryPayloadAvailable: true,
          providerLookup: "complete",
          assignedPhoneKnownToTwilio: true,
          assignedPhoneKnownToVapi: true,
          vapiAssistantAssigned: false,
          staleArchiveEligible: true,
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
      retryPayloadAvailable: true,
      providerLookup: "complete",
      assignedPhoneKnownToTwilio: true,
      assignedPhoneKnownToVapi: true,
      vapiAssistantAssigned: false,
      staleArchiveEligible: true,
    },
  }]);
  assert.equal(JSON.stringify(issues).includes("private@example.com"), false);
  assert.equal(JSON.stringify(issues).includes("9055550123"), false);
  assert.equal(JSON.stringify(issues).includes("database-record-id"), false);
});

test("production monitor builds a useful redacted Telegram checklist", () => {
  const checklist = buildTelegramChecklist({
    checkedAt: "2026-08-21T12:00:00.000Z",
    ok: false,
    checks: [
      { name: "public_site", healthy: true, status: 200 },
      { name: "api_liveness", healthy: true, status: 200 },
      { name: "api_readiness", healthy: true, status: 200, database: "reachable" },
      {
        name: "operational_health",
        healthy: false,
        status: 200,
        attentionTotal: 3,
        attentionCritical: 1,
        signupIssues: [
          { kind: "signup_failed", severity: "critical", targetId: "1234567890abcdef12345678" },
          { kind: "signup_stuck", severity: "warning", targetId: "abcdef1234567890abcdef12" },
          { kind: "signup_stuck", severity: "warning", targetId: "fedcba0987654321fedcba09" },
        ],
      },
    ],
  }, { sha: "8b54539b02ba0e79d0ab7190bd48d0dbf3928e8f" });

  assert.match(checklist, /ROUTINE STATUS CHECK/);
  assert.match(checklist, /Website: Online/);
  assert.match(checklist, /Database: Reachable/);
  assert.match(checklist, /Operations: 1 critical · 2 warning/);
  assert.match(checklist, /Failed signups: 1/);
  assert.match(checklist, /Incomplete signups: 2/);
  assert.match(checklist, /Release: 8b54539/);
  assert.equal(checklist.includes("1234567890abcdef12345678"), false);
});

test("routine checklist workflow supports send-now and Toronto daily delivery", () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, "../.github/workflows/telegram-routine-checklist.yml"),
    "utf8"
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "0 12 \* \* \*"/);
  assert.match(workflow, /cron: "0 13 \* \* \*"/);
  assert.match(workflow, /TZ=America\/Toronto/);
  assert.match(workflow, /--telegram-checklist/);
  assert.match(workflow, /--no-fail-exit/);
  assert.match(workflow, /secrets\.TELEGRAM_BOT_TOKEN/);
  assert.match(workflow, /secrets\.TELEGRAM_CHAT_ID/);
  assert.match(workflow, /secrets\.MONITOR_API_KEY/);
});
