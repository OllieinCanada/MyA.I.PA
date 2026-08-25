const path = require("path");
const { nodeCommand, rootPath, run } = require("./_helpers");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const skipPages = process.argv.includes("--skip-pages");

const steps = [
  ["Backend security and provider tests", npmCommand, ["run", "test:backend"]],
  ["Frontend security and signup regression tests", npmCommand, ["test", "--", "--watchAll=false"]],
  ["Public transparency validation", npmCommand, ["run", "transparency:validate"]],
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
  ...(!skipPages
    ? [
        ["Production Pages build", nodeCommand(), [path.join("scripts", "build-pages.js")]],
        ["Browser journeys, accessibility, and responsive layout checks", npmCommand, ["run", "test:browser:quality"]],
      ]
    : []),
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
