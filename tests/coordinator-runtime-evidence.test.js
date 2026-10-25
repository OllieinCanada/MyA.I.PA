const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ENDPOINT, diagnose, projectPayload } = require("../scripts/coordinator-runtime-evidence");

function issue(changes = {}) {
  return { kind: "runtime_incident", severity: "critical",
    incident: { reasonCode: "DATABASE_QUERY_IMPLEMENTATION_FAILED" }, ...changes };
}

function payload(issues = [issue()]) {
  return { service: "my-ai-pa-operations", ok: false, issues };
}

test("projection includes only enum categories and aggregate counts, never private fields", () => {
  const privateValue = "PRIVATE_customer_credential_5551234567@example.test";
  const source = payload([
    issue({ title: privateValue, summary: privateValue, businessName: privateValue,
      id: privateValue, targetId: privateValue, diagnostics: { apiKey: privateValue },
      snapshot: { ownerEmail: privateValue },
      incident: { reasonCode: "DATABASE_QUERY_IMPLEMENTATION_FAILED", reason: privateValue, nextAction: privateValue } }),
    issue(),
    issue({ kind: "signup_stuck", severity: "warning", incident: { reasonCode: "CONTACT_VERIFICATION_PENDING" } }),
  ]);
  source.customer = privateValue;
  const projected = projectPayload(source);
  assert.deepEqual(projected.counts, { active: 3, critical: 2, warning: 1, info: 0 });
  assert.equal(projected.categories.length, 2);
  assert.equal(projected.categories.find((i) => i.severity === "critical").count, 2);
  assert.equal(projected.complete, true);
  assert.equal(JSON.stringify(projected).includes(privateValue), false);
  assert.deepEqual(Object.keys(projected.categories[0]).sort(), ["count", "kind", "reasonCode", "severity"]);
});

test("missing authentication makes no network request", async () => {
  let calls = 0;
  const result = await diagnose({ apiKey: "", fetchImpl: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(result.error, "monitor_auth_missing_or_invalid");
  assert.equal(result.complete, false);
});

test("mixed runtime and non-runtime records preserve known critical causes without optional incident details", () => {
  const result = projectPayload(payload([
    issue(),
    { kind: "subscription_paused", severity: "warning", title: "PRIVATE_CUSTOMER_NAME" },
    { kind: "signup_failed", severity: "critical" },
  ]));
  assert.deepEqual(result.counts, { active: 3, critical: 2, warning: 1, info: 0 });
  assert.equal(result.authenticatedRead, true);
  assert.equal(result.categories.find((item) => item.kind === "runtime_incident").reasonCode,
    "DATABASE_QUERY_IMPLEMENTATION_FAILED");
  assert.equal(result.categories.find((item) => item.kind === "subscription_paused").reasonCode, "NOT_PROVIDED");
  assert.equal(result.missingReasonCount, 2);
  assert.equal(result.complete, false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_CUSTOMER_NAME"), false);
});

test("unknown records preserve known category results while failing coverage explicitly", () => {
  const result = projectPayload(payload([issue(), { kind: "PRIVATE_CUSTOMER_NAME", severity: "PRIVATE_TOKEN" }]));
  assert.equal(result.complete, false);
  assert.equal(result.error, "unrecognized_operational_issue_schema");
  assert.equal(result.counts.critical, 1);
  assert.equal(result.unknownSeverityCount, 1);
  assert.equal(result.categories.find((item) => item.kind === "runtime_incident").count, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE_CUSTOMER_NAME"), false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_TOKEN"), false);
});

test("one GET uses the fixed endpoint and forbids following redirects", async () => {
  let calls = 0;
  const result = await diagnose({ apiKey: "unit-test-only", fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, ENDPOINT);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer unit-test-only");
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify(payload()));
  } });
  assert.equal(calls, 1);
  assert.equal(result.complete, true);
  assert.equal(result.operationalOk, false);
});

test("HTTP failures do not read or echo their response body", async () => {
  const result = await diagnose({ apiKey: "unit-test-only", fetchImpl: async () => ({
    ok: false, status: 401, get body() { throw new Error("Private response should not be read"); },
  }) });
  assert.equal(result.error, "operational_http_error");
  assert.equal(result.status, 401);
});

test("request exceptions never expose credential, header, or exception messages", async () => {
  const result = await diagnose({ apiKey: "UNIT_TEST_PRIVATE_VALUE", fetchImpl: async () => {
    throw new Error("Authorization: Bearer UNIT_TEST_PRIVATE_VALUE; CUSTOMER_EMAIL@example.test");
  } });
  assert.equal(result.error, "operational_request_failed");
  assert.equal(JSON.stringify(result).includes("UNIT_TEST_PRIVATE_VALUE"), false);
  assert.equal(JSON.stringify(result).includes("CUSTOMER_EMAIL"), false);
});

test("unknown reason codes are not echoed and make coverage explicitly incomplete", () => {
  const result = projectPayload(payload([issue({ incident: { reasonCode: "PRIVATE_CUSTOMER_TOKEN" } })]));
  assert.equal(result.complete, false);
  assert.equal(result.error, "unrecognized_reason_code");
  assert.equal(result.categories[0].reasonCode, "UNKNOWN_REASON_CODE");
  assert.equal(JSON.stringify(result).includes("PRIVATE_CUSTOMER_TOKEN"), false);
});

test("unknown issue schemas fail without including supplied values", async () => {
  const result = await diagnose({ apiKey: "unit-test-only", fetchImpl: async () =>
    new Response(JSON.stringify(payload([issue({ kind: "private_customer_name" })]))) });
  assert.equal(result.error, "unrecognized_operational_issue_schema");
  assert.equal(JSON.stringify(result).includes("private_customer_name"), false);
});

test("malformed JSON and oversized response fail with static errors", async () => {
  const malformed = await diagnose({ apiKey: "unit-test-only", fetchImpl: async () =>
    new Response("PRIVATE_TOKEN not JSON") });
  assert.equal(malformed.error, "invalid_operational_json");
  assert.equal(JSON.stringify(malformed).includes("PRIVATE_TOKEN"), false);
  const large = await diagnose({ apiKey: "unit-test-only", fetchImpl: async () =>
    new Response("x".repeat(2 * 1024 * 1024 + 1)) });
  assert.equal(large.error, "operational_response_too_large");
});

test("branch workflow has no recurring, messaging, mutation, or production-state lane", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/codeql.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/codex\/unknown-warning-evidence-attempt-1'/);
  assert.doesNotMatch(workflow, /schedule:|cron:|contents: write|TELEGRAM_|notifications:providers|sync-production-monitor-state|incident_canary|--apply/);
});

test('critical detail projection rejects customer text and bounds numeric metadata', () => {
  const secret = 'person@example.com secret-token';
  const report = projectPayload({service:'my-ai-pa-operations',ok:false,issues:[{
    kind:'runtime_incident',severity:'critical',incident:{reasonCode:'PROVIDER_TIMEOUT'},
    snapshot:{Provider:secret,Workflow:secret,'Provider code':secret,Release:secret},
    diagnostics:{occurrences:999999999,firstDetectedAt:secret,lastDetectedAt:secret},
    remediation:{status:secret},title:secret,id:secret,
  }]});
  assert.doesNotMatch(JSON.stringify(report),/person@example|secret-token/);
  assert.equal(report.criticalDetails[0].occurrences,10000);
  assert.equal(report.criticalDetails[0].firstDetectedBeforeCurrentCommit,null);
  assert.equal(report.criticalDetails[0].provider,'UNKNOWN_PROVIDER');
});
test('critical details distinguish historical database failures using finite metadata', () => {
 const report=projectPayload({service:'my-ai-pa-operations',ok:false,issues:[{
  kind:'runtime_incident',severity:'critical',incident:{reasonCode:'DATABASE_QUERY_IMPLEMENTATION_FAILED'},
  snapshot:{Provider:'Render PostgreSQL','Provider code':'P2028',Workflow:'Twilio delivery inbox'},
  diagnostics:{firstDetectedAt:'2026-10-20T00:00:00Z',lastDetectedAt:'2026-10-20T00:00:00Z',occurrences:1},remediation:{status:'needs_user'}
 }]});
 assert.equal(report.criticalDetails[0].providerCode,'P2028');
 assert.equal(report.criticalDetails[0].lastDetectedBeforeCurrentCommit,true);
});

test('warning projection recognizes source-defined reasons and never echoes unknown metadata', () => {
 const privateText='person@example.com PRIVATE_TOKEN_123456';
 const payload={service:'my-ai-pa-operations',ok:false,issues:[{kind:'runtime_incident',severity:'warning',incident:{reasonCode:'VAPI_CALL_SYNC_FAILED'},snapshot:{Provider:privateText,Workflow:privateText,'Provider code':privateText,'Failure code':privateText},diagnostics:{occurrences:999999},remediation:{status:privateText}}]};
 const report=projectPayload(payload);
 assert.equal(report.warningDetails[0].reasonCode,'VAPI_CALL_SYNC_FAILED');
 assert.equal(report.warningDetails[0].occurrences,10000);
 assert.doesNotMatch(JSON.stringify(report),/person@example|PRIVATE_TOKEN/);
 payload.issues[0].incident.reasonCode='PRIVATE_TOKEN_123456';
 assert.equal(projectPayload(payload).complete,false);
 assert.doesNotMatch(JSON.stringify(projectPayload(payload)),/PRIVATE_TOKEN/);
});

test('legacy raw Prisma warning and source-defined receipt reason remain finite enums', () => {
 const report=projectPayload({service:'my-ai-pa-operations',ok:false,issues:[{kind:'runtime_incident',severity:'warning',incident:{reasonCode:'P2028'},snapshot:{Provider:'Render PostgreSQL','Provider code':'P2028'}},{kind:'twilio_receipt_worker',severity:'warning',incident:{reasonCode:'TWILIO_RECEIPT_WORKER_UNHEALTHY'}}]});
 assert.equal(report.complete,true);
 assert.equal(report.warningDetails[0].providerCode,'P2028');
 assert.equal(report.counts.warning,2);
});
