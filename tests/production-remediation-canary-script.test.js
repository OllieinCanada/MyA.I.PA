const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "test-production-incident-remediation.js");

function run(args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("production incident canary is dry-run by default", () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"mode": "dry-run"/);
  assert.match(result.stdout, /expectedTelegramMessages": 0/);
  assert.match(result.stdout, /Dry run only/);
});

test("production incident canary requires the exact confirmation before any request", () => {
  const result = run(["--apply", "--confirm=WRONG"], { MONITOR_API_KEY: "test-monitor-key" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to start the canary/);
  assert.match(result.stderr, /RUN_INCIDENT_REMEDIATION_CANARY/);
});
