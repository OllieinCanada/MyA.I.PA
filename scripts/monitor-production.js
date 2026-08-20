require("dotenv").config({
  path: process.env.OPERATIONS_ENV_FILE || ".env.local",
});

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const timeoutMs = Math.max(1000, Number(process.env.MONITOR_TIMEOUT_MS || 10000));
const recheckDelayMs = Math.max(1000, Number(process.env.MONITOR_RECHECK_DELAY_MS || 15000));
const siteUrl = String(process.env.MONITOR_SITE_URL || "https://www.myaipa.ca/").trim();
const apiUrl = String(process.env.MONITOR_API_URL || "https://api.myaipa.ca/api/health").trim();
const readyUrl = String(process.env.MONITOR_READY_URL || "https://api.myaipa.ca/api/health/ready").trim();
const operationalUrl = String(process.env.MONITOR_OPERATIONAL_URL || "https://api.myaipa.ca/api/internal/operations/health").trim();
const monitorApiKey = String(process.env.MONITOR_API_KEY || "").trim();
const reportPath = path.resolve(
  root,
  process.env.MONITOR_REPORT_PATH || "diagnostics/operations/production-monitor.json"
);

function publicUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

async function probe(name, url, { expectJson = false, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "MyAIPA-Operations-Monitor/1.0", ...headers },
    });
    let payload = null;
    if (expectJson) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    const healthy = response.ok && (!expectJson || payload?.ok === true);
    return {
      name,
      url: publicUrl(url),
      healthy,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...(expectJson
        ? {
            service: typeof payload?.service === "string" ? payload.service : null,
            database: typeof payload?.dependencies?.database === "string"
              ? payload.dependencies.database
              : null,
            attentionTotal: Number.isFinite(Number(payload?.attention?.total)) ? Number(payload.attention.total) : null,
            attentionCritical: Number.isFinite(Number(payload?.attention?.bySeverity?.critical)) ? Number(payload.attention.bySeverity.critical) : null,
          }
        : {}),
    };
  } catch (error) {
    return {
      name,
      url: publicUrl(url),
      healthy: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "timeout" : "request_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function checkSpecs() {
  const specs = [
    ["public_site", siteUrl, {}],
    ["api_liveness", apiUrl, { expectJson: true }],
    ...(args.has("--skip-ready") ? [] : [["api_readiness", readyUrl, { expectJson: true }]]),
  ];
  if (args.has("--include-operational") && monitorApiKey) {
    specs.push(["operational_health", operationalUrl, { expectJson: true, headers: { authorization: `Bearer ${monitorApiKey}` } }]);
  }
  return specs;
}

async function runChecks(specs = checkSpecs()) {
  return Promise.all(specs.map(([name, url, options]) => probe(name, url, options)));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramFailure(report) {
  if (!args.has("--telegram-on-failure") || report.ok) return { attempted: false };
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return { attempted: false, reason: "telegram_not_configured" };

  const failed = report.checks
    .filter((check) => !check.healthy)
    .map((check) => `${check.name}: ${check.status || check.error || "failed"}`)
    .join("\n");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `My AI PA production monitor alert\n${failed}\nChecked: ${report.checkedAt}`,
      disable_web_page_preview: true,
    }),
  });
  return { attempted: true, accepted: response.ok, status: response.status };
}

async function main() {
  const specs = checkSpecs();
  const firstChecks = await runChecks(specs);
  let confirmation = null;
  let checks = firstChecks;
  if (args.has("--confirm-failure") && firstChecks.some((check) => !check.healthy)) {
    await wait(recheckDelayMs);
    const failedNames = new Set(firstChecks.filter((check) => !check.healthy).map((check) => check.name));
    const secondChecks = await runChecks(specs.filter(([name]) => failedNames.has(name)));
    const secondByName = new Map(secondChecks.map((check) => [check.name, check]));
    checks = firstChecks.map((check) => check.healthy ? check : secondByName.get(check.name) || check);
    confirmation = {
      delayMs: recheckDelayMs,
      firstFailed: [...failedNames],
      secondFailed: secondChecks.filter((check) => !check.healthy).map((check) => check.name),
      recovered: secondChecks.filter((check) => check.healthy).map((check) => check.name),
    };
  }
  const report = {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    ok: checks.every((check) => check.healthy),
    checks,
    confirmation,
    warnings: [
      args.has("--include-operational") && !monitorApiKey ? "Operational issue counts were skipped because MONITOR_API_KEY is not configured." : "",
    ].filter(Boolean),
  };
  report.alert = await sendTelegramFailure(report);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report saved: ${reportPath}`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Production monitor failed safely: ${String(error?.message || error).slice(0, 240)}`);
  process.exitCode = 1;
});
