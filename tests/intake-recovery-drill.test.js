const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runDrill } = require("../scripts/run-intake-recovery-drill");
test("local drill never reports production healthy when live evidence is missing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-recovery-"));
  try {
    const result = runDrill({ args: [`--out=${path.join(directory, "report.json")}`], execute: () => ({ status: 0 }) });
    assert.equal(result.exitCode, 0); assert.equal(result.report.productionHealthyProven, false);
    assert.equal(result.report.liveDrill.status, "not_run"); assert.equal(result.report.resourceEvidence.status, "blocked");
    assert.equal(result.report.liveSideEffects, 0);
  } finally { fs.rmSync(directory, { recursive: true }); }
});
