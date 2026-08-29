const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const stateScript = path.join(root, "scripts", "sync-production-monitor-state.js");
const {
  canonicalMonitorState,
} = require(stateScript);

function validState() {
  return {
    schemaVersion: 2,
    incidents: {
      "check:api_health:http_500": {
        incidentId: "0123456789abcdef01234567",
        businessName: "Private Customer Electrical",
        targetId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        diagnostics: { ownerEmail: "owner@example.com" },
        type: "check",
        checkName: "api_health",
        firstDetectedAt: "2026-08-28T12:00:00.000Z",
      },
      "issue:fedcba987654321001234567:provisioning_failed": {
        incidentId: "fedcba987654321001234567",
        type: "operational",
        checkName: "operational_health",
        firstDetectedAt: "2026-08-28T12:01:00.000Z",
      },
    },
  };
}

test("Render pins the guarded repair controls and keeps code repair off", () => {
  const blueprint = YAML.parse(fs.readFileSync(path.join(root, "render.yaml"), "utf8"));
  const service = blueprint.services.find((item) => item.name === "myaipa-api");
  const byKey = new Map(service.envVars.map((item) => [item.key, item]));

  assert.equal(byKey.get("RUNTIME_TELEGRAM_ALERTS_ENABLED").value, "true");
  assert.equal(byKey.get("INCIDENT_SAFE_AUTO_REPAIR_ENABLED").value, "true");
  assert.equal(byKey.get("INCIDENT_CODE_REPAIR_ENABLED").value, "false");
  assert.equal(byKey.get("INCIDENT_CODE_REPAIR_MAX_DAILY").value, "3");
  assert.equal(byKey.get("INCIDENT_CODE_REPAIR_COOLDOWN_MS").value, "3600000");
  assert.equal(byKey.get("INCIDENT_READINESS_TIMEOUT_MS").value, "5000");
  assert.deepEqual(byKey.get("GITHUB_INCIDENT_REPAIR_TOKEN"), {
    key: "GITHUB_INCIDENT_REPAIR_TOKEN",
    sync: false,
  });
  assert.deepEqual(byKey.get("INCIDENT_REPAIR_DISPATCH_SECRET"), {
    key: "INCIDENT_REPAIR_DISPATCH_SECRET",
    sync: false,
  });
});

test("production monitor separates secret-bearing probes from least-privilege state writes", () => {
  const source = fs.readFileSync(path.join(root, ".github", "workflows", "production-monitor.yml"), "utf8");
  const workflow = YAML.parse(source);
  const actionRefs = [...source.matchAll(/\buses:\s*([^\s#]+)/g)].map((match) => match[1]);
  const persistSection = source.split(/^  persist_state:/m)[1];

  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.persist_state.permissions.contents, "write");
  assert.match(source, /sync-production-monitor-state\.js restore/);
  assert.match(source, /sync-production-monitor-state\.js persist/);
  assert.match(source, /production-monitor-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.doesNotMatch(source, /actions\/cache@/);
  assert.ok(actionRefs.length >= 5);
  for (const actionRef of actionRefs) {
    assert.match(actionRef, /^[^@\s]+@[a-f0-9]{40}$/i, `${actionRef} must be commit-pinned`);
  }
  assert.doesNotMatch(persistSection, /secrets\.|TELEGRAM_|MONITOR_API_KEY/);
  assert.match(persistSection, /contents:\s*write/);
});

test("durable monitor state accepts only bounded schema-v2 lifecycle records", () => {
  const canonical = JSON.parse(canonicalMonitorState(validState()));
  const serialized = JSON.stringify(canonical);
  assert.equal(canonical.schemaVersion, 2);
  assert.equal(Object.keys(canonical.incidents).length, 2);
  assert.ok(Object.keys(canonical.incidents).every((fingerprint) => /:public_[a-f0-9]{32}$/.test(fingerprint)));
  assert.ok(Object.values(canonical.incidents).every((incident) => /^public_[a-f0-9]{24}$/.test(incident.lifecycleId)));
  assert.doesNotMatch(serialized, /0123456789abcdef01234567|fedcba987654321001234567|provisioning_failed|http_500/);
  assert.doesNotMatch(serialized, /incidentId|targetId|businessName|diagnostics|Private Customer Electrical|owner@example\.com/);
  assert.throws(() => canonicalMonitorState({ schemaVersion: 1, incidents: {} }), /schema version 2/);
  assert.throws(() => canonicalMonitorState({ schemaVersion: 2, incidents: [] }), /incidents must be one JSON object/);
  assert.throws(() => canonicalMonitorState({
    schemaVersion: 2,
    incidents: {
      "../main": validState().incidents["check:api_health:http_500"],
    },
  }), /unsafe fingerprint/);

  const overLimit = {};
  for (let index = 0; index < 151; index += 1) {
    overLimit[`check:api_health:http_${index}`] = {
      ...validState().incidents["check:api_health:http_500"],
      incidentId: index.toString(16).padStart(24, "0"),
    };
  }
  assert.throws(() => canonicalMonitorState({ schemaVersion: 2, incidents: overLimit }), /150-incident/);
});

test("state synchronization is fixed to a non-code branch and fails closed on write-path outages", () => {
  const source = fs.readFileSync(stateScript, "utf8");
  const monitorSource = fs.readFileSync(path.join(root, "scripts", "monitor-production.js"), "utf8");
  assert.match(source, /const STATE_BRANCH = "ops\/production-monitor-state"/);
  assert.match(source, /if \(branch\.unavailable\) throw new Error/);
  assert.match(source, /monitor_state_invalid/);
  assert.match(source, /monitor_state_unavailable/);
  assert.match(source, /git\(\["push", "origin", `\$\{commit\}:refs\/heads\/\$\{STATE_BRANCH\}`\]\)/);
  assert.match(monitorSource, /const publicReport = publicMonitorReport\(report\)/);
  assert.match(monitorSource, /writeFileSync\(reportPath, `\$\{JSON\.stringify\(publicReport/);
  assert.doesNotMatch(monitorSource, /writeFileSync\(reportPath, `\$\{JSON\.stringify\(report/);
});
