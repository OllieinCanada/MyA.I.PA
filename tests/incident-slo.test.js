const assert = require("node:assert/strict");
const test = require("node:test");

const { assessIncidentSlo, incidentSloTargets } = require("../server/incidentSlo");

test("incident SLO assessment reports a stale unresolved incident", () => {
  const result = assessIncidentSlo([{
    id: "a".repeat(24),
    detectedAt: "2026-09-24T12:00:00.000Z",
    diagnostics: { firstDetectedAt: "2026-09-24T12:00:00.000Z", lastDetectedAt: "2026-09-24T12:00:00.000Z" },
    remediation: { status: "repairing", codexFirst: true, codexMemoPreservedAt: "2026-09-24T12:00:30.000Z" },
  }], {
    now: Date.parse("2026-09-24T14:00:00.000Z"),
    targets: incidentSloTargets({}),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.breached[0].breaches, ["unacknowledged"]);
});

test("incident SLO assessment accepts a prompt verified repair", () => {
  const result = assessIncidentSlo([{
    id: "b".repeat(24),
    detectedAt: "2026-09-24T12:00:00.000Z",
    diagnostics: { firstDetectedAt: "2026-09-24T12:00:00.000Z", lastDetectedAt: "2026-09-24T12:00:00.000Z" },
    remediation: {
      status: "repair_ready",
      codexFirst: true,
      codexMemoPreservedAt: "2026-09-24T12:00:20.000Z",
      containmentReportPreservedAt: "2026-09-24T12:02:00.000Z",
      completedAt: "2026-09-24T12:20:00.000Z",
    },
  }], { now: Date.parse("2026-09-24T12:21:00.000Z") });
  assert.equal(result.ok, true);
  assert.equal(result.breachedIncidentCount, 0);
});
