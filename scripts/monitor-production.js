require("dotenv").config({
  path: process.env.OPERATIONS_ENV_FILE || ".env.local",
});

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  canonicalMonitorState,
  publicMonitorStateRecord,
} = require("./sync-production-monitor-state");
const {
  buildIncidentTelegramAlert,
  buildIncidentRemediationUpdate,
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
const monitorStateSyncWarning = safeDiagnosticLabel(process.env.MONITOR_STATE_SYNC_WARNING);
const adminAppUrl = String(process.env.MONITOR_ADMIN_URL || "https://www.myaipa.ca/#/admin").trim();
const reportPath = path.resolve(
  root,
  process.env.MONITOR_REPORT_PATH || "diagnostics/operations/production-monitor.json"
);
const statePath = path.resolve(
  root,
  process.env.MONITOR_STATE_PATH || "diagnostics/operations/production-monitor-state.json"
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
      ...(issue.remediation && typeof issue.remediation === "object" ? {
        remediation: {
          status: safeDiagnosticLabel(issue.remediation.status),
          action: safeDiagnosticLabel(issue.remediation.action),
          confidence: safeDiagnosticLabel(issue.remediation.confidence),
          automatic: issue.remediation.automatic === true,
          requiresUser: issue.remediation.requiresUser !== false,
          hypothesis: safeOperationalText(issue.remediation.hypothesis),
          proposedSolution: safeOperationalText(issue.remediation.proposedSolution),
          safetyBoundary: safeOperationalText(issue.remediation.safetyBoundary),
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

function countPublicOperationalIssues(issues = []) {
  const counts = { active: 0, critical: 0, warning: 0 };
  for (const issue of Array.isArray(issues) ? issues : []) {
    counts.active += 1;
    if (issue?.severity === "critical") counts.critical += 1;
    if (issue?.severity === "warning") counts.warning += 1;
  }
  return counts;
}

function publicCheckName(value) {
  const name = safeDiagnosticLabel(value);
  return new Set([
    "monitor_lifecycle_state",
    "public_site",
    "api_liveness",
    "api_readiness",
    "operational_health",
  ]).has(name) ? name : "unknown_check";
}

function publicCheckError(value) {
  const code = safeDiagnosticLabel(value);
  return /^(?:http_[1-5][0-9]{2}|timeout|request_failed|invalid_json|unhealthy_response|database_unavailable|monitor_auth_missing|monitor_state_(?:invalid|missing|unavailable))$/.test(code)
    ? code
    : "check_failed";
}

function publicInteger(value) {
  return (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))
    && Number.isInteger(Number(value))
    ? Number(value)
    : null;
}

function publicMonitorReport(report) {
  const checks = (Array.isArray(report?.checks) ? report.checks : []).map((check) => {
    const issues = Array.isArray(check?.operationalIssues)
      ? check.operationalIssues
      : Array.isArray(check?.signupIssues) ? check.signupIssues : [];
    const issueCounts = countPublicOperationalIssues(issues);
    const status = publicInteger(check?.status);
    const durationMs = publicInteger(check?.durationMs);
    const database = ["reachable", "unavailable"].includes(safeDiagnosticLabel(check?.database))
      ? safeDiagnosticLabel(check.database)
      : "unknown";
    return {
      name: publicCheckName(check?.name),
      healthy: check?.healthy === true,
      status,
      durationMs: durationMs == null ? null : Math.max(0, durationMs),
      ...(check?.error ? { error: publicCheckError(check.error) } : {}),
      ...(check?.database ? { database } : {}),
      ...(issues.length ? { issueCounts } : {}),
    };
  });
  const deliveries = Array.isArray(report?.alert?.deliveries) ? report.alert.deliveries : [];
  const deliveryCounts = deliveries.reduce((counts, delivery) => {
    const lifecycle = ["detected", "recovered", "cleared"].includes(delivery?.lifecycle)
      ? delivery.lifecycle
      : "other";
    counts[lifecycle] = (counts[lifecycle] || 0) + 1;
    return counts;
  }, {});
  const safeConfirmation = report?.confirmation && typeof report.confirmation === "object"
    ? {
        delayMs: Number.isFinite(Number(report.confirmation.delayMs))
          ? Math.max(0, Number(report.confirmation.delayMs))
          : null,
        firstFailed: (Array.isArray(report.confirmation.firstFailed) ? report.confirmation.firstFailed : [])
          .map(publicCheckName),
        secondFailed: (Array.isArray(report.confirmation.secondFailed) ? report.confirmation.secondFailed : [])
          .map(publicCheckName),
        recovered: (Array.isArray(report.confirmation.recovered) ? report.confirmation.recovered : [])
          .map(publicCheckName),
      }
    : null;
  const publicDelivery = (delivery) => ({
    attempted: delivery?.attempted === true,
    accepted: delivery?.accepted === true,
    status: publicInteger(delivery?.status),
  });
  const checkedAt = new Date(report?.checkedAt || 0);
  return {
    schemaVersion: 2,
    privacyProjection: "github_public_aggregate_v1",
    checkedAt: Number.isNaN(checkedAt.getTime()) ? null : checkedAt.toISOString(),
    ok: report?.ok === true,
    checks,
    confirmation: safeConfirmation,
    warningCount: Array.isArray(report?.warnings) ? report.warnings.length : 0,
    alert: {
      ...publicDelivery(report?.alert),
      transitionCount: deliveries.length,
      deliveryCounts,
      activeCount: Number.isFinite(Number(report?.alert?.active))
        ? Math.max(0, Number(report.alert.active))
        : null,
    },
    checklist: publicDelivery(report?.checklist),
  };
}

async function probe(name, url, { expectJson = false, headers = {}, configurationError = "" } = {}) {
  if (configurationError) {
    return {
      name,
      url: publicUrl(url),
      healthy: false,
      status: null,
      durationMs: 0,
      error: safeDiagnosticLabel(configurationError),
    };
  }
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
    ...(monitorStateSyncWarning
      ? [["monitor_lifecycle_state", "https://github.com/", { configurationError: monitorStateSyncWarning }]]
      : []),
    ["public_site", siteUrl, {}],
    ["api_liveness", apiUrl, { expectJson: true }],
    ...(args.has("--skip-ready") ? [] : [["api_readiness", readyUrl, { expectJson: true }]]),
  ];
  if (args.has("--include-operational")) {
    specs.push(["operational_health", operationalUrl, monitorApiKey
      ? { expectJson: true, headers: { authorization: `Bearer ${monitorApiKey}` } }
      : { expectJson: true, configurationError: "monitor_auth_missing" }]);
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

function monitorIncidentIdentities(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const operations = checks.find((check) => check.name === "operational_health");
  const issues = Array.isArray(operations?.operationalIssues)
    ? operations.operationalIssues
    : Array.isArray(operations?.signupIssues) ? operations.signupIssues : [];
  const failedChecks = checks.filter((check) => !check.healthy && (
    check.name !== "operational_health" || issues.length === 0
  ));
  const identities = [
    ...failedChecks.map((failedCheck) => {
      const fingerprint = `check:${safeDiagnosticLabel(failedCheck.name)}:${safeDiagnosticLabel(failedCheck.error || failedCheck.status)}`;
      return {
        active: true,
        type: "check",
        checkName: safeDiagnosticLabel(failedCheck.name),
        fingerprint,
        incidentId: crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 24),
        issue: null,
        failedCheck,
      };
    }),
    ...issues.map((issue) => {
      const fingerprint = `issue:${safeIncidentId(issue.id) || safeDiagnosticLabel(issue.kind)}:${safeDiagnosticLabel(issue.incident?.reasonCode || issue.severity)}`;
      return {
        active: true,
        type: "operational",
        checkName: "operational_health",
        fingerprint,
        incidentId: safeIncidentId(issue.id)
          || crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 24),
        issue,
        failedCheck: null,
      };
    }),
  ];
  return [...new Map(identities.map((identity) => [identity.fingerprint, identity])).values()];
}

function monitorIncidentIdentity(report) {
  return monitorIncidentIdentities(report)[0] || {
    active: false,
    type: "healthy",
    checkName: "",
    fingerprint: "healthy",
    incidentId: "",
    issue: null,
    failedCheck: null,
  };
}

function readMonitorState(filePath = statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const source = parsed?.schemaVersion === 2 && parsed.incidents && typeof parsed.incidents === "object"
      ? parsed.incidents
      : parsed?.active && parsed?.fingerprint ? {
          [String(parsed.fingerprint)]: {
            incidentId: parsed.incidentId,
            type: String(parsed.fingerprint).startsWith("issue:") ? "operational" : "check",
            checkName: String(parsed.fingerprint).startsWith("issue:")
              ? "operational_health"
              : String(parsed.fingerprint).split(":")[1] || "",
            firstDetectedAt: parsed.firstDetectedAt,
          },
        } : {};
    return JSON.parse(canonicalMonitorState({
      schemaVersion: 2,
      incidents: Object.fromEntries(Object.entries(source).slice(0, 150)),
    }));
  } catch {
    return { schemaVersion: 2, incidents: {} };
  }
}

function writeMonitorState(filePath, state) {
  const canonical = canonicalMonitorState({
    schemaVersion: 2,
    incidents: Object.fromEntries(Object.entries(state?.incidents || {}).slice(0, 150)),
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, canonical, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function buildMonitorRecoveryUpdate(report, previousState) {
  const check = (Array.isArray(report?.checks) ? report.checks : [])
    .find((item) => item.name === previousState?.checkName);
  const operational = previousState?.type === "operational";
  let lifecycleId = String(previousState?.lifecycleId || "").replace(/^public_/, "");
  if (!safeIncidentId(lifecycleId) && previousState?.fingerprint) {
    try {
      lifecycleId = publicMonitorStateRecord(previousState.fingerprint, {
        type: operational ? "operational" : "check",
        checkName: previousState.checkName,
        firstDetectedAt: previousState.firstDetectedAt || report?.checkedAt,
      }).record.lifecycleId.replace(/^public_/, "");
    } catch {
      lifecycleId = crypto.createHash("sha256")
        .update(`monitor-recovery-v1:${String(previousState.fingerprint || previousState.checkName || "unknown")}`)
        .digest("hex")
        .slice(0, 24);
    }
  }
  return buildIncidentRemediationUpdate({
    status: operational ? "cleared" : "recovered",
    incidentId: lifecycleId,
    completedAt: report?.checkedAt,
    actionTaken: operational
      ? "The production monitor kept the private lifecycle signal open and rechecked the authenticated Needs Attention feed. It did not replay or alter customer work."
      : `The production monitor reran the exact ${String(previousState?.checkName || "service").replace(/_/g, " ")} probe. It did not replay customer work.`,
    verification: operational
      ? "The authenticated operational feed is healthy and no longer reports the same incident signature. This does not by itself prove why it disappeared or that an acknowledged/expired item was repaired."
      : `${String(previousState?.checkName || "service").replace(/_/g, " ")} is responding normally again${check?.status ? ` (HTTP ${check.status})` : ""}. This proves current recovery, not the original request outcome or underlying root cause.`,
    nextAction: "No immediate infrastructure action is required. If the incident returns, use the new report and do not assume the original customer operation completed.",
  });
}

function buildProductionIncidentAlert(report, selectedIdentity = monitorIncidentIdentity(report)) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const operations = checks.find((check) => check.name === "operational_health");
  const issues = Array.isArray(operations?.operationalIssues)
    ? operations.operationalIssues
    : Array.isArray(operations?.signupIssues) ? operations.signupIssues : [];
  const failedInfrastructureChecks = checks.filter((check) => !check.healthy);
  const issue = selectedIdentity?.issue || null;
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
      remediation: issue.remediation || {
        confidence: issue.incident?.confidence || "medium",
        hypothesis: issue.incident?.reason || issue.summary,
        proposedSolution: issue.incident?.nextAction || "Review the saved incident and reconcile provider state before any retry.",
        safetyBoundary: "The monitor reports and rechecks this incident; it does not repeat customer, billing, messaging, or provider-resource actions.",
      },
    });
  }

  const first = selectedIdentity?.failedCheck || failedInfrastructureChecks[0] || {};
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
  const identity = selectedIdentity || monitorIncidentIdentity(report);
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
    incidentId: identity.incidentId,
    detectedAt: report?.checkedAt,
    adminUrl: incidentAdminUrl(null),
    remediation: {
      confidence: "medium",
      hypothesis: reasonCode === "DATABASE_UNAVAILABLE"
        ? "The readiness endpoint confirmed that the production database connection is unavailable."
        : "The monitored service remained unhealthy after the confirmation probe; a transient network or hosting interruption is the leading explanation until logs prove otherwise.",
      proposedSolution: "The monitor will keep checking automatically. My AI PA will report verified recovery, but it will not replay any customer operation whose completion state is unknown.",
      safetyBoundary: "Health checks are read-only. Restarts, deploys, billing, credentials, and provider mutations remain approval-gated.",
    },
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

async function sendTelegramLifecycle(report, filePath = statePath) {
  if (!args.has("--telegram-lifecycle")) return { attempted: false };
  const previous = readMonitorState(filePath);
  const current = monitorIncidentIdentities(report);
  const checkedAt = report?.checkedAt || new Date().toISOString();
  const currentWithState = current.map((identity) => ({
    identity,
    state: publicMonitorStateRecord(identity.fingerprint, {
      type: identity.type,
      checkName: identity.checkName,
      firstDetectedAt: checkedAt,
    }),
  }));
  const currentByFingerprint = new Map(currentWithState.map((item) => [item.state.fingerprint, item.identity]));
  const nextIncidents = { ...previous.incidents };
  const deliveries = [];
  // Re-save restored legacy state before any artifact upload so raw operational
  // identifiers can never survive into the public state branch.
  writeMonitorState(filePath, previous);

  for (const { identity, state } of currentWithState) {
    if (deliveries.length >= 10) break;
    if (previous.incidents[state.fingerprint]) continue;
    const delivery = await sendTelegramText(buildProductionIncidentAlert(report, identity), {
      adminUrl: incidentAdminUrl(identity.issue),
      buttonText: identity.issue?.id ? "Open exact incident" : "Open My AI PA admin",
    });
    deliveries.push({ ...delivery, incidentId: identity.incidentId, lifecycle: "detected" });
    if (delivery.accepted) {
      nextIncidents[state.fingerprint] = state.record;
      writeMonitorState(filePath, { schemaVersion: 2, incidents: nextIncidents });
    }
  }

  const checksByName = new Map((Array.isArray(report?.checks) ? report.checks : []).map((check) => [check.name, check]));
  for (const [fingerprint, prior] of Object.entries(previous.incidents)) {
    if (deliveries.length >= 10) break;
    if (currentByFingerprint.has(fingerprint)) continue;
    const exactProbe = checksByName.get(prior.checkName);
    if (!exactProbe?.healthy) continue;
    const delivery = await sendTelegramText(buildMonitorRecoveryUpdate(report, prior), {
      adminUrl: incidentAdminUrl(null),
      buttonText: "Open My AI PA admin",
    });
    deliveries.push({
      ...delivery,
      lifecycleId: prior.lifecycleId,
      lifecycle: prior.type === "operational" ? "cleared" : "recovered",
    });
    if (delivery.accepted) {
      delete nextIncidents[fingerprint];
      writeMonitorState(filePath, { schemaVersion: 2, incidents: nextIncidents });
    }
  }
  if (!deliveries.length) {
    return {
      attempted: false,
      reason: current.length ? "active_incidents_already_reported" : "healthy_without_lifecycle_transition",
      active: current.length,
    };
  }
  return {
    attempted: true,
    accepted: deliveries.every((delivery) => delivery.accepted === true),
    deliveries,
  };
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
    ok: checks.every((check) => check.healthy)
      && monitorIncidentIdentities({ checks }).length === 0,
    checks,
    confirmation,
    warnings: [],
  };
  report.alert = args.has("--telegram-lifecycle")
    ? await sendTelegramLifecycle(report)
    : await sendTelegramFailure(report);
  report.checklist = await sendTelegramChecklist(report);

  const publicReport = publicMonitorReport(report);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(publicReport, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(publicReport, null, 2));
  console.log(`Report saved: ${reportPath}`);
  const checklistFailed = args.has("--telegram-checklist") && report.checklist?.accepted !== true;
  if (checklistFailed || (!report.ok && !args.has("--no-fail-exit"))) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Production monitor failed safely: ${safeDiagnosticLabel(error?.code || error?.name || "monitor_execution_failed")}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildProductionIncidentAlert,
  buildMonitorRecoveryUpdate,
  buildTelegramChecklist,
  formatTorontoTime,
  incidentAdminUrl,
  monitorIncidentIdentities,
  monitorIncidentIdentity,
  publicMonitorReport,
  readMonitorState,
  selectOperationalIssue,
  redactOperationalIssues,
  redactOperationalSignupIssues,
  safeDiagnosticLabel,
  writeMonitorState,
};
