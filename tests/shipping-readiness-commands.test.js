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

test("20-signup local gate uses mocks and creates no paid provider resources", () => {
  const result = run("run-local-signup-simulation.js", ["--count=20"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /local-mocked-no-external-resources/);
  assert.match(output, /"paidCallsOrMessages": 0/);
  assert.match(output, /"externalResourcesCreated": 0/);
  assert.match(output, /"consecutivePasses": 20/);
});

test("shipping report exposes explicit green, yellow, and red status", () => {
  const source = require("node:fs").readFileSync(path.join(root, "scripts", "report-shipping-readiness.js"), "utf8");
  assert.match(source, /readiness: overallColor/);
  assert.match(source, /color: gate\.status === "passed" \? "green"/);
  assert.match(source, /"signup_security"/);
  assert.match(source, /"signup_local_simulation"/);
  assert.match(source, /"browser"/);
});

test("Vapi eval runner rejects an invalid repetition count before network access", () => {
  const result = run("setup-vapi-evals.js", ["--dry-run", "--repeat=0"]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /repeat must be an integer/i);
});
