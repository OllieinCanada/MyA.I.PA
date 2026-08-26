const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  acknowledgeRuntimeIncident,
  listRuntimeIncidents,
  recordRuntimeIncident,
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
