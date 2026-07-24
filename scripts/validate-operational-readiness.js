const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const reportPath = path.resolve(root, "diagnostics/operations/readiness-report.json");
const requiredOpsFiles = [
  "ops/OPERATIONAL_READINESS_CHECKLIST.md",
  "ops/RETENTION_DELETION_RUNBOOK.md",
  "ops/BACKUP_RESTORE_RUNBOOK.md",
  "ops/MONITORING_RUNBOOK.md",
  "ops/INCIDENT_RESPONSE_RUNBOOK.md",
  "ops/PRIVACY_REQUEST_RUNBOOK.md",
  "ops/SMS_CONSENT_RUNBOOK.md",
  "ops/COUNSEL_REVIEW_HANDOFF.md",
];
const requiredOperationalScripts = [
  "scripts/database-backup.js",
  "scripts/monitor-production.js",
  "scripts/retention-audit.js",
  "scripts/privacy-request-drill.js",
  "scripts/validate-operational-readiness.js",
];
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireFile(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) failures.push(`${relativePath} is missing`);
}

requiredOpsFiles.forEach(requireFile);
requiredOperationalScripts.forEach(requireFile);

const packageJson = JSON.parse(read("package.json"));
for (const script of [
  "legal:validate",
  "ops:validate",
  "ops:monitor",
  "ops:retention:audit",
  "ops:privacy:drill",
  "ops:backup",
  "ops:backup:check",
]) {
  if (!packageJson.scripts?.[script]) failures.push(`package script ${script} is missing`);
}

const render = read("render.yaml");
if (!render.includes("healthCheckPath: /api/health/ready")) {
  failures.push("Render must use the database-aware readiness endpoint");
}
for (const setting of [
  "CALL_TRANSCRIPT_RETENTION_DAYS",
  "CALL_RECORDING_RETENTION_DAYS",
]) {
  if (!render.includes(`key: ${setting}`)) failures.push(`Render setting ${setting} is missing`);
}

const server = read("server/index.js");
if (!server.includes('app.get("/api/health/ready"')) {
  failures.push("database-aware readiness endpoint is missing");
}
if (!server.includes("cleanupSensitiveCallData")) {
  failures.push("sensitive call-data cleanup job is missing");
}

const renderValidator = read("scripts/validate-render-blueprint.js");
if (!renderValidator.includes('expectEqual("healthCheckPath", service.healthCheckPath, "/api/health/ready")')) {
  failures.push("Render blueprint validator must enforce the database-aware readiness endpoint");
}

const releaseGate = read("scripts/release-gate.js");
if (!releaseGate.includes('["Operational readiness validation", nodeCommand(), [path.join("scripts", "validate-operational-readiness.js")]]')) {
  failures.push("local release gate must run operational readiness validation");
}

const qualityWorkflow = read(".github/workflows/quality.yml");
if (!qualityWorkflow.includes("run: npm run ops:validate")) {
  failures.push("GitHub quality workflow must run operational readiness validation");
}

const legalDir = path.resolve(
  process.env.LEGAL_DRAFTS_DIR || path.join(root, "legal")
);
const legalPresent = fs.existsSync(legalDir);
let legalPlaceholderCount = null;
if (legalPresent) {
  const legalText = fs
    .readdirSync(legalDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => fs.readFileSync(path.join(legalDir, name), "utf8"))
    .join("\n");
  legalPlaceholderCount = (legalText.match(/\[[A-Z][A-Z0-9 /_.,'’()-]{2,}\]/g) || []).length;
}

const externalActions = [
  "Appoint and authorize a Privacy Officer.",
  "Confirm the legal entity, legal-notice contacts, and mailing address.",
  "Have qualified Canadian counsel review and approve the legal package.",
  "Verify production provider contracts, locations, retention, and deletion controls.",
  "Verify Render paid-database PITR and create a logical export.",
  "Complete an isolated restore drill and record recovery time and data-loss window.",
  "Schedule the production monitor outside the production service and test an alert.",
  "Run an incident tabletop exercise and retain the signed exercise record.",
];

const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  strict,
  codeAndRunbooksReady: failures.length === 0,
  failures,
  privateLegalDrafts: {
    present: legalPresent,
    directory: legalPresent ? legalDir : null,
    unresolvedPlaceholderCount: legalPlaceholderCount,
  },
  externalActions,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`Report saved: ${reportPath}`);

if (failures.length || (strict && (!legalPresent || legalPlaceholderCount > 0))) {
  process.exitCode = 1;
}
