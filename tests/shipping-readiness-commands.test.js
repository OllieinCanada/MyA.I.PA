const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function run(script, args) {
  return spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SHIPPING_SIGNUP_TEST_API_BASE_URL: "" },
  });
}

test("high-volume signup gate refuses the production API", () => {
  const result = run("run-signup-review-gate.js", [
    "--post",
    "--count=20",
    "--api-base-url=https://api.myaipa.ca",
    "--confirm=RUN_REVIEW_SIGNUP_GATE",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /refused against production/i);
});

test("signup gate requires an explicit test environment before posting", () => {
  const result = run("run-signup-review-gate.js", [
    "--post",
    "--count=20",
    "--confirm=RUN_REVIEW_SIGNUP_GATE",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /dedicated signup test environment/i);
});

test("Vapi eval runner rejects an invalid repetition count before network access", () => {
  const result = run("setup-vapi-evals.js", ["--dry-run", "--repeat=0"]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /repeat must be an integer/i);
});
