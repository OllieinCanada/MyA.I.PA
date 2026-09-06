const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadProjectEnv, rootPath } = require("./_helpers");

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  const argument = process.argv.find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const apply = process.argv.includes("--post");
const count = Number(option("count", "20"));
const confirmation = option("confirm");
const confirmationPhrase = "RUN_REVIEW_SIGNUP_GATE";
const env = loadProjectEnv();
const apiBaseUrl = String(option("api-base-url", env.SHIPPING_SIGNUP_TEST_API_BASE_URL || "")).replace(/\/+$/, "");
const reportPath = rootPath("diagnostics", "shipping-readiness", "signup-review-gate.json");

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function checkArguments() {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("--count must be an integer from 1 to 50.");
  }
  if (apply && confirmation !== confirmationPhrase) {
    throw new Error(`Review-only test mode requires --confirm=${confirmationPhrase}.`);
  }
  if (apply && !/^https?:\/\//i.test(apiBaseUrl)) {
    throw new Error("Set SHIPPING_SIGNUP_TEST_API_BASE_URL or --api-base-url to the dedicated signup test environment.");
  }
  const host = apiBaseUrl ? new URL(apiBaseUrl).hostname.toLowerCase() : "";
  if (apply && count > 5 && ["api.myaipa.ca", "www.myaipa.ca", "myaipa.ca"].includes(host)) {
    throw new Error("High-volume signup gates are refused against production. Use the dedicated Render test environment; production smoke tests are limited to five submissions.");
  }
}

function main() {
  checkArguments();
  if (!apply) {
    console.log(`Dry run only. This will submit ${count} synthetic disposable-email signups to a configured review-only test environment.`);
    console.log("The child harness verifies no phone, assistant, Stripe customer, subscription, or Checkout session is created.");
    console.log(`Run with --post --confirm=${confirmationPhrase}.`);
    return;
  }

  const startedAt = new Date().toISOString();
  const runStamp = Date.now();
  const results = [];
  for (let index = 1; index <= count; index += 1) {
    const detailName = `diagnostics/shipping-readiness/signup-review-${runStamp}-${String(index).padStart(2, "0")}.json`;
    const child = spawnSync(
      process.execPath,
      [path.join(__dirname, "test-signup-sandbox-harness.js"), "--post", "--out", detailName],
      {
        cwd: rootPath(),
        env: { ...process.env, PUBLIC_API_BASE_URL: apiBaseUrl },
        encoding: "utf8",
      }
    );
    if (child.status !== 0) {
      results.push({ index, passed: false, reason: String(child.stderr || child.stdout || "unknown failure").trim().slice(0, 500) });
      break;
    }
    const detailPath = rootPath(detailName);
    const detail = JSON.parse(fs.readFileSync(detailPath, "utf8"));
    const passed = Object.values(detail.checks || {}).every((value) => value === "passed");
    results.push({ index, passed, externalResourcesAbsent: detail.checks?.externalResourcesAbsent === "passed" });
    console.log(`Signup ${index}/${count}: ${passed ? "pass" : "fail"}`);
    if (!passed) break;
  }

  const consecutivePasses = results.findIndex((item) => !item.passed);
  const passed = results.filter((item) => item.passed).length;
  const report = {
    checkedAt: new Date().toISOString(),
    startedAt,
    mode: "review-only-test-environment",
    targetHost: new URL(apiBaseUrl).hostname,
    requested: count,
    attempted: results.length,
    passed,
    failed: results.filter((item) => !item.passed).length,
    consecutivePasses: consecutivePasses === -1 ? passed : consecutivePasses,
    externalProvisioningBlocked: results.every((item) => item.externalResourcesAbsent !== false),
    ready: count >= 20 && passed === count && results.every((item) => item.externalResourcesAbsent === true),
    failures: results.filter((item) => !item.passed),
  };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Signup gate report written to ${reportPath}`);
  if (!report.ready) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
