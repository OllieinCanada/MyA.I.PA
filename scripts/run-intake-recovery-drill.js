const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { compareRecoveryEnvironments, assessIntakeResources } = require("../server/intakeRecoverySafety");

// Local faults exercise production journal/lock/guard code without external
// writes. Snapshot inputs must be freshly collected by authenticated operators.
// Missing live evidence is BLOCKED, never silently converted to a live pass.
function arg(args, name) { return args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3); }
function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
function runDrill({ args = process.argv.slice(2), execute = spawnSync } = {}) {
  const result = execute(process.execPath, ["--test", "tests/intake-recovery-journal.test.js", "tests/intake-recovery-safety.test.js", "tests/intake-recovery-replay.test.js", "tests/intake-recovery-vapi.test.js", "tests/make-intake-queue-adapter.test.js", "tests/provisioning-state.test.js", "tests/signup-business-safety.test.js"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 60000 });
  const localPass = result.status === 0 && !result.error;
  const parityFile = arg(args, "parity"); const evidenceFile = arg(args, "evidence");
  const parity = parityFile ? compareRecoveryEnvironments(readJson(parityFile)) : { pass: false, status: "blocked", reason: "Fresh staging and production release/blueprint/settings snapshots required" };
  const resources = evidenceFile ? assessIntakeResources(readJson(evidenceFile)) : { pass: false, status: "blocked", reason: "Fresh complete CRM, Twilio, Vapi, billing, charges and delivery evidence required" };
  const report = { generatedAt: new Date().toISOString(), localRegression: { pass: localPass }, environmentParity: parity, resourceEvidence: resources,
    liveDrill: { status: "not_run", reason: "No isolated staging queue or production smoke test is selected automatically" },
    readyForLiveDrill: localPass && parity.pass, productionHealthyProven: false, liveSideEffects: 0 };
  const output = path.resolve(arg(args, "out") || "diagnostics/shipping-readiness/intake-recovery-drill.json");
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(`${output}.tests.log`, result.stdout || "Local test runner failed before output was available.\n");
  return { report, localOutput: result.stdout, exitCode: localPass && (!parityFile || parity.pass) && (!evidenceFile || resources.pass) ? 0 : 1 };
}
if (require.main === module) {
  try { const result = runDrill(); console.log(JSON.stringify(result.report, null, 2)); if (result.exitCode) console.error("Recovery drill failed; inspect the focused tests or redacted report."); process.exitCode = result.exitCode; }
  catch (_) { console.error("Recovery drill input is invalid or unavailable; no external actions were performed."); process.exitCode = 1; }
}
module.exports = { runDrill };
