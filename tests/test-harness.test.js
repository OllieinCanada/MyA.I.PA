const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  getBackendTestBatchSize,
  getBackendTestBatchTimeout,
} = require("../scripts/run-backend-tests");

const root = path.resolve(__dirname, "..");

test("backend suite discovers the tests directory with bounded concurrency", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:backend"], "node scripts/run-backend-tests.js");

  const boundedRunner = fs.readFileSync(path.join(root, "scripts", "run-backend-tests.js"), "utf8");
  assert.match(boundedRunner, /BATCH_SIZE = getBackendTestBatchSize\(\)/);
  assert.equal(getBackendTestBatchSize("win32", ""), 1);
  assert.equal(getBackendTestBatchSize("linux", ""), 4);
  assert.equal(getBackendTestBatchSize("win32", "2"), 2);
  for (const invalid of ["0", "9", "1.5", "invalid", "-1"]) {
    assert.throws(() => getBackendTestBatchSize("win32", invalid), /integer from 1 to 8/);
  }
  assert.equal(getBackendTestBatchTimeout(""), 120_000);
  assert.equal(getBackendTestBatchTimeout("45000"), 45_000);
  for (const invalid of ["9999", "600001", "1.5", "invalid"]) {
    assert.throws(() => getBackendTestBatchTimeout(invalid), /integer from 10000 to 600000/);
  }
  assert.match(boundedRunner, /\.test\\\.js\$/);

  const releaseGate = fs.readFileSync(path.join(root, "scripts", "release-gate.js"), "utf8");
  assert.match(releaseGate, /\["run", "test:backend"\]/);
  assert.doesNotMatch(releaseGate, /backendTestFiles/);
});

test("CI exercises real PostgreSQL behavior and required frontend regression tests", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "quality.yml"), "utf8");
  assert.match(workflow, /services:\s+[\s\S]*postgres:/);
  assert.match(workflow, /RUN_DATABASE_INTEGRATION: "1"/);
  assert.match(workflow, /npm run test:database/);
  assert.match(workflow, /npm test -- --watchAll=false --runInBand/);
  assert.match(workflow, /npm run build:pages/);
});

test("cross-browser diagnostics remain available without blocking the required gate", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "quality.yml"), "utf8");
  const browserGate = fs.readFileSync(path.join(root, "scripts", "test-browser-quality.js"), "utf8");
  assert.equal(packageJson.scripts["test:browser:quality"], "node scripts/test-browser-quality.js");
  assert.doesNotMatch(workflow, /npm run test:browser:quality/);
  assert.match(browserGate, /deferred: true/);
  assert.match(browserGate, /process\.exitCode = 1/);
});

test("production monitor installs the legacy frontend dependency tree deterministically", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "production-monitor.yml"), "utf8");
  assert.match(workflow, /npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund/);
});
