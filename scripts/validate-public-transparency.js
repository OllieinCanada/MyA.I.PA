const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];

function requireMatch(relativePath, pattern, message) {
  const source = read(relativePath);
  if (!pattern.test(source)) failures.push(`${relativePath}: ${message}`);
}

for (const relativePath of [
  "public/cookies.html",
  "public/status.html",
  "public/privacy.html",
  "public/terms.html",
  "public/calendar-data.html",
]) {
  if (!fs.existsSync(path.join(root, relativePath))) failures.push(`${relativePath}: file is missing`);
}

requireMatch("public/cookies.html", /does not currently load third-party advertising pixels or marketing analytics/i, "must state the audited tracker result without claiming that all cookies are absent");
requireMatch("public/cookies.html", /session cookies[\s\S]*session storage[\s\S]*local storage[\s\S]*service-worker cache/i, "must disclose every browser-storage category used by the current site");
requireMatch("public/status.html", /\/api\/health[\s\S]*\/api\/health\/ready/i, "must use the real API and readiness endpoints");
requireMatch("public/status.html", /do not represent historical uptime or a contractual service-level guarantee/i, "must not imply an uptime history or SLA");
requireMatch("src/IntuitiveLandingPage.js", /<footer id="site-footer"[\s\S]*href="\/cookies\.html"[\s\S]*href="\/status\.html"/, "the active landing-page footer must link to both transparency pages");
requireMatch("public/sitemap.xml", /cookies\.html[\s\S]*status\.html/, "sitemap must include both transparency pages");
requireMatch("server/index.js", /app\.get\("\/api\/health"[\s\S]*app\.get\("\/api\/health\/ready"/, "backend health endpoints must still exist");

if (failures.length) {
  console.error("Public transparency validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Public transparency validation passed.");
console.log("Cookie/storage claims match the audited source and the status page uses live point-in-time checks without an SLA claim.");
