const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
if (tracked.status !== 0) {
  console.error("Could not list tracked files for secret scan.");
  process.exit(1);
}
const includeUntracked = process.argv.includes("--include-untracked");
const untracked = includeUntracked
  ? spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
  : { status: 0, stdout: "" };
if (untracked.status !== 0) {
  console.error("Could not list untracked files for secret scan.");
  process.exit(1);
}
const candidatePaths = [...new Set([
  ...tracked.stdout.split("\0"),
  ...untracked.stdout.split("\0"),
].filter(Boolean))];

const tokenPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ["Stripe live secret", /\bsk_live_[A-Za-z0-9]{16,}\b/],
  ["OpenAI secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub token", /\bgh[opusr]_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];
const assignmentPattern = /^\s*(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|OPENAI_API_KEY|VAPI_API_KEY|TWILIO_AUTH_TOKEN|TWILIO_API_KEY_SECRET|ADMIN_PASSWORD|ADMIN_SESSION_SECRET|MAKE_API_TOKEN|MAKE_SIGNUP_WEBHOOK_API_KEY|INTEGRATION_API_KEY|DATABASE_URL)\s*=\s*(.+?)\s*$/;
const ignoredPrefixes = ["docs/static/", "output/", "diagnostics/", "tools_bin/"];
const findings = [];

for (const relativePath of candidatePaths) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (ignoredPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) continue;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");

  text.split(/\r?\n/).forEach((line, index) => {
    for (const [label, pattern] of tokenPatterns) {
      if (pattern.test(line)) findings.push({ relativePath, line: index + 1, label });
    }
    const assignment = line.match(assignmentPattern);
    const assignmentScanApplies = !normalized.endsWith(".md") && !normalized.includes(".example");
    if (assignment && assignmentScanApplies) {
      const value = assignment[2].trim().replace(/^['"]|['"]$/g, "");
      const placeholder = !value || /^(change-me|replace-me|example|test|your[-_]|\[|<)/i.test(value);
      if (!placeholder) findings.push({ relativePath, line: index + 1, label: `${assignment[1]} assignment` });
    }
  });
}

if (findings.length) {
  console.error("Potential tracked secrets found (values are intentionally not printed):");
  findings.forEach((finding) => console.error(`- ${finding.relativePath}:${finding.line} (${finding.label})`));
  process.exit(1);
}

console.log(`Secret scan passed (${candidatePaths.length} ${includeUntracked ? "tracked and untracked" : "tracked"} files considered).`);
