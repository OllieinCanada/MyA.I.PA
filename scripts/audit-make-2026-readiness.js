const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function flattenModules(flow, route = "root", target = []) {
  for (const [index, module] of (Array.isArray(flow) ? flow : []).entries()) {
    target.push({ ...module, __route: route, __index: index, __routeLength: flow.length });
    for (const [branchIndex, branch] of (module.routes || []).entries()) {
      flattenModules(branch.flow || branch, `${route}/${module.id || index}:route-${branchIndex + 1}`, target);
    }
  }
  return target;
}

function moduleText(module) {
  return JSON.stringify({
    module: module?.module,
    version: module?.version,
    mapper: module?.mapper,
    parameters: module?.parameters,
  });
}

function isWebhookResponse(module) {
  return /WebhookRespond|WebhookResponse/i.test(String(module?.module || ""));
}

function isHttpModule(module) {
  return /^http:/i.test(String(module?.module || ""));
}

function isLegacyHttpModule(module) {
  return isHttpModule(module) && Number(module?.version || 0) > 0 && Number(module.version) < 4;
}

function hasPiiMapping(module) {
  return /(?:owner|caller|customer|contact).{0,18}(?:phone|email|address)|(?:phone|email|address).{0,18}(?:owner|caller|customer|contact)/i
    .test(moduleText(module));
}

function httpAuthenticationType(module) {
  const value = String(
    module?.mapper?.authenticationType
      || module?.parameters?.authenticationType
      || module?.mapper?.authentication
      || ""
  ).toLowerCase();
  if (/no.?auth/.test(value)) return "none";
  if (value) return "configured";
  return "unknown";
}

function urlHostFromModule(module) {
  const candidates = [module?.mapper?.url, module?.parameters?.url];
  for (const candidate of candidates) {
    try {
      return new URL(String(candidate || "")).hostname.toLowerCase();
    } catch {
      // A mapped URL cannot be safely or reliably resolved by this static audit.
    }
  }
  return "";
}

function hasErrorHandler(module) {
  return Boolean(
    (Array.isArray(module?.onerror) && module.onerror.length)
      || (Array.isArray(module?.errorHandlers) && module.errorHandlers.length)
      || (Array.isArray(module?.routes) && module.routes.some((route) => route?.type === "error"))
  );
}

function hasKeyMatching(value, pattern, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, item]) =>
    pattern.test(key) || (item && typeof item === "object" && hasKeyMatching(item, pattern, seen))
  );
}

function collectSettingSignals(value, target = {}, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return target;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (/sequential|confidential|incomplete|data.?loss|max.?errors/i.test(key) && ["boolean", "number", "string"].includes(typeof item)) {
      target[key] = item;
    }
    if (item && typeof item === "object") collectSettingSignals(item, target, seen);
  }
  return target;
}

function evaluateScenario({ scenario = {}, blueprint = {}, logs = [], hooks = [] } = {}) {
  const modules = flattenModules(blueprint.flow);
  const text = JSON.stringify(blueprint);
  const legacyHttp = modules.filter(isLegacyHttpModule);
  const externalUnauthenticatedPii = modules.filter((module) => {
    if (!isHttpModule(module) || !hasPiiMapping(module) || httpAuthenticationType(module) !== "none") return false;
    const host = urlHostFromModule(module);
    return Boolean(host && host !== "api.myaipa.ca");
  });
  const responseModules = modules.filter(isWebhookResponse);
  const responseIsLast = responseModules.length > 0
    && responseModules.every((module) => module.__index === module.__routeLength - 1);
  const provisionsPhone = /purchase-number|IncomingPhoneNumbers|AvailablePhoneNumbers/i.test(text);
  const createsVapiAssistant = /api\.vapi\.ai\/(?:assistant|phone-number)|makeApiCall2/i.test(text);
  const hasIdempotencyStorage = modules.some((module) =>
    /data.?store/i.test(String(module?.module || ""))
      || hasKeyMatching({ mapper: module?.mapper, parameters: module?.parameters }, /idempot|dedup|replay|event.?key/i)
  );
  const hasHardcodedAreaCode = /["']?areaCode["']?[^\r\n]{0,100}["']?\d{3}["']?/i.test(text);
  const handlesPii = modules.some(hasPiiMapping) || /(?:caller|owner|customer|contact).{0,18}(?:phone|email|address)|\bCaller\b|\bFrom\b/i.test(text);
  const settingsSignals = collectSettingSignals({ scenario, metadata: blueprint.metadata });
  const latestExecutionAt = logs
    .map((log) => String(log?.timestamp || log?.createdAt || log?.loggedAt || ""))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const issues = [];

  if (!scenario.isActive && hooks.length > 0) {
    issues.push({ level: provisionsPhone ? "high" : "medium", key: "inactive-with-hook", message: "A webhook is attached to an inactive scenario." });
  }
  if (provisionsPhone && !hasIdempotencyStorage) {
    issues.push({ level: "high", key: "provisioning-idempotency", message: "Number provisioning has no visible idempotency or replay guard." });
  }
  if (provisionsPhone && hasHardcodedAreaCode) {
    issues.push({ level: "high", key: "hardcoded-area-code", message: "Provisioning appears to use a fixed area code instead of signup location data." });
  }
  if (provisionsPhone && settingsSignals.sequential === false) {
    issues.push({ level: "high", key: "parallel-provisioning", message: "Provisioning can run webhook executions in parallel." });
  }
  if (handlesPii && settingsSignals.confidential === false) {
    issues.push({ level: "high", key: "pii-execution-history", message: "Keep data confidential is disabled while the scenario maps caller or signup data." });
  }
  if (legacyHttp.length > 0) {
    issues.push({ level: "medium", key: "legacy-http", message: `${legacyHttp.length} HTTP v3 module(s) should be migrated to HTTP v4 keychain credentials.` });
  }
  if (externalUnauthenticatedPii.length > 0) {
    issues.push({ level: "high", key: "unauthenticated-pii-http", message: `${externalUnauthenticatedPii.length} unauthenticated external HTTP request(s) map caller/contact data.` });
  }
  if (responseModules.length === 0) {
    issues.push({ level: "review", key: "webhook-response-missing", message: "No explicit Webhook response module was found." });
  } else if (!responseIsLast) {
    issues.push({ level: "high", key: "webhook-response-order", message: "A Webhook response module is not last in its route." });
  }
  const riskyModulesWithoutHandlers = modules.filter((module) =>
    (isHttpModule(module) || /twilio|vapi/i.test(String(module?.module || ""))) && !hasErrorHandler(module)
  ).length;
  if (riskyModulesWithoutHandlers > 0) {
    issues.push({ level: "medium", key: "missing-error-handlers", message: `${riskyModulesWithoutHandlers} external-service module(s) have no visible error route.` });
  }

  return {
    scenarioIdHash: shortHash(scenario.id),
    name: String(scenario.name || "Unnamed scenario").slice(0, 160),
    active: Boolean(scenario.isActive),
    attachedHooks: hooks.length,
    returnedExecutions: logs.length,
    latestExecutionAt,
    modules: {
      total: modules.length,
      legacyHttpV3: legacyHttp.length,
      webhookResponses: responseModules.length,
      webhookResponseLast: responseIsLast,
      externalUnauthenticatedPiiRequests: externalUnauthenticatedPii.map((module) => ({
        host: urlHostFromModule(module),
        moduleIdHash: shortHash(module.id),
      })),
      withVisibleErrorHandlers: modules.filter(hasErrorHandler).length,
    },
    workflow: {
      provisionsPhone,
      createsVapiAssistant,
      hasVisibleIdempotencyStorage: hasIdempotencyStorage,
      hasHardcodedAreaCode,
      handlesPii,
    },
    settingsSignals,
    issues,
  };
}

function summarize(reports = []) {
  const issues = reports.flatMap((report) => report.issues);
  return {
    scenarios: reports.length,
    active: reports.filter((report) => report.active).length,
    inactiveWithHooks: reports.filter((report) => !report.active && report.attachedHooks > 0).length,
    legacyHttpModules: reports.reduce((sum, report) => sum + report.modules.legacyHttpV3, 0),
    unauthenticatedExternalPiiRequests: reports.reduce(
      (sum, report) => sum + report.modules.externalUnauthenticatedPiiRequests.length,
      0
    ),
    highRiskGaps: issues.filter((issue) => issue.level === "high").length,
    issueCounts: issues.reduce((counts, issue) => {
      counts[issue.key] = (counts[issue.key] || 0) + 1;
      return counts;
    }, {}),
  };
}

function prioritizedRecommendations(summary) {
  const recommendations = [];
  if (summary.inactiveWithHooks > 0) {
    recommendations.push({ priority: 1, approval: "required before activation", action: "Rebuild and test inactive webhook scenarios before enabling them; an attached hook does not mean the scenario is processing." });
  }
  if (summary.issueCounts["provisioning-idempotency"]) {
    recommendations.push({ priority: 1, approval: "required: changes signup provisioning", action: "Add a durable idempotency record before any Twilio number purchase or Vapi assistant creation." });
  }
  if (summary.issueCounts["hardcoded-area-code"]) {
    recommendations.push({ priority: 1, approval: "required: changes number selection", action: "Derive Canadian area-code preferences from validated signup location and keep provider-confirmed Canadian fallback logic in the backend." });
  }
  if (summary.issueCounts["pii-execution-history"]) {
    recommendations.push({ priority: 1, approval: "required: reduces Make execution-log detail", action: "Enable Keep data confidential on scenarios carrying caller, owner, email, phone, or address data; use structured app-side diagnostics for troubleshooting." });
  }
  if (summary.unauthenticatedExternalPiiRequests > 0) {
    recommendations.push({ priority: 1, approval: "required: changes a live request contract", action: "Authenticate external HTTP calls that carry caller/contact data and move credentials into an HTTP v4 keychain." });
  }
  if (summary.legacyHttpModules > 0) {
    recommendations.push({ priority: 2, approval: "safe in a cloned scenario; production switch requires approval", action: "Use Module Migrator or manually clone and migrate HTTP v3 modules to HTTP v4, then regression-test response and error mappings." });
  }
  recommendations.push({ priority: 2, approval: "Make organization access required", action: "Enable Keep data confidential for PII scenarios, Store incomplete executions, Process data in order where duplicate side effects are unsafe, and keep data loss disabled." });
  recommendations.push({ priority: 3, approval: "safe", action: "Use expanded scenario usage tracking and Grid content search to document hook, data-store, connection, and custom-variable dependencies." });
  return recommendations;
}

async function runAudit({ env = loadProjectEnv(), fetchImpl = fetch } = {}) {
  const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
  const token = String(env.MAKE_AUDIT_API_TOKEN || env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
  const seedScenarioId = String(env.MAKE_AUDIT_SEED_SCENARIO_ID || env.MAKE_SCENARIO_ID || "3530157").trim();
  if (!token) throw new Error("MAKE_AUDIT_API_TOKEN or MAKE_API_TOKEN is not configured.");
  if (!seedScenarioId) throw new Error("MAKE_AUDIT_SEED_SCENARIO_ID or MAKE_SCENARIO_ID is required.");

  async function request(path, optional = false) {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        headers: { Authorization: `Token ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      const text = await response.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
      return body;
    } catch (error) {
      if (!optional) throw error;
      return { __error: String(error?.message || error) };
    }
  }

  const seedPayload = await request(`/scenarios/${encodeURIComponent(seedScenarioId)}`);
  const seed = seedPayload.scenario || seedPayload;
  const teamId = String(seed.teamId || seed.team?.id || "").trim();
  if (!teamId) throw new Error("The configured Make scenario did not expose a team ID.");

  const [scenarioPayload, hookPayload] = await Promise.all([
    request(`/scenarios?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
    request(`/hooks?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
  ]);
  const scenarios = listFrom(scenarioPayload, ["scenarios"]);
  const hooks = listFrom(hookPayload, ["hooks"]);
  const hooksByScenario = new Map();
  for (const hook of hooks) {
    const scenarioId = String(hook?.scenarioId || hook?.scenario?.id || "");
    if (!scenarioId) continue;
    if (!hooksByScenario.has(scenarioId)) hooksByScenario.set(scenarioId, []);
    hooksByScenario.get(scenarioId).push(hook);
  }

  const reports = await Promise.all(scenarios.map(async (scenario) => {
    const scenarioId = String(scenario.id || "");
    const [blueprintPayload, logPayload] = await Promise.all([
      request(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`),
      request(`/scenarios/${encodeURIComponent(scenarioId)}/logs`, true),
    ]);
    const blueprint = blueprintPayload?.response?.blueprint || blueprintPayload?.blueprint || blueprintPayload;
    const logs = listFrom(logPayload, ["scenarioLogs", "logs"]);
    return evaluateScenario({ scenario, blueprint, logs, hooks: hooksByScenario.get(scenarioId) || [] });
  }));
  const summary = summarize(reports);
  const integrationKey = String(env.INTEGRATION_API_KEY || "").trim();
  const makeWebhookApiKey = String(env.MAKE_SIGNUP_WEBHOOK_API_KEY || "").trim();
  const credentialBoundary = {
    integrationKeyConfigured: Boolean(integrationKey),
    makeWebhookApiKeyConfigured: Boolean(makeWebhookApiKey),
    credentialsDistinct: Boolean(integrationKey && makeWebhookApiKey && integrationKey !== makeWebhookApiKey),
  };

  const dataStoreProbe = await request(`/data-stores?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1`, true);
  const warnings = [];
  if (dataStoreProbe.__error) {
    warnings.push("The audit token cannot read Data Stores; idempotency records and store dependencies could not be independently verified.");
  }
  if (makeWebhookApiKey && !credentialBoundary.credentialsDistinct) {
    warnings.push("Local configuration does not prove a distinct backend integration key; the application currently has a compatibility fallback to the Make webhook API key.");
  }
  const recommendations = prioritizedRecommendations(summary);
  if (!credentialBoundary.credentialsDistinct) {
    recommendations.unshift({
      priority: 1,
      approval: "required: rotate and update every calling scenario together",
      action: "Separate the Make inbound webhook key, backend provisioning key, Vapi webhook secret, and read-only Make audit token; remove compatibility fallbacks after callers are migrated.",
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    scope: "Read-only Make team inventory. Payload values, webhook paths, credentials, phone numbers, and customer data are never printed.",
    inventory: { scenarios: scenarios.length, hooks: hooks.length, dataStoreReadAvailable: !dataStoreProbe.__error },
    credentialBoundary,
    summary,
    recommendations,
    warnings,
    scenarios: reports.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

async function main() {
  const report = await runAudit();
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--strict") && report.summary.highRiskGaps > 0) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  collectSettingSignals,
  evaluateScenario,
  flattenModules,
  hasPiiMapping,
  isLegacyHttpModule,
  prioritizedRecommendations,
  summarize,
};
