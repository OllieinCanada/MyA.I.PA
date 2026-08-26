const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildProductionIncidentAlert,
  buildTelegramChecklist,
  incidentAdminUrl,
  redactOperationalIssues,
  redactOperationalSignupIssues,
  selectOperationalIssue,
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
          phoneProvisioningStatus: "pending",
          phoneProvisioningCode: "PHONE_NUMBER_PENDING",
          makeResponseKind: "empty",
          signupAlertFailed: false,
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

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "signup_failed");
  assert.equal(issues[0].severity, "critical");
  assert.equal(issues[0].targetType, "signup");
  assert.equal(issues[0].targetId, "1234567890abcdef12345678");
  assert.deepEqual(issues[0].actions, ["reopen_signup"]);
  assert.equal(issues[0].diagnostics.phoneProvisioningCode, "phone_number_pending");
  assert.equal(issues[0].diagnostics.retryPayloadAvailable, true);
  assert.equal(JSON.stringify(issues).includes("private@example.com"), false);
  assert.equal(JSON.stringify(issues).includes("9055550123"), false);
  assert.equal(JSON.stringify(issues).includes("database-record-id"), false);
});

test("production monitor keeps every operational issue while stripping unsafe details", () => {
  const issues = redactOperationalIssues({
    issues: [{
      id: "abcdef1234567890abcdef12",
      kind: "owner_text_failed",
      severity: "critical",
      title: "Owner text failed",
      summary: "private@example.com at +1 905-555-0123 did not receive it",
      businessName: "Example Electrical",
      targetType: "lead_handoff",
      targetId: "not-a-safe-id",
      actions: ["retry_owner_text"],
      incident: {
        reasonCode: "OWNER_TEXT_DELIVERY_FAILED",
        reason: "Carrier returned token=private-secret",
        impact: "Owner may not have the lead",
        lastCheckpoint: "Lead saved",
        nextAction: "Retry once",
        confidence: "high",
      },
    }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "abcdef1234567890abcdef12");
  assert.equal(issues[0].targetId, "");
  assert.equal(issues[0].incident.reasonCode, "owner_text_delivery_failed");
  assert.doesNotMatch(JSON.stringify(issues), /private@example\.com|905-555-0123|private-secret/);
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

test("production failure alert explains the reason, snapshot, next action, and exact admin target", () => {
  const incidentId = "abcdef1234567890abcdef12";
  const alert = buildProductionIncidentAlert({
    checkedAt: "2026-08-25T21:03:13.616Z",
    ok: false,
    checks: [{
      name: "operational_health",
      healthy: false,
      operationalIssues: [{
        id: incidentId,
        kind: "signup_failed",
        severity: "critical",
        title: "Signup provisioning did not finish",
        summary: "Setup is not live",
        businessName: "Example Electrical",
        targetType: "signup",
        diagnostics: {
          status: "provisioning_pending",
          emailVerified: true,
          hasAssignedPhone: false,
          hasAssistant: false,
          hasSubscription: false,
          phoneProvisioningCode: "phone_number_pending",
        },
        incident: {
          reasonCode: "phone_number_pending",
          reason: "Provisioning returned without a verified number.",
          impact: "The signup is not live.",
          lastCheckpoint: "Email verification completed",
          nextAction: "Verify provider state before recovery.",
        },
      }],
    }],
  });
  assert.match(alert, /WHAT FAILED/);
  assert.match(alert, /REASON/);
  assert.match(alert, /Example Electrical/);
  assert.match(alert, /AI number assigned: no/);
  assert.match(alert, /Email verification completed/);
  assert.match(alert, /Verify provider state before recovery/);
  assert.equal(incidentAdminUrl({ id: incidentId }), `https://www.myaipa.ca/#/admin?tab=attention&incident=${incidentId}`);
});

test("an infrastructure outage takes priority over an older operational warning", () => {
  const alert = buildProductionIncidentAlert({
    checkedAt: "2026-08-25T21:03:13.616Z",
    ok: false,
    checks: [
      { name: "public_site", healthy: false, status: null, error: "timeout", durationMs: 10000, url: "https://www.myaipa.ca/" },
      {
        name: "operational_health",
        healthy: false,
        operationalIssues: [{
          id: "abcdef1234567890abcdef12",
          kind: "business_mapping_incomplete",
          severity: "warning",
          title: "Old routing warning",
          ageMinutes: 500,
          targetType: "business",
        }],
      },
    ],
  });
  assert.match(alert, /public site health check/i);
  assert.match(alert, /did not answer before the health check timed out/i);
  assert.doesNotMatch(alert, /Old routing warning/);
});

test("HTTP 200 without a healthy JSON response is not mislabeled as a successful HTTP check", () => {
  const alert = buildProductionIncidentAlert({
    checkedAt: "2026-08-25T21:03:13.616Z",
    ok: false,
    checks: [{
      name: "api_readiness",
      healthy: false,
      status: 200,
      error: "invalid_json",
      durationMs: 100,
      url: "https://api.myaipa.ca/api/health/ready",
    }],
  });
  assert.match(alert, /without valid JSON/i);
  assert.doesNotMatch(alert, /Health check returned HTTP 200\./);
});

test("the newest critical operational issue is selected before an older critical reminder", () => {
  assert.equal(selectOperationalIssue([
    { id: "old", severity: "critical", ageMinutes: 90 },
    { id: "new", severity: "critical", ageMinutes: 2 },
    { id: "warning", severity: "warning", ageMinutes: 1 },
  ]).id, "new");
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
