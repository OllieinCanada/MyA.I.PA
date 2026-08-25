const path = require("path");
const { nodeCommand, rootPath, run } = require("./_helpers");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const skipPages = process.argv.includes("--skip-pages");
const backendTestFiles = [
  "tests/backend-security.test.js",
  "tests/make-2026-readiness.test.js",
  "tests/make-scenario-inspection.test.js",
  "tests/make-signup-webhook.test.js",
  "tests/persistent-security-state.test.js",
  "tests/sms-suppression.test.js",
  "tests/twilio-sms.test.js",
  "tests/twilio-2026-readiness.test.js",
  "tests/vapi-sms.test.js",
  "tests/vapi-call-diagnostics.test.js",
  "tests/vapi-2026-readiness.test.js",
  "tests/vapi-isolated-sms-provisioning.test.js",
  "tests/vapi-tool-calls.test.js",
  "tests/vapi-tool-security.test.js",
  "tests/vapi-webhook-auth.test.js",
  "tests/composite-call-notifications.test.js",
  "tests/lead-handoffs.test.js",
  "tests/revenue-rescue.test.js",
  "tests/jobber-integration.test.js",
  "tests/trade-playbooks.test.js",
  "tests/safe-website-fetch.test.js",
  "tests/appointment-requests.test.js",
  "tests/calendar-integrations.test.js",
  "tests/trial-usage-policy.test.js",
  "tests/voice-signup.test.js",
];
const backendTestSteps = backendTestFiles.map((testFile) => [
  `Backend test: ${path.basename(testFile)}`,
  nodeCommand(),
  ["--test", testFile],
]);

const steps = [
  ...backendTestSteps,
  ["Frontend security and signup regression tests", npmCommand, ["test", "--", "--watchAll=false"]],
  ["Legal draft package validation", nodeCommand(), [path.join("scripts", "validate-legal-drafts.js")]],
  ["Operational readiness validation", nodeCommand(), [path.join("scripts", "validate-operational-readiness.js")]],
  ["Tracked secret scan", nodeCommand(), [path.join("scripts", "scan-secrets.js")]],
  ["Render blueprint validation", nodeCommand(), [path.join("scripts", "validate-render-blueprint.js")]],
  ["Backend deployment preflight", nodeCommand(), [path.join("scripts", "check-backend-deploy.js")]],
  [
    "Prisma schema validation",
    nodeCommand(),
    [path.join("node_modules", "prisma", "build", "index.js"), "validate"],
    {
      env: {
        DATABASE_URL:
          process.env.DATABASE_URL ||
          "postgresql://release_validation:release_validation@127.0.0.1:5432/release_validation",
      },
    },
  ],
  ["Production dependency audit", npmCommand, ["audit", "--omit=dev"]],
  ["Signup configuration diagnostic", nodeCommand(), [path.join("scripts", "diagnose-signup.js")]],
  ...(!skipPages ? [["Production Pages build", nodeCommand(), [path.join("scripts", "build-pages.js")]]] : []),
];

console.log("My AI PA local release gate");
console.log("===========================");
for (const [label, command, args, options = {}] of steps) {
  console.log(`\n[release-gate] ${label}`);
  run(command, args, { cwd: rootPath(), ...options });
}

console.log("\nRelease gate passed.");
if (skipPages) console.log("Production Pages build was intentionally skipped for this run; execute it separately or through the combined release before publishing.");
console.log("Live API, provider credentials, real calls/messages, completed legal documents, counsel approval, and external deployment still require separate verification.");
