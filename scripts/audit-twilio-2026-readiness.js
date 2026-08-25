const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function last4(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : "unknown";
}

function urlHost(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isHttps(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = String(selector(record) || "unknown").toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sum(records, selector) {
  return records.reduce((total, record) => total + (Number(selector(record)) || 0), 0);
}

function alertCode(record = {}) {
  const explicit = String(record.error_code || record.errorCode || "").trim();
  if (explicit) return explicit;
  const embedded = String(record.alert_text || "").match(/(?:errorcode|error_code)(?:=|%3d)(\d+)/i)?.[1];
  return embedded || String(record.log_level || "unknown").trim().toLowerCase();
}

function latestTimestamp(records, fields) {
  const times = records.flatMap((record) => fields.map((field) => new Date(record?.[field] || "").getTime()))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function assessTwilioReadiness({
  account = {},
  numbers = [],
  messages = [],
  calls = [],
  alerts = [],
  messagingServices = [],
  usageTriggers = [],
  complianceProfiles = [],
  credentialMode = "none",
  protectedTools = [],
  warnings = [],
} = {}) {
  const outgoing = messages.filter((message) => String(message?.direction || "").toLowerCase().startsWith("outbound"));
  const delivered = outgoing.filter((message) => ["delivered", "read"].includes(String(message?.status || "").toLowerCase()));
  const failed = outgoing.filter((message) => ["failed", "undelivered"].includes(String(message?.status || "").toLowerCase()));
  const messageErrorCodes = countBy(
    failed.filter((message) => message?.error_code != null),
    (message) => message.error_code
  );
  const numberRows = numbers.map((number) => ({
    sidHash: shortHash(number?.sid),
    last4: last4(number?.phone_number),
    capabilities: Object.keys(number?.capabilities || {}).filter((key) => number.capabilities[key] === true).sort(),
    voiceRouteHost: urlHost(number?.voice_url),
    voiceRouteHttps: isHttps(number?.voice_url),
    voiceFallbackConfigured: isHttps(number?.voice_fallback_url),
    smsRouteHost: urlHost(number?.sms_url),
    smsRouteHttps: isHttps(number?.sms_url),
    smsFallbackConfigured: isHttps(number?.sms_fallback_url),
    messagingServiceConfigured: Boolean(String(number?.messaging_service_sid || "").trim()),
  }));
  const smsCapable = numberRows.filter((number) => number.capabilities.includes("sms"));
  const consentProxyRoutes = smsCapable.filter((number) => number.smsRouteHost === "api.myaipa.ca");
  const sendingTools = protectedTools.filter((tool) => /^send_call_summaries_/i.test(String(tool?.name || "")));
  const callbackTools = sendingTools.filter((tool) => tool.statusCallbackHttps);
  const apiKeyTools = sendingTools.filter((tool) => tool.apiKeyConfigured);
  const activeAlerts = alerts.filter((alert) => !["resolved", "closed"].includes(String(alert?.log_level || alert?.status || "").toLowerCase()));

  const recommendations = [];
  if (String(account?.status || "").toLowerCase() !== "active") {
    recommendations.push({ priority: "critical", action: "Restore the Twilio account to active status before production traffic." });
  }
  if (credentialMode !== "api_key") {
    recommendations.push({ priority: "high", action: "Create a restricted Twilio REST API key for Messaging, Voice/Calls, Phone Numbers and Usage; retain the Auth Token only for validating Twilio webhooks." });
  }
  if (sendingTools.length && apiKeyTools.length !== sendingTools.length) {
    recommendations.push({ priority: "high", action: `Migrate ${sendingTools.length - apiKeyTools.length} Vapi SMS tool(s) from the master Auth Token to scoped Twilio REST API-key credentials.` });
  }
  if (sendingTools.length && callbackTools.length !== sendingTools.length) {
    recommendations.push({ priority: "high", action: `Configure an HTTPS delivery-status callback for ${sendingTools.length - callbackTools.length} SMS tool(s), then persist and reconcile final delivered/undelivered results.` });
  }
  if (smsCapable.length && consentProxyRoutes.length !== smsCapable.length) {
    recommendations.push({ priority: "high", action: `Review ${smsCapable.length - consentProxyRoutes.length} SMS-capable number(s) that do not use the My AI PA consent proxy before routing them live.` });
  }
  if (failed.length) {
    recommendations.push({ priority: "high", action: `Investigate ${failed.length} failed or undelivered outbound message(s), grouped by the redacted error-code counts in this report.` });
  }
  if (!usageTriggers.length) {
    recommendations.push({ priority: "medium", action: "Add Twilio usage triggers for unexpected Voice, Messaging and phone-number spend." });
  }
  if (!complianceProfiles.some((profile) => String(profile?.status || "").toLowerCase() === "twilio-approved")) {
    recommendations.push({ priority: "high", action: "Complete or verify an approved Primary Compliance Profile; unrestricted messaging and trusted/branded calling depend on it." });
  }
  recommendations.push({ priority: "medium", action: "Enable email notifications for Messaging Intelligent Alerts in Twilio Console; monitoring is automatic, but email notifications require Console setup." });
  if (!messagingServices.length) {
    recommendations.push({ priority: "consider", action: "Consider a Messaging Service only when sender-pool routing, Advanced Opt-Out, geomatch or higher-volume messaging is needed; do not migrate the current sender behaviour casually." });
  }

  return {
    account: {
      sidHash: shortHash(account?.sid),
      status: String(account?.status || "unknown").toLowerCase(),
      type: String(account?.type || "unknown").toLowerCase(),
    },
    credentials: {
      restAuthentication: credentialMode,
      webhookAuthTokenStillRequired: true,
      vapiSmsTools: sendingTools.length,
      vapiSmsToolsUsingApiKeys: apiKeyTools.length,
    },
    phoneNumbers: {
      total: numberRows.length,
      smsCapable: smsCapable.length,
      consentProxyRoutes: consentProxyRoutes.length,
      messagingServiceRoutes: numberRows.filter((number) => number.messagingServiceConfigured).length,
      voiceRouteHosts: countBy(numberRows, (number) => number.voiceRouteHost),
      smsRouteHosts: countBy(numberRows, (number) => number.smsRouteHost),
      numbers: numberRows,
    },
    messaging: {
      total: messages.length,
      outgoing: outgoing.length,
      statuses: countBy(messages, (message) => message?.status),
      directions: countBy(messages, (message) => message?.direction),
      deliveredOrRead: delivered.length,
      failedOrUndelivered: failed.length,
      observedDeliveryRatePercent: outgoing.length ? Number(((delivered.length / outgoing.length) * 100).toFixed(1)) : null,
      errorCodes: messageErrorCodes,
      segments: sum(messages, (message) => message?.num_segments),
      statusCallbackTools: callbackTools.length,
      messagingServices: messagingServices.length,
    },
    voice: {
      total: calls.length,
      statuses: countBy(calls, (call) => call?.status),
      directions: countBy(calls, (call) => call?.direction),
      minutes: Number((sum(calls, (call) => call?.duration) / 60).toFixed(2)),
    },
    monitoring: {
      usageTriggers: usageTriggers.length,
      monitorAlerts: alerts.length,
      activeMonitorAlerts: activeAlerts.length,
      alertCodes: countBy(alerts, alertCode),
      latestMonitorAlertAt: latestTimestamp(alerts, ["date_created", "date_updated", "timestamp"]),
      intelligentAlertEmailConfiguration: "console-only; not verifiable by this audit",
    },
    trust: {
      complianceProfiles: complianceProfiles.length,
      profileStatuses: countBy(complianceProfiles, (profile) => profile?.status),
      approvedProfilePresent: complianceProfiles.some((profile) => String(profile?.status || "").toLowerCase() === "twilio-approved"),
    },
    recommendations,
    warnings,
  };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const error = new Error(`${options.label || "request"} failed with HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function environmentMap(tool) {
  const values = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(values.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

async function resolveCredentials(env, vapiRequest) {
  const fromValues = (values, source) => {
    const accountSid = String(values.TWILIO_ACCOUNT_SID || "").trim();
    const apiKeySid = String(values.TWILIO_API_KEY_SID || "").trim();
    const apiKeySecret = String(values.TWILIO_API_KEY_SECRET || "").trim();
    const authToken = String(values.TWILIO_AUTH_TOKEN || "").trim();
    if (usableSecret(accountSid) && usableSecret(apiKeySid) && usableSecret(apiKeySecret)) {
      return { accountSid, username: apiKeySid, password: apiKeySecret, mode: "api_key", source };
    }
    if (usableSecret(accountSid) && usableSecret(authToken)) {
      return { accountSid, username: accountSid, password: authToken, mode: "auth_token", source };
    }
    return null;
  };
  const local = fromValues(env, "project environment");
  if (local) return { credentials: local, protectedTools: [] };
  if (!vapiRequest) throw new Error("Twilio credentials are not configured.");
  const summaries = listFrom(await vapiRequest("/tool?limit=1000"), ["tools"]);
  const protectedTools = [];
  let credentials = null;
  for (const summary of summaries) {
    const name = String(summary?.function?.name || summary?.name || "");
    if (!/^send_call_summaries_/i.test(name) || !summary?.id) continue;
    const detail = await vapiRequest(`/tool/${encodeURIComponent(summary.id)}`);
    const values = environmentMap(detail);
    protectedTools.push({
      name,
      statusCallbackHttps: isHttps(values.TWILIO_STATUS_CALLBACK_URL),
      apiKeyConfigured: usableSecret(values.TWILIO_API_KEY_SID) && usableSecret(values.TWILIO_API_KEY_SECRET),
      suppressionCheckHttps: isHttps(values.SMS_SUPPRESSION_CHECK_URL),
    });
    credentials ||= fromValues(values, `protected Vapi tool ${shortHash(summary.id)}`);
  }
  if (!credentials) throw new Error("No usable Twilio credentials were found locally or in protected Vapi tools.");
  return { credentials, protectedTools };
}

function basicHeaders(credentials) {
  return {
    Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
    Accept: "application/json",
  };
}

async function fetchPages(firstUrl, collectionKey, credentials, maxPages = 30) {
  const records = [];
  let url = firstUrl;
  for (let page = 0; url && page < maxPages; page += 1) {
    const body = await jsonRequest(url, { headers: basicHeaders(credentials), label: `Twilio ${collectionKey}` });
    records.push(...listFrom(body, [collectionKey]));
    const next = String(body?.next_page_uri || body?.meta?.next_page_url || "").trim();
    url = next ? new URL(next, url).toString() : "";
  }
  return records;
}

async function optionalFetch(label, operation, warnings) {
  try {
    return await operation();
  } catch (error) {
    warnings.push(`${label} was unavailable (${error.statusCode || "request error"}).`);
    return [];
  }
}

async function runAudit({ env = loadProjectEnv(), days = 30 } = {}) {
  const vapiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
  const vapiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
  const vapiRequest = vapiKey ? (path) => jsonRequest(`${vapiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${vapiKey}`, Accept: "application/json" },
    label: `Vapi ${path}`,
  }) : null;
  const { credentials, protectedTools } = await resolveCredentials(env, vapiRequest);
  const warnings = [];
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}`;
  const since = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString().slice(0, 10);
  const callQuery = new URLSearchParams({ PageSize: "1000", "StartTime>=": since });
  const messageQuery = new URLSearchParams({ PageSize: "1000", "DateSent>=": since });
  const alertQuery = new URLSearchParams({ PageSize: "1000", StartDate: since });
  const accountPromise = jsonRequest(`${base}.json`, { headers: basicHeaders(credentials), label: "Twilio account" });
  const [account, numbers, messages, calls, alerts, messagingServices, usageTriggers, complianceProfiles] = await Promise.all([
    accountPromise,
    fetchPages(`${base}/IncomingPhoneNumbers.json?PageSize=1000`, "incoming_phone_numbers", credentials),
    fetchPages(`${base}/Messages.json?${messageQuery}`, "messages", credentials),
    fetchPages(`${base}/Calls.json?${callQuery}`, "calls", credentials),
    optionalFetch("Monitor alerts", () => fetchPages(`https://monitor.twilio.com/v1/Alerts?${alertQuery}`, "alerts", credentials), warnings),
    optionalFetch("Messaging Services", () => fetchPages("https://messaging.twilio.com/v1/Services?PageSize=1000", "services", credentials), warnings),
    optionalFetch("Usage triggers", () => fetchPages(`${base}/Usage/Triggers.json?PageSize=1000`, "usage_triggers", credentials), warnings),
    optionalFetch("Compliance Profiles", () => fetchPages("https://trusthub.twilio.com/v1/CustomerProfiles?PageSize=1000", "results", credentials), warnings),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    windowDays: Math.max(1, Number(days) || 30),
    privacy: "No message bodies, full phone numbers, customer names, credentials, or raw alert text are included.",
    credentialSource: credentials.source,
    ...assessTwilioReadiness({
      account,
      numbers,
      messages,
      calls,
      alerts,
      messagingServices,
      usageTriggers,
      complianceProfiles,
      credentialMode: credentials.mode,
      protectedTools,
      warnings,
    }),
  };
}

async function main() {
  const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] || 30);
  const report = await runAudit({ days });
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--strict") && report.recommendations.some((item) => item.priority === "critical")) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  alertCode,
  assessTwilioReadiness,
  countBy,
  isHttps,
  last4,
  latestTimestamp,
  shortHash,
  urlHost,
};
