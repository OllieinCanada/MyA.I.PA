const path = require("path");
const { nodeCommand, rootPath, run } = require("./_helpers");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const skipPages = process.argv.includes("--skip-pages");

const steps = [
  ["Backend security and provider unit tests", npmCommand, ["run", "test:backend"]],
  ["Legal draft package validation", npmCommand, ["run", "legal:validate"]],
  ["Tracked secret scan", nodeCommand(), [path.join("scripts", "scan-secrets.js")]],
  ["Render blueprint validation", npmCommand, ["run", "render:validate"]],
  ["Backend deployment preflight", npmCommand, ["run", "backend:check"]],
  ["Prisma schema validation", npxCommand, ["prisma", "validate"]],
  ["Production dependency audit", npmCommand, ["audit", "--omit=dev"]],
  ["Signup configuration diagnostic", npmCommand, ["run", "diagnose:signup"]],
  ...(!skipPages ? [["Production Pages build", npmCommand, ["run", "build:pages"]]] : []),
];

console.log("My AI PA local release gate");
console.log("===========================");
for (const [label, command, args] of steps) {
  console.log(`\n[release-gate] ${label}`);
  run(command, args, { cwd: rootPath() });
}

console.log("\nRelease gate passed.");
if (skipPages) console.log("Production Pages build was intentionally skipped for this non-website commit; CI and the combined release must run it.");
console.log("Live API, provider credentials, real calls/messages, completed legal documents, counsel approval, and external deployment still require separate verification.");
