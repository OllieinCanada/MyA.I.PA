const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  acknowledgeRuntimeIncident,
  listRuntimeIncidents,
  recordRuntimeIncident,
  updateRuntimeIncidentRemediation,
} = require("../server/runtimeIncidentStore");

test("runtime incidents persist as redacted, acknowledgeable admin snapshots", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-runtime-store-"));
  const filePath = path.join(directory, "runtime-incidents.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const incident = {
    incidentId: "abcdef1234567890abcdef12",
    severity: "critical",
    whatFailed: "POST /signup failed for private@example.com",
    reasonCode: "HTTP_500",
    reason: "Customer at 123 Main Street token=private-secret hit an exception",
    impact: "Signup did not finish",
    snapshot: { Business: "Example Electrical", Route: "/api/signup", Method: "POST", Status: "500" },
    lastCheckpoint: "Request reached API",
    nextAction: "Inspect logs",
    detectedAt: "2026-08-25T23:00:00.000Z",
  };
  assert.equal(recordRuntimeIncident(filePath, incident).recorded, true);
  assert.equal(recordRuntimeIncident(filePath, incident).recorded, true);
  const items = listRuntimeIncidents(filePath, { now: new Date("2026-08-25T23:05:00.000Z") });
  assert.equal(items.length, 1);
  assert.equal(items[0].diagnostics.occurrences, 2);
  assert.equal(items[0].severity, "critical");
  assert.deepEqual(items[0].snapshot, {
    Business: "Example Electrical",
    Route: "/api/signup",
    Method: "POST",
    Status: "500",
  });
  assert.equal(items[0].actions[0], "acknowledge_runtime_incident");
  assert.doesNotMatch(JSON.stringify(items), /private@example\.com|123 Main Street|private-secret/);
  assert.equal(acknowledgeRuntimeIncident(filePath, incident.incidentId).acknowledged, true);
  assert.equal(listRuntimeIncidents(filePath).length, 0);
});

test("runtime incident remediation lifecycle is durable, redacted, and terminal", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-remediation-store-"));
  const filePath = path.join(directory, "runtime-incidents.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const incident = {
    incidentId: "1234567890abcdef12345678",
    reasonCode: "DATABASE_UNAVAILABLE",
    whatFailed: "Customer dashboard database query",
    impact: "Dashboard request stopped",
    detectedAt: "2026-08-28T12:00:00.000Z",
    remediation: {
      version: 1,
      status: "queued",
      action: "readiness_probe",
      automatic: true,
      requiresUser: false,
      confidence: "high",
      hypothesis: "Database failed for private@example.com token=private-value",
      proposedSolution: "Probe readiness",
      safetyBoundary: "Do not replay the request",
    },
  };
  const recorded = recordRuntimeIncident(filePath, incident);
  assert.equal(recorded.item.remediation.status, "queued");
  assert.equal(recorded.item.remediation.generation, 1);
  assert.doesNotMatch(JSON.stringify(recorded.item), /private@example\.com|private-value/);

  assert.equal(updateRuntimeIncidentRemediation(filePath, incident.incidentId, {
    status: "repairing",
    summary: "Readiness probe started",
  }).updated, true);
  assert.equal(updateRuntimeIncidentRemediation(filePath, incident.incidentId, {
    status: "verifying",
    summary: "Checking database postcondition",
  }).updated, true);
  assert.equal(updateRuntimeIncidentRemediation(filePath, incident.incidentId, {
    status: "resolved",
    actionTaken: "Read-only readiness probe completed",
    verification: "Database reachable",
    nextAction: "No action required",
    updatedAt: "2026-08-28T12:00:30.000Z",
    completionReportPreservedAt: "2026-08-28T12:00:31.000Z",
    completionReportDelivery: "queued",
    completionReportOutboxId: "abcdefabcdefabcdefabcdef",
  }).updated, true);

  const item = listRuntimeIncidents(filePath, { now: new Date("2026-08-28T12:01:00.000Z") })[0];
  assert.equal(item.remediation.status, "resolved");
  assert.equal(item.remediation.history.length, 4);
  assert.equal(item.remediation.terminalAt, "2026-08-28T12:00:30.000Z");
  assert.equal(item.remediation.completionReportPreservedAt, "2026-08-28T12:00:31.000Z");
  assert.equal(item.remediation.completionReportDelivery, "queued");
  assert.equal(item.remediation.completionReportOutboxId, "abcdefabcdefabcdefabcdef");

  const delivered = updateRuntimeIncidentRemediation(filePath, incident.incidentId, {
    status: "resolved",
    updatedAt: "2026-08-28T12:00:40.000Z",
    completionReportDelivery: "sent",
  });
  assert.equal(delivered.updated, true);
  assert.equal(delivered.item.remediation.terminalAt, "2026-08-28T12:00:30.000Z");
  assert.equal(delivered.item.remediation.completionReportDelivery, "sent");
  assert.equal(updateRuntimeIncidentRemediation(filePath, incident.incidentId, {
    status: "repairing",
  }).reason, "terminal_remediation_state");
});

test("recurrence uses the immutable terminal clock even when duplicates keep arriving", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-remediation-recurrence-"));
  const filePath = path.join(directory, "runtime-incidents.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const base = {
    incidentId: "fedcba0987654321fedcba09",
    reasonCode: "DATABASE_UNAVAILABLE",
    whatFailed: "Database query",
    impact: "Request stopped",
    remediation: {
      version: 1,
      status: "queued",
      action: "readiness_probe",
      automatic: true,
      requiresUser: false,
    },
  };
  recordRuntimeIncident(filePath, { ...base, detectedAt: "2026-08-28T12:00:00.000Z" });
  updateRuntimeIncidentRemediation(filePath, base.incidentId, {
    status: "resolved",
    updatedAt: "2026-08-28T12:01:00.000Z",
  });
  const repeatedSoon = recordRuntimeIncident(filePath, { ...base, detectedAt: "2026-08-28T12:05:00.000Z" });
  assert.equal(repeatedSoon.item.remediation.status, "resolved");
  assert.equal(repeatedSoon.item.remediation.generation, 1);
  assert.equal(repeatedSoon.item.remediation.terminalAt, "2026-08-28T12:01:00.000Z");

  const repeatedAgain = recordRuntimeIncident(filePath, { ...base, detectedAt: "2026-08-28T12:09:59.000Z" });
  assert.equal(repeatedAgain.item.remediation.generation, 1);
  assert.equal(repeatedAgain.item.remediation.terminalAt, "2026-08-28T12:01:00.000Z");

  const recurrent = recordRuntimeIncident(filePath, { ...base, detectedAt: "2026-08-28T12:11:00.000Z" });
  assert.equal(recurrent.item.remediation.status, "queued");
  assert.equal(recurrent.item.remediation.generation, 2);
});

test("needs-user incidents do not auto-reopen into another generation", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-remediation-manual-"));
  const filePath = path.join(directory, "runtime-incidents.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const incident = {
    incidentId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    reasonCode: "PROVIDER_ACCOUNT_FUNDING_REQUIRED",
    whatFailed: "Provider account blocked",
    impact: "Provisioning stopped",
    detectedAt: "2026-08-28T12:00:00.000Z",
    remediation: {
      version: 1,
      status: "needs_user",
      action: "none",
      automatic: false,
      requiresUser: true,
    },
  };
  recordRuntimeIncident(filePath, incident);
  const repeated = recordRuntimeIncident(filePath, {
    ...incident,
    detectedAt: "2026-08-28T14:00:00.000Z",
  });
  assert.equal(repeated.item.remediation.status, "needs_user");
  assert.equal(repeated.item.remediation.generation, 1);
});
