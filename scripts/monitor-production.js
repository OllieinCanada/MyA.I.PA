require("dotenv").config({
  path: process.env.OPERATIONS_ENV_FILE || ".env.local",
});

const fs = require("fs");
const path = require("path");
const {
  buildIncidentTelegramAlert,
  humanizeIncidentReason,
  redactIncidentText,
  validAdminUrl,
} = require("../server/incidentAlerts");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const timeoutMs = Math.max(1000, Number(process.env.MONITOR_TIMEOUT_MS || 10000));
const recheckDelayMs = Math.max(1000, Number(process.env.MONITOR_RECHECK_DELAY_MS || 15000));
const siteUrl = String(process.env.MONITOR_SITE_URL || "https://www.myaipa.ca/").trim();
const apiUrl = String(process.env.MONITOR_API_URL || "https://api.myaipa.ca/api/health").trim();
const readyUrl = String(process.env.MONITOR_READY_URL || "https://api.myaipa.ca/api/health/ready").trim();
const operationalUrl = String(process.env.MONITOR_OPERATIONAL_URL || "https://api.myaipa.ca/api/internal/operations/health").trim();
const monitorApiKey = String(process.env.MONITOR_API_KEY || "").trim();
const adminAppUrl = String(process.env.MONITOR_ADMIN_URL || "https://www.myaipa.ca/#/admin").trim();
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

function safeDiagnosticLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 80);
}

function safeIncidentId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || "")) ? String(value).toLowerCase() : "";
}

function safeOperationalText(value, fallback = "") {
  const text = redactIncidentText(String(value || ""))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return text || fallback;
}

function redactOperationalIssues(payload) {
  const allowedDiagnosticKeys = [
    "status",
    "paymentStatus",
    "makeStatus",
    "makeError",
    "smsRoutingStatus",
    "signupSource",
    "reviewRequired",
    "emailVerified",
    "smsVerified",
    "hasAssignedPhone",
    "hasAssistant",
    "hasCheckout",
    "hasSubscription",
    "phoneProvisioningStatus",
    "phoneProvisioningCode",
    "makeResponseKind",
    "signupAlertFailed",
    "retryPayloadAvailable",
    "providerLookup",
    "assignedPhoneKnownToTwilio",
    "assignedPhoneKnownToVapi",
    "vapiAssistantAssigned",
    "staleArchiveEligible",
    "lastErrorCode",
    "errorCode",
    "deliveryStatus",
    "requiresReconciliation",
  ];
  return (Array.isArray(payload?.issues) ? payload.issues : [])
    .slice(0, 100)
    .map((issue) => ({
      id: safeIncidentId(issue.id),
      kind: safeDiagnosticLabel(issue.kind),
      severity: safeDiagnosticLabel(issue.severity),
      title: safeOperationalText(issue.title, "Operational issue"),
      summary: safeOperationalText(issue.summary),
      businessName: safeOperationalText(issue.businessName, ""),
      ageMinutes: Number.isFinite(Number(issue.ageMinutes)) ? Number(issue.ageMinutes) : null,
      targetType: safeDiagnosticLabel(issue.targetType),
      targetId: safeIncidentId(issue.targetId),
      actions: (Array.isArray(issue.actions) ? issue.actions : [])
        .map(safeDiagnosticLabel)
        .filter(Boolean)
        .slice(0, 10),
      diagnostics: Object.fromEntries(
        allowedDiagnosticKeys
          .filter((key) => Object.prototype.hasOwnProperty.call(issue.diagnostics || {}, key))
          .map((key) => {
            const value = issue.diagnostics[key];
            if (typeof value === "boolean" || value == null || Number.isFinite(Number(value))) {
              return [key, value];
            }
            return [key, safeDiagnosticLabel(value)];
          })
      ),
      ...(issue.incident && typeof issue.incident === "object" ? {
        incident: {
          reasonCode: safeDiagnosticLabel(issue.incident.reasonCode),
          reason: safeOperationalText(issue.incident.reason),
          impact: safeOperationalText(issue.incident.impact),
          lastCheckpoint: safeOperationalText(issue.incident.lastCheckpoint),
          nextAction: safeOperationalText(issue.incident.nextAction),
          confidence: safeDiagnosticLabel(issue.incident.confidence),
        },
      } : {}),
      ...(issue.snapshot && typeof issue.snapshot === "object" && !Array.isArray(issue.snapshot) ? {
        snapshot: Object.fromEntries(Object.entries(issue.snapshot)
          .slice(0, 12)
          .map(([key, value]) => [
            safeOperationalText(key, "Detail"),
            safeOperationalText(Array.isArray(value) ? value.join(" · ") : value, "unknown"),
          ])),
      } : {}),
    }));
}

function redactOperationalSignupIssues(payload) {
  return redactOperationalIssues(payload).filter((issue) => issue.targetType === "signup");
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
    const probeError = healthy
      ? ""
      : !response.ok
        ? `http_${response.status}`
        : expectJson && payload == null
          ? "invalid_json"
          : payload?.dependencies?.database === "unavailable"
            ? "database_unavailable"
            : "unhealthy_response";
    return {
      name,
      url: publicUrl(url),
      healthy,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...(probeError ? { error: probeError } : {}),
      ...(expectJson
        ? {
            service: typeof payload?.service === "string" ? payload.service : null,
            database: typeof payload?.dependencies?.database === "string"
              ? payload.dependencies.database
              : null,
            attentionTotal: Number.isFinite(Number(payload?.attention?.total)) ? Number(payload.attention.total) : null,
            attentionCritical: Number.isFinite(Number(payload?.attention?.bySeverity?.critical)) ? Number(payload.attention.bySeverity.critical) : null,
            operationalIssues: name === "operational_health" ? redactOperationalIssues(payload) : [],
            signupIssues: name === "operational_health" ? redactOperationalSignupIssues(payload) : [],
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

function formatTorontoTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildTelegramChecklist(report, { sha = process.env.GITHUB_SHA || "" } = {}) {
  const checks = new Map((Array.isArray(report?.checks) ? report.checks : []).map((check) => [check.name, check]));
  const publicSite = checks.get("public_site");
  const liveness = checks.get("api_liveness");
  const readiness = checks.get("api_readiness");
  const operations = checks.get("operational_health");
  const signupIssues = Array.isArray(operations?.signupIssues) ? operations.signupIssues : [];
  const operationalIssues = Array.isArray(operations?.operationalIssues)
    ? operations.operationalIssues
    : signupIssues;
  const failedSignups = signupIssues.filter((issue) => issue.kind === "signup_failed").length;
  const incompleteSignups = signupIssues.filter((issue) => issue.kind === "signup_stuck").length;
  const critical = Number.isFinite(Number(operations?.attentionCritical))
    ? Number(operations.attentionCritical)
    : signupIssues.filter((issue) => issue.severity === "critical").length;
  const total = Number.isFinite(Number(operations?.attentionTotal))
    ? Number(operations.attentionTotal)
    : signupIssues.length;
  const warningCount = Math.max(0, total - critical);
  const icon = (check) => check?.healthy ? "✅" : "🔴";
  const status = (check) => check?.healthy ? "Online" : `Needs attention (${check?.status || check?.error || "failed"})`;
  const databaseHealthy = readiness?.healthy && readiness?.database === "reachable";
  const shortSha = /^[a-f0-9]{7,40}$/i.test(String(sha)) ? String(sha).slice(0, 7) : "unknown";
  const topIssue = operationalIssues.find((issue) => issue.severity === "critical") || operationalIssues[0];

  return [
    "MY AI PA — ROUTINE STATUS CHECK",
    report?.ok ? "Overall: ✅ All monitored systems healthy" : "Overall: 🟡 Service online; follow-up needed",
    "",
    `${icon(publicSite)} Website: ${status(publicSite)}`,
    `${icon(liveness)} API: ${status(liveness)}`,
    `${databaseHealthy ? "✅" : "🔴"} Database: ${databaseHealthy ? "Reachable" : "Needs attention"}`,
    `${icon(operations)} Operations: ${critical} critical · ${warningCount} warning`,
    "",
    "SIGNUP CHECKLIST",
    `${failedSignups === 0 ? "✅" : "🔴"} Failed signups: ${failedSignups}`,
    `${incompleteSignups === 0 ? "✅" : "🟡"} Incomplete signups: ${incompleteSignups}`,
    `${signupIssues.length === 0 ? "✅" : "🟡"} Signups requiring review: ${signupIssues.length}`,
    ...(topIssue ? [
      "",
      "NEXT ITEM TO REVIEW",
      `${safeOperationalText(topIssue.title, "Operational issue")}`,
      `Reason: ${topIssue.incident?.reason || humanizeIncidentReason(topIssue.incident?.reasonCode || topIssue.diagnostics?.phoneProvisioningCode || topIssue.diagnostics?.errorCode, topIssue.summary)}`,
      `Action: ${topIssue.incident?.nextAction || "Open the Attention inbox and review the affected workflow."}`,
    ] : []),
    "",
    "✅ Automatic checks: every 5 minutes",
    "✅ Immediate failure alerts: enabled",
    `Checked: ${formatTorontoTime(report?.checkedAt)}`,
    `Release: ${shortSha}`,
    "",
    "No customer contact details are included in this message.",
  ].join("\n");
}

function telegramCredentials() {
  return {
    token: String(process.env.TELEGRAM_BOT_TOKEN || "").trim(),
    chatId: String(process.env.TELEGRAM_CHAT_ID || "").trim(),
  };
}

function incidentAdminUrl(issue) {
  const incidentId = safeIncidentId(issue?.id);
  const base = adminAppUrl.includes("?") ? adminAppUrl : `${adminAppUrl}?tab=attention`;
  return incidentId ? `${base}&incident=${incidentId}` : base;
}

function selectOperationalIssue(issues = []) {
  const priority = { critical: 0, warning: 1, info: 2 };
  return [...issues].sort((left, right) => {
    const severityOrder = (priority[left?.severity] ?? 9) - (priority[right?.severity] ?? 9);
    if (severityOrder) return severityOrder;
    const leftAge = Number.isFinite(Number(left?.ageMinutes)) ? Number(left.ageMinutes) : Number.MAX_SAFE_INTEGER;
    const rightAge = Number.isFinite(Number(right?.ageMinutes)) ? Number(right.ageMinutes) : Number.MAX_SAFE_INTEGER;
    return leftAge - rightAge;
  })[0] || null;
}

function buildProductionIncidentAlert(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const operations = checks.find((check) => check.name === "operational_health");
  const issues = Array.isArray(operations?.operationalIssues)
    ? operations.operationalIssues
    : Array.isArray(operations?.signupIssues) ? operations.signupIssues : [];
  const failedInfrastructureChecks = checks.filter((check) => !check.healthy && check.name !== "operational_health");
  const issue = failedInfrastructureChecks.length ? null : selectOperationalIssue(issues);
  if (issue) {
    const diagnostics = issue.diagnostics || {};
    const reasonCode = issue.incident?.reasonCode
      || diagnostics.phoneProvisioningCode
      || diagnostics.errorCode
      || (diagnostics.makeError ? "MAKE_SIGNUP_FAILED" : "");
    const workflow = issue.targetType === "signup"
      ? "14-day trial signup and phone-agent setup"
      : String(issue.kind || "operational workflow").replace(/_/g, " ");
    const snapshot = {
      ...(issue.snapshot || {}),
      Business: issue.businessName || "Business name unavailable",
      Workflow: workflow,
      Stage: diagnostics.status || issue.kind || "unknown",
      ...(issue.targetType === "signup" ? {
        "Contact verified": diagnostics.emailVerified || diagnostics.smsVerified ? "yes" : "not yet",
        "AI number assigned": diagnostics.hasAssignedPhone ? "yes" : "no",
        "Assistant assigned": diagnostics.hasAssistant ? "yes" : "no",
        "Trial/billing started": diagnostics.hasSubscription ? "yes" : "no",
      } : {}),
      ...(issues.length > 1 ? {
        "Other active issues": [...issues]
          .filter((item) => item.id !== issue.id)
          .sort((left, right) => (Number(left.ageMinutes) || 0) - (Number(right.ageMinutes) || 0))
          .slice(0, 3)
          .map((item) => `${item.severity || "warning"}: ${item.title || item.kind || "operational issue"}`),
      } : {}),
    };
    return buildIncidentTelegramAlert({
      severity: issue.severity,
      whatFailed: issue.title || "An operational workflow needs attention",
      reasonCode,
      reason: issue.incident?.reason || issue.summary,
      impact: issue.incident?.impact || issue.summary || "The affected workflow may not complete until it is reviewed.",
      snapshot,
      lastCheckpoint: issue.incident?.lastCheckpoint || "See the stage shown in the snapshot.",
      nextAction: issue.incident?.nextAction || "Open the exact incident, confirm the provider state, and retry only after it is safe.",
      incidentId: issue.id,
      detectedAt: report?.checkedAt,
      adminUrl: incidentAdminUrl(issue),
    });
  }

  const failed = failedInfrastructureChecks.length
    ? failedInfrastructureChecks
    : checks.filter((check) => !check.healthy);
  const first = failed[0] || {};
  const reasonCode = first.database === "unavailable" || first.error === "database_unavailable"
    ? "DATABASE_UNAVAILABLE"
    : first.error === "timeout"
      ? "SERVICE_TIMEOUT"
      : first.error === "invalid_json" || first.error === "unhealthy_response"
        ? "INVALID_HEALTH_RESPONSE"
        : first.status && first.status >= 400
          ? `HTTP_${first.status}`
          : "SERVICE_UNREACHABLE";
  const observedReason = first.error === "invalid_json"
    ? "The health endpoint returned HTTP 200 without valid JSON."
    : first.error === "unhealthy_response"
      ? "The health endpoint returned HTTP 200 but did not confirm a healthy service."
      : first.error === "database_unavailable"
        ? "The readiness check confirmed that the production database was unavailable."
        : first.error || (first.status ? `Health check returned HTTP ${first.status}.` : "The health check did not return a usable response.");
  return buildIncidentTelegramAlert({
    severity: "critical",
    whatFailed: first.name ? `${String(first.name).replace(/_/g, " ")} health check` : "Production health check",
    reasonCode,
    reason: observedReason,
    impact: first.name === "public_site" ? "Visitors may be unable to open My AI PA." : "One or more My AI PA workflows may be unavailable.",
    snapshot: {
      Service: first.name || "unknown",
      URL: publicUrl(first.url || ""),
      Status: first.error || first.status || "failed",
      "Response time": Number.isFinite(Number(first.durationMs)) ? `${Number(first.durationMs)} ms` : "unknown",
    },
    lastCheckpoint: "The monitor confirmed the failure with a second check when confirmation was enabled.",
    nextAction: "Open the admin dashboard and hosting logs, then verify the failed service before retrying customer work.",
    detectedAt: report?.checkedAt,
    adminUrl: incidentAdminUrl(null),
  });
}

async function sendTelegramText(text, { adminUrl = "", buttonText = "Open exact incident" } = {}) {
  const { token, chatId } = telegramCredentials();
  if (!token || !chatId) return { attempted: false, reason: "telegram_not_configured" };
  const safeAdminUrl = validAdminUrl(adminUrl);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(safeAdminUrl ? {
          reply_markup: {
            inline_keyboard: [[{ text: buttonText, url: safeAdminUrl }]],
          },
        } : {}),
      }),
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(7_000) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return {
      attempted: true,
      accepted: Boolean(response.ok && data?.ok === true),
      status: response.status,
      ...(!response.ok || data?.ok !== true ? { reason: safeOperationalText(data?.description, "telegram_rejected") } : {}),
    };
  } catch (error) {
    return {
      attempted: true,
      accepted: false,
      status: null,
      reason: error?.name === "AbortError" || error?.name === "TimeoutError" ? "telegram_timeout" : "telegram_request_failed",
    };
  }
}

async function sendTelegramFailure(report) {
  if (!args.has("--telegram-on-failure") || report.ok) return { attempted: false };
  const operations = report.checks.find((check) => check.name === "operational_health");
  const issues = Array.isArray(operations?.operationalIssues)
    ? operations.operationalIssues
    : Array.isArray(operations?.signupIssues) ? operations.signupIssues : [];
  const hasInfrastructureFailure = report.checks.some((check) => !check.healthy && check.name !== "operational_health");
  const issue = hasInfrastructureFailure ? null : selectOperationalIssue(issues);
  return sendTelegramText(buildProductionIncidentAlert(report), {
    adminUrl: incidentAdminUrl(issue),
    buttonText: issue?.id ? "Open exact incident" : "Open My AI PA admin",
  });
}

async function sendTelegramChecklist(report) {
  if (!args.has("--telegram-checklist")) return { attempted: false };
  return sendTelegramText(buildTelegramChecklist(report));
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
  report.checklist = await sendTelegramChecklist(report);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report saved: ${reportPath}`);
  const checklistFailed = args.has("--telegram-checklist") && report.checklist?.accepted !== true;
  if (checklistFailed || (!report.ok && !args.has("--no-fail-exit"))) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Production monitor failed safely: ${String(error?.message || error).slice(0, 240)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildProductionIncidentAlert,
  buildTelegramChecklist,
  formatTorontoTime,
  incidentAdminUrl,
  selectOperationalIssue,
  redactOperationalIssues,
  redactOperationalSignupIssues,
  safeDiagnosticLabel,
};
