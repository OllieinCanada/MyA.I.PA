const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("backend suite discovers the tests directory instead of maintaining a fragile file list", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:backend"], "node --test tests");

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
  assert.equal(packageJson.scripts["test:browser:quality"], "node scripts/test-browser-quality.js");
  assert.doesNotMatch(workflow, /npm run test:browser:quality/);
});
