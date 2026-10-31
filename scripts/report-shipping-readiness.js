const fs = require("fs");
const path = require("path");
const { rootPath } = require("./_helpers");
const { spawnSync } = require("node:child_process");
const proof = require("./launch-evidence");
const expectedRelease = process.env.READINESS_RELEASE_COMMIT || String(spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: rootPath(), encoding: "utf8", windowsHide: true, timeout: 10000,
}).stdout || "").trim();

const strict = process.argv.includes("--strict");
const evidenceDir = rootPath("diagnostics", "shipping-readiness");
const outputPath = path.join(evidenceDir, "shipping-readiness.json");

function readEvidence(name) {
  const filePath = path.resolve(evidenceDir, name);
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
    id: "browser",
    title: "Public-page browser and accessibility quality",
    evidence: "browser-quality-gate.json",
    pass: (value) => value.ready === true && Number(value.completedChecks || 0) >= 31,
    requirement: "Homepage, signup, trade hub, and all six trade pages pass desktop, tablet, mobile, keyboard, accessibility, image-failure, slow-image, and narrow reflow checks.",
  }),
  makeGate({
    id: "signup_security",
    title: "Public signup security configuration",
    evidence: "../security/credential-readiness-latest.json",
    pass: (value) => value.signupControls?.publicSelfServiceReady === true,
    requirement: "Turnstile, SMTP, email verification, admin TOTP, encrypted backups, and automatic self-service mode are all explicitly configured.",
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
    id: "privacy_model",
    title: "Synthetic privacy policy model (not application proof)",
    evidence: "../operations/privacy-request-drill.json",
    pass: proof.privacyModelPassed,
    requirement: "Synthetic policy-model checks pass without claiming actual application or provider deletion.",
    limitation: "Standalone arrays do not exercise application handlers, provider retention, legal holds or real backup replay.",
  }),
  makeGate({
    id: "privacy", title: "Isolated application privacy and deletion proof",
    evidence: "privacy-application-gate.json",
    pass: value => proof.privacyApplicationPassed(value, expectedRelease),
    requirement: "Exact-release application handlers prove tenant scope, correction, withdrawal, erasure, suppression retention, holds, redaction and restore replay on synthetic data.",
  }),
  makeGate({
    id: "legal_approval", title: "Owner and counsel launch approval",
    evidence: "legal-approval-gate.json", pass: value => proof.legalApprovalPassed(value, expectedRelease),
    requirement: "Owner and counsel approve identity/contact, privacy officer, retention, processor dispositions, procedures and disclosures with zero unresolved placeholders.",
    maxAgeHours: 720,
  }),
  makeGate({
    id: "alert_delivery", title: "Controlled alert receipt and duplicate protection",
    evidence: "alert-delivery-gate.json", pass: value => proof.alertDeliveryPassed(value, expectedRelease),
    requirement: "One authorized private incident exercise proves notification acceptance, recipient-confirmed receipt, duplicate protection and no customer impact.",
  }),
  makeGate({
    id: "backup_prerequisites",
    title: "Backup tooling and encryption prerequisites only",
    evidence: "backup-readiness.json",
    pass: (value) => value.ready === true && value.databaseUrlConfigured === true && value.encryptionConfigured === true && Boolean(value.pgDumpVersion) && Boolean(value.pgRestoreVersion),
    requirement: "Database URL, encryption and PostgreSQL tools are configured; this does not prove any backup or restoration.",
    maxAgeHours: 168,
  }),
  makeGate({
    id: "logical_restore", title: "Exact-release isolated logical database restoration",
    evidence: process.env.READINESS_RECOVERY_DIRECTORY
      ? path.resolve(process.env.READINESS_RECOVERY_DIRECTORY, "restore.json") : "../provider-hardening/restore.json",
    pass: value => proof.logicalRestorePassed(value, expectedRelease),
    requirement: "One encrypted production logical export is restored to an execution-owned empty loopback database with checksums, table counts, constraints and no dispatch.",
    limitation: "Database-only restoration is not disk/key recovery, PITR failover or complete service recovery.",
    maxAgeHours: 168,
  }),
  makeGate({
    id: "backup", title: "Complete database, disk and key recovery rehearsal",
    evidence: "full-recovery-gate.json", pass: value => proof.fullRecoveryPassed(value, expectedRelease),
    requirement: "Owner-approved data-loss and recovery-time objectives are measured with coherent database/disk state, key custody, deletion replay and a sealed cutover rehearsal.",
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
    id: "postgres_verification",
    title: "Transactional PostgreSQL verification storage",
    evidence: "postgres-verification-gate.json",
    pass: (value) => (
      value.ready === true
      && value.schemaApplied === true
      && value.databaseIntegrationPassed === true
      && value.verificationConcurrencyPassed === true
      && value.productionDatabaseTouched === false
      && value.disposableDatabaseDeleted === true
    ),
    requirement: "The real Prisma schema and concurrent one-time verification claims pass on an isolated PostgreSQL database that is deleted afterward.",
    maxAgeHours: 168,
  }),
  makeGate({
    id: "signup_local_simulation",
    title: "Local signup failure and retry simulation",
    evidence: "signup-local-simulation.json",
    pass: (value) => (
      value.ready === true
      && value.consecutivePasses >= 20
      && value.incompleteMappingsRejected >= 20
      && value.failedDeliveryCallbacksRejected >= 20
      && value.paidCallsOrMessages === 0
      && value.externalResourcesCreated === 0
    ),
    requirement: "20 no-cost local signups prove duplicate safety, provider-timeout recovery, mapping fail-closure, and delivery-failure readiness revocation.",
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
    pass: (value) => value.readiness === "green" && value.safeToActivate === true,
    requirement: "Make is green: no high/medium/review provisioning, idempotency, authentication, legacy-module, error-route, credential-boundary, or private-execution-history gap remains.",
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
    pass: value => proof.stripeProviderPassed(value, expectedRelease),
    requirement: "Five exact-release test-mode provider clock cycles prove pause, activation, paid renewal, decline and actual period-end cancellation; temporary test-object cleanup is confirmed.",
    limitation: "Direct Stripe API calls are not proof of hosted Checkout or application webhook handling.",
  }),
  makeGate({
    id: "stripe_checkout", title: "Hosted test Checkout and application webhook lifecycle",
    evidence: "stripe-checkout-gate.json", pass: value => proof.stripeCheckoutPassed(value, expectedRelease),
    requirement: "An isolated test Checkout exercises signed application webhooks, ownership, duplicate/late events, invoice failures and cancellation without real payments.",
  }),
  makeGate({
    id: "stripe_local_simulation",
    title: "Local Stripe trial-to-payment simulation",
    evidence: "stripe-local-simulation.json",
    pass: proof.localStripePassed,
    requirement: "Five no-network helper simulations execute pause, scoped Checkout parameters, activation, decline, cancellation/replay and late-canceled-setup rejection.",
    limitation: "Mock SDK responses do not prove real provider behavior, hosted Checkout or signed webhook delivery.",
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

const colouredGates = gates.map((gate) => ({
  ...gate,
  color: gate.status === "passed" ? "green" : gate.status === "not_run" ? "yellow" : "red",
}));
const overallColor = colouredGates.some((gate) => gate.color === "red")
  ? "red"
  : colouredGates.some((gate) => gate.color === "yellow")
    ? "yellow"
    : "green";

const report = {
  schemaVersion: 3,
  releaseCommit: /^[a-f0-9]{40}$/.test(expectedRelease) ? expectedRelease : null,
  checkedAt: new Date().toISOString(),
  readiness: overallColor,
  readyToShip: overallColor === "green",
  summary: {
    green: colouredGates.filter((gate) => gate.color === "green").length,
    red: colouredGates.filter((gate) => gate.color === "red").length,
    yellow: colouredGates.filter((gate) => gate.color === "yellow").length,
    passed: colouredGates.filter((gate) => gate.status === "passed").length,
    failed: colouredGates.filter((gate) => gate.status === "failed").length,
    notRun: colouredGates.filter((gate) => gate.status === "not_run").length,
    total: colouredGates.length,
  },
  gates: colouredGates,
  blockers: colouredGates.filter((gate) => gate.color !== "green").map((gate) => ({
    id: gate.id,
    color: gate.color,
    title: gate.title,
    requirement: gate.requirement,
  })),
  rule: "A missing, stale, or failed critical gate keeps shipping closed. Reports are generated evidence and are not committed.",
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`Shipping readiness report written to ${outputPath}`);
if (strict && !report.readyToShip) process.exitCode = 2;
