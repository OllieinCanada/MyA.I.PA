const fs = require("fs");
const path = require("path");
const { rootPath } = require("./_helpers");

const strict = process.argv.includes("--strict");
const evidenceDir = rootPath("diagnostics", "shipping-readiness");
const outputPath = path.join(evidenceDir, "shipping-readiness.json");

function readEvidence(name) {
  const filePath = path.join(evidenceDir, name);
  if (!fs.existsSync(filePath)) return { filePath, value: null };
  try {
    return { filePath, value: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { filePath, value: null, error: `invalid JSON: ${error.message}` };
  }
}

function evidenceTimestamp(value) {
  return value?.checkedAt || value?.completedAt || value?.generatedAt || value?.createdAt || "";
}

function makeGate({ id, title, evidence, pass, requirement, limitation = "", maxAgeHours = 24 }) {
  const loaded = readEvidence(evidence);
  let status = "not_run";
  const timestamp = evidenceTimestamp(loaded.value);
  const ageHours = timestamp ? (Date.now() - new Date(timestamp).getTime()) / 3_600_000 : null;
  const fresh = Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxAgeHours;
  if (loaded.error || loaded.value) status = pass(loaded.value || {}) && fresh ? "passed" : "failed";
  return {
    id,
    title,
    status,
    requirement,
    evidence,
    freshness: {
      timestamp: timestamp || null,
      maxAgeHours,
      ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
      fresh,
    },
    ...(loaded.error ? { error: loaded.error } : {}),
    ...(limitation ? { limitation } : {}),
  };
}

const gates = [
  makeGate({
    id: "release",
    title: "Repository release gate",
    evidence: "release-gate.json",
    pass: (value) => value.ready === true && value.skipPages === false,
    requirement: "Full backend, frontend, security, build, accessibility, and browser gate passes.",
  }),
  makeGate({
    id: "operations",
    title: "Operational controls and runbooks",
    evidence: "../operations/readiness-report.json",
    pass: (value) => value.codeAndRunbooksReady === true && (!Array.isArray(value.failures) || value.failures.length === 0),
    requirement: "Operational controls and every required incident, support, privacy, retention, and backup runbook validate.",
    maxAgeHours: 168,
  }),
  makeGate({
    id: "monitoring",
    title: "Production health monitoring",
    evidence: "../operations/production-monitor.json",
    pass: (value) => Array.isArray(value.checks) && value.checks.length >= 3 && value.checks.every((check) => check.healthy === true) && value.warningCount === 0,
    requirement: "Website, API, and database readiness are healthy with no monitor warning.",
    limitation: "A controlled alert-delivery exercise is still required before relying on incident notifications.",
  }),
  makeGate({
    id: "privacy",
    title: "Tenant privacy and deletion drill",
    evidence: "../operations/privacy-request-drill.json",
    pass: (value) => value.passed === true && value.productionDataUsed === false && value.externalProvidersMutated === false,
    requirement: "Synthetic access, correction, consent withdrawal, deletion, tenant isolation, and restore replay checks pass.",
  }),
  makeGate({
    id: "backup",
    title: "Backup and restore readiness",
    evidence: "backup-readiness.json",
    pass: (value) => value.ready === true && value.databaseUrlConfigured === true && value.encryptionConfigured === true && Boolean(value.pgDumpVersion) && Boolean(value.pgRestoreVersion),
    requirement: "Encrypted database backup prerequisites pass, followed by an isolated restore drill.",
    maxAgeHours: 168,
  }),
  makeGate({
    id: "signup",
    title: "Signup reliability",
    evidence: "signup-review-gate.json",
    pass: (value) => value.ready === true && value.consecutivePasses >= 20,
    requirement: "20 uninterrupted review-only signups pass in a dedicated test environment without external provisioning.",
  }),
  makeGate({
    id: "mapping",
    title: "Assistant-to-business mapping",
    evidence: "vapi-mapping-audit.json",
    pass: (value) => value.ready === true && Number(value.summary?.unmappedCustomerPhones || 0) === 0 && Number(value.summary?.customerPhonesWithoutAssistants || 0) === 0,
    requirement: "Every active direct customer route has an assistant, every customer route has a provable business mapping, and protected trial gates are identified explicitly.",
  }),
  makeGate({
    id: "messages",
    title: "Owner and caller message isolation",
    evidence: "message-routing-gate.json",
    pass: (value) => value.ready === true && value.consecutivePasses >= 50 && value.wrongRecipientCount === 0,
    requirement: "50 consecutive isolated routing simulations pass with no wrong recipients.",
    limitation: "This gate covers application routing; authorized Twilio delivery-receipt evidence is separate.",
  }),
  makeGate({
    id: "twilio",
    title: "Twilio production delivery and consent",
    evidence: "twilio-readiness.json",
    pass: (value) => (
      value.account?.status === "active"
      && value.credentials?.restAuthentication === "api_key"
      && value.credentials?.vapiSmsToolsUsingApiKeys === value.credentials?.vapiSmsTools
      && value.phoneNumbers?.consentProxyRoutes === value.phoneNumbers?.smsCapable
      && value.messaging?.statusCallbackTools === value.credentials?.vapiSmsTools
      && Number(value.messaging?.eligibleDeliveryRatePercent || 0) >= 95
      && value.trust?.approvedProfilePresent === true
      && Number(value.monitoring?.usageTriggers || 0) > 0
    ),
    requirement: "Scoped API keys, consent proxy, status callbacks, at least 95% provider-eligible delivery, an approved profile, and spend alerts are proven.",
  }),
  makeGate({
    id: "make",
    title: "Make provisioning safety",
    evidence: "make-readiness.json",
    pass: (value) => value.summary?.highRiskGaps === 0 && value.summary?.unauthenticatedExternalPiiRequests === 0 && value.summary?.inactiveWithHooks === 0,
    requirement: "No high-risk provisioning, idempotency, authentication, error-route, or private-execution-history gap remains.",
  }),
  makeGate({
    id: "calls",
    title: "Assistant conversation quality",
    evidence: "vapi-call-gate.json",
    pass: (value) => value.ready === true && value.totalRuns >= 100 && value.passRate >= 0.95,
    requirement: "At least 100 safe Vapi mock conversations pass at 95% or better.",
    limitation: "Carrier audio, accents, and background noise still require a controlled telephone pilot.",
  }),
  makeGate({
    id: "stripe",
    title: "Trial-to-paid Stripe lifecycle",
    evidence: "stripe-trial-gate.json",
    pass: (value) => value.ready === true && value.consecutivePasses >= 5,
    requirement: "Five consecutive Stripe test-clock cycles prove trial, pause, secure card handoff, activation, decline, and cancellation.",
  }),
  makeGate({
    id: "human_pilot",
    title: "Unassisted customer pilot",
    evidence: "human-pilot-gate.json",
    pass: (value) => value.ready === true && value.participants >= 5 && value.unassistedSuccesses >= 4 && value.criticalFailures === 0,
    requirement: "At least four of five new testers finish the complete journey without help and no critical failure remains.",
    maxAgeHours: 720,
  }),
];

const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  readyToShip: gates.every((gate) => gate.status === "passed"),
  summary: {
    passed: gates.filter((gate) => gate.status === "passed").length,
    failed: gates.filter((gate) => gate.status === "failed").length,
    notRun: gates.filter((gate) => gate.status === "not_run").length,
    total: gates.length,
  },
  gates,
  rule: "A missing, stale, or failed critical gate keeps shipping closed. Reports are generated evidence and are not committed.",
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`Shipping readiness report written to ${outputPath}`);
if (strict && !report.readyToShip) process.exitCode = 2;
