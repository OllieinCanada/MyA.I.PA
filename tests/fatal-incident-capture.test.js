const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildFatalIncident,
  readFatalIncident,
  reportStoredFatalIncident,
  writeFatalIncident,
} = require("../server/fatalIncidentCapture");

test("fatal crash snapshot is synchronous, minimal, and redacted", () => {
  const incident = buildFatalIncident(
    Object.assign(new Error("Crash for private@example.com at 123 Main Street token=private-secret"), { code: "DB_FATAL" }),
    { now: Date.parse("2026-08-25T23:00:00.000Z"), release: "abc123" }
  );
  assert.equal(incident.reasonCode, "DB_FATAL");
  assert.equal(incident.release, "abc123");
  assert.doesNotMatch(JSON.stringify(incident), /private@example\.com|123 Main Street|private-secret|stack/);
});

test("a stored fatal crash is removed only after confirmed delivery or durable queue transfer", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-fatal-test-"));
  const filePath = path.join(directory, "fatal-incident.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(writeFatalIncident(filePath, new Error("process crashed"), { now: 1000 }).written, true);
  assert.match(readFatalIncident(filePath).message, /process crashed/);

  const failed = await reportStoredFatalIncident({ filePath, notify: async () => ({ sent: false, reason: "telegram_timeout" }) });
  assert.equal(failed.reported, false);
  assert.equal(fs.existsSync(filePath), true);

  const queued = await reportStoredFatalIncident({ filePath, notify: async () => ({ sent: false, queued: true }) });
  assert.equal(queued.reported, true);
  assert.equal(queued.result.sent, false);
  assert.equal(queued.result.queued, true);
  assert.equal(fs.existsSync(filePath), false);

  assert.equal(writeFatalIncident(filePath, new Error("process crashed again"), { now: 2000 }).written, true);
  const sent = await reportStoredFatalIncident({ filePath, notify: async () => ({ sent: true, queued: false }) });
  assert.equal(sent.reported, true);
  assert.equal(fs.existsSync(filePath), false);
});
