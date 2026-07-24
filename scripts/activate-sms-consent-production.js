const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");
const { isManagedIsolatedTool } = require("../server/vapiIsolatedSmsProvisioning");
const { getTwilioSignature, normalizeSmsUpstreamUrl } = require("../server/smsSuppression");
const { prisma } = require("../server/prisma");

const env = loadProjectEnv();
const vapiApiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const vapiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const webhookUrl = String(env.TWILIO_INBOUND_WEBHOOK_URL || "https://api.myaipa.ca/api/webhooks/sms").trim();
const suppressionCheckUrl = String(
  env.SMS_SUPPRESSION_CHECK_URL || "https://api.myaipa.ca/api/integrations/sms/suppression/check"
).trim();
const suppressionApiKey = String(env.SMS_SUPPRESSION_API_KEY || "").trim();
const applyWebhooks = process.argv.includes("--apply-webhooks");
const testStopStart = process.argv.includes("--test-stop-start");

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function safeHost(value) {
  try {
    return new URL(String(value || "")).host;
  } catch {
    return value ? "invalid-url" : "";
  }
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(
    entries
      .map((item) => [String(item?.name || ""), String(item?.value || "")])
      .filter(([name]) => name)
  );
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

function assistantId(record) {
  return String(record?.assistantId || record?.assistant?.id || "").trim();
}

function phoneNumber(record) {
  return normalizeE164(
    record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId
  );
}

function toolIds(assistant) {
  return [
    ...new Set(
      [
        ...(Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : []),
        ...(Array.isArray(assistant?.toolIds) ? assistant.toolIds : []),
      ]
        .map(String)
        .filter(Boolean)
    ),
  ];
}

async function vapiRequest(path) {
  const response = await fetch(`${vapiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${vapiApiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    throw new Error(`Vapi ${path} failed with HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
  }
  return body;
}

function twilioHeaders(account) {
  return {
    Authorization: `Basic ${Buffer.from(`${account.accountSid}:${account.authToken}`).toString("base64")}`,
    Accept: "application/json",
  };
}

async function twilioRequest(url, account, { method = "GET", form } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...twilioHeaders(account),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message = String(body.message || body.error || `HTTP ${response.status}`).slice(0, 240);
    const error = new Error(`Twilio request failed: ${message}`);
    error.providerCode = body.code;
    throw error;
  }
  return body;
}

async function collectTargets() {
  if (!vapiApiKey) throw new Error("VAPI_API_KEY is required.");
  const [phonePayload, assistantPayload, toolPayload] = await Promise.all([
    vapiRequest("/phone-number?limit=1000"),
    vapiRequest("/assistant?limit=1000"),
    vapiRequest("/tool?limit=1000"),
  ]);
  const phones = listFrom(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const assistantSummaries = listFrom(assistantPayload, ["assistants"]);
  const toolSummaries = listFrom(toolPayload, ["tools"]);
  const assistantById = new Map(assistantSummaries.map((item) => [String(item?.id || ""), item]));
  const managedById = new Map(
    toolSummaries
      .filter(isManagedIsolatedTool)
      .map((item) => [String(item?.id || ""), item])
  );
  const assistantCache = new Map();
  const toolCache = new Map();
  const targets = [];
  const skipped = [];

  async function hydrateAssistant(id) {
    if (!assistantCache.has(id)) {
      assistantCache.set(id, await vapiRequest(`/assistant/${encodeURIComponent(id)}`));
    }
    return assistantCache.get(id);
  }

  async function hydrateTool(id) {
    if (!toolCache.has(id)) {
      toolCache.set(id, await vapiRequest(`/tool/${encodeURIComponent(id)}`));
    }
    return toolCache.get(id);
  }

  for (const phone of phones) {
    const number = phoneNumber(phone);
    const id = assistantId(phone);
    if (!number || !id) continue;
    const assistant = await hydrateAssistant(id);
    const attachedManagedIds = toolIds(assistant).filter((toolId) => managedById.has(toolId));
    const attachedTools = await Promise.all(attachedManagedIds.map(hydrateTool));
    const matchingTool = attachedTools.find(
      (tool) => normalizeE164(environmentMap(tool).DEFAULT_FROM_NUMBER) === number
    );
    if (!matchingTool) {
      skipped.push({
        assistantIdHash: shortHash(id),
        assistantName: String(assistant?.name || assistantById.get(id)?.name || ""),
        phoneLast4: number.slice(-4),
        reason: "no_matching_managed_sms_tool",
      });
      continue;
    }
    const values = environmentMap(matchingTool);
    const accountSid = String(values.TWILIO_ACCOUNT_SID || "").trim();
    const authToken = String(values.TWILIO_AUTH_TOKEN || "").trim();
    if (!/^AC[a-z0-9]{20,}$/i.test(accountSid) || !usableSecret(authToken)) {
      skipped.push({
        assistantIdHash: shortHash(id),
        assistantName: String(assistant?.name || ""),
        phoneLast4: number.slice(-4),
        reason: "twilio_credentials_unavailable",
      });
      continue;
    }
    targets.push({
      number,
      assistantIdHash: shortHash(id),
      assistantName: String(assistant?.name || ""),
      accountSid,
      authToken,
      accountHash: shortHash(accountSid),
    });
  }

  const uniqueTargets = [
    ...new Map(targets.map((target) => [target.number, target])).values(),
  ].sort((left, right) => left.number.localeCompare(right.number));
  return { targets: uniqueTargets, skipped };
}

async function listIncomingNumbers(account) {
  const records = [];
  let url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account.accountSid)}/IncomingPhoneNumbers.json?PageSize=1000`;
  while (url) {
    const page = await twilioRequest(url, account);
    records.push(...listFrom(page, ["incoming_phone_numbers"]));
    const next = String(page?.meta?.next_page_url || page?.next_page_uri || "").trim();
    url = next ? new URL(next, "https://api.twilio.com").toString() : "";
  }
  return records;
}

async function inspectConfiguration(targets) {
  const accounts = new Map();
  for (const target of targets) {
    const key = `${target.accountSid}:${shortHash(target.authToken)}`;
    if (!accounts.has(key)) {
      accounts.set(key, {
        accountSid: target.accountSid,
        authToken: target.authToken,
        accountHash: target.accountHash,
      });
    }
  }
  const inventoryByAccount = new Map();
  for (const [key, account] of accounts.entries()) {
    const records = await listIncomingNumbers(account);
    inventoryByAccount.set(
      key,
      new Map(records.map((record) => [normalizeE164(record?.phone_number || record?.phoneNumber), record]))
    );
  }
  const rows = targets.map((target) => {
    const key = `${target.accountSid}:${shortHash(target.authToken)}`;
    const record = inventoryByAccount.get(key)?.get(target.number);
    const currentUrl = String(record?.sms_url || record?.smsUrl || "").trim();
    const currentMethod = String(record?.sms_method || record?.smsMethod || "POST").toUpperCase();
    const fallbackUrl = String(record?.sms_fallback_url || record?.smsFallbackUrl || "").trim();
    const fallbackMethod = String(record?.sms_fallback_method || record?.smsFallbackMethod || "POST").toUpperCase();
    const applicationSid = String(record?.sms_application_sid || record?.smsApplicationSid || "").trim();
    const smsCapable = record ? Boolean(record?.capabilities?.sms ?? record?.capabilities?.SMS ?? true) : false;
    let upstreamUrl = currentUrl === webhookUrl ? fallbackUrl : currentUrl;
    let upstreamAllowed = false;
    try {
      upstreamUrl = normalizeSmsUpstreamUrl(upstreamUrl);
      upstreamAllowed = true;
    } catch {
      upstreamAllowed = false;
    }
    const desired = currentUrl === webhookUrl
      && currentMethod === "POST"
      && fallbackUrl === upstreamUrl
      && fallbackMethod === "POST"
      && upstreamAllowed;
    let blockedReason = "";
    if (!record) blockedReason = "twilio_number_not_found";
    else if (!smsCapable) blockedReason = "number_not_sms_capable";
    else if (applicationSid) blockedReason = "sms_application_controls_routing";
    else if (!upstreamAllowed && currentUrl === webhookUrl) blockedReason = "missing_vapi_fallback_route";
    else if (!upstreamAllowed && currentUrl) blockedReason = "existing_non_vapi_webhook";
    else if (!upstreamAllowed) blockedReason = "missing_vapi_upstream_route";
    return {
      ...target,
      record,
      phoneSid: String(record?.sid || ""),
      currentUrl,
      currentMethod,
      currentHost: safeHost(currentUrl),
      fallbackUrl,
      fallbackMethod,
      fallbackHost: safeHost(fallbackUrl),
      upstreamUrl,
      upstreamHost: safeHost(upstreamUrl),
      applicationSid,
      smsCapable,
      desired,
      blockedReason,
    };
  });
  return { rows, accounts };
}

function publicRow(row) {
  return {
    assistantIdHash: row.assistantIdHash,
    assistantName: row.assistantName,
    phoneLast4: row.number.slice(-4),
    accountHash: row.accountHash,
    currentHost: row.currentHost,
    currentMethod: row.currentMethod,
    fallbackHost: row.fallbackHost,
    upstreamHost: row.upstreamHost,
    desired: row.desired,
    preservesExistingInboundReplies: row.upstreamHost === "api.vapi.ai",
    blockedReason: row.blockedReason,
  };
}

async function updateIncomingNumber(row, form) {
  const account = { accountSid: row.accountSid, authToken: row.authToken };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(row.accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(row.phoneSid)}.json`;
  return twilioRequest(url, account, { method: "POST", form });
}

async function applyConfiguration(inspection) {
  if (String(env.SMS_CONSENT_ACTIVATION_CONFIRM || "") !== "configure-live-sms-consent") {
    throw new Error("Set SMS_CONSENT_ACTIVATION_CONFIRM=configure-live-sms-consent before applying live webhook changes.");
  }
  const blocked = inspection.rows.filter((row) => row.blockedReason);
  if (blocked.length) {
    throw new Error(`Refusing live changes because ${blocked.length} target number(s) are blocked.`);
  }
  const changes = inspection.rows.filter((row) => !row.desired);
  const updated = [];
  const routeSnapshots = [];
  try {
    for (const row of inspection.rows) {
      const previous = await prisma.smsInboundRoute.findUnique({
        where: { phoneNumber: row.number },
      });
      routeSnapshots.push({ row, previous });
      await prisma.smsInboundRoute.upsert({
        where: { phoneNumber: row.number },
        create: {
          phoneNumber: row.number,
          upstreamUrl: row.upstreamUrl,
          upstreamMethod: "POST",
          source: "TWILIO_NUMBER",
        },
        update: {
          upstreamUrl: row.upstreamUrl,
          upstreamMethod: "POST",
          source: "TWILIO_NUMBER",
        },
      });
    }
    for (const row of changes) {
      await updateIncomingNumber(row, {
        SmsUrl: webhookUrl,
        SmsMethod: "POST",
        SmsFallbackUrl: row.upstreamUrl,
        SmsFallbackMethod: "POST",
      });
      updated.push(row);
    }
    const verified = [];
    for (const row of changes) {
      const detail = await twilioRequest(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(row.accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(row.phoneSid)}.json`,
        { accountSid: row.accountSid, authToken: row.authToken }
      );
      const actualUrl = String(detail?.sms_url || detail?.smsUrl || "").trim();
      const actualMethod = String(detail?.sms_method || detail?.smsMethod || "").toUpperCase();
      const actualFallbackUrl = String(detail?.sms_fallback_url || detail?.smsFallbackUrl || "").trim();
      const actualFallbackMethod = String(detail?.sms_fallback_method || detail?.smsFallbackMethod || "").toUpperCase();
      const route = await prisma.smsInboundRoute.findUnique({
        where: { phoneNumber: row.number },
      });
      verified.push({
        phoneLast4: row.number.slice(-4),
        webhookInstalled: actualUrl === webhookUrl,
        postMethodInstalled: actualMethod === "POST",
        vapiFallbackInstalled: actualFallbackUrl === row.upstreamUrl && actualFallbackMethod === "POST",
        proxyRouteInstalled: route?.upstreamUrl === row.upstreamUrl && route?.upstreamMethod === "POST",
      });
    }
    if (verified.some((item) => (
      !item.webhookInstalled
      || !item.postMethodInstalled
      || !item.vapiFallbackInstalled
      || !item.proxyRouteInstalled
    ))) {
      throw new Error("Twilio read-back did not confirm every webhook update.");
    }
    return {
      changed: changes.length,
      unchanged: inspection.rows.length - changes.length,
      proxyRoutesInstalled: inspection.rows.length,
      verified,
    };
  } catch (error) {
    const rollback = [];
    for (const row of [...updated].reverse()) {
      try {
        await updateIncomingNumber(row, {
          SmsUrl: row.currentUrl,
          SmsMethod: row.currentMethod || "POST",
          SmsFallbackUrl: row.fallbackUrl,
          SmsFallbackMethod: row.fallbackMethod || "POST",
        });
        rollback.push({ phoneLast4: row.number.slice(-4), restored: true });
      } catch (rollbackError) {
        rollback.push({
          phoneLast4: row.number.slice(-4),
          restored: false,
          error: String(rollbackError.message || rollbackError).slice(0, 180),
        });
      }
    }
    const routeRollback = [];
    for (const { row, previous } of [...routeSnapshots].reverse()) {
      try {
        if (previous) {
          await prisma.smsInboundRoute.update({
            where: { phoneNumber: row.number },
            data: {
              upstreamUrl: previous.upstreamUrl,
              upstreamMethod: previous.upstreamMethod,
              source: previous.source,
            },
          });
        } else {
          await prisma.smsInboundRoute.delete({ where: { phoneNumber: row.number } });
        }
        routeRollback.push({ phoneLast4: row.number.slice(-4), restored: true });
      } catch (rollbackError) {
        routeRollback.push({
          phoneLast4: row.number.slice(-4),
          restored: false,
          error: String(rollbackError.message || rollbackError).slice(0, 180),
        });
      }
    }
    console.error(JSON.stringify({ rollback, routeRollback }, null, 2));
    throw error;
  }
}

async function sendTwilioMessage(account, { from, to, body }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account.accountSid)}/Messages.json`;
  return twilioRequest(url, account, {
    method: "POST",
    form: { From: from, To: to, Body: body },
  });
}

async function checkSuppression(phoneNumber) {
  const response = await fetch(suppressionCheckUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${suppressionApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ phoneNumber }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(`Suppression check failed with HTTP ${response.status}.`);
  return body;
}

async function waitForSuppression(phoneNumber, expected, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await checkSuppression(phoneNumber);
    if (Boolean(state.suppressed) === expected) return state;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Suppression state did not become ${expected ? "paused" : "active"} within ${attempts} seconds.`);
}

async function signedResumeFallback({ from, to, authToken }) {
  const params = {
    From: from,
    To: to,
    Body: "START",
    MessageSid: `SM${crypto.randomBytes(16).toString("hex")}`,
  };
  const signature = getTwilioSignature(webhookUrl, params, authToken);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Twilio-Signature": signature,
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Signed START fallback failed with HTTP ${response.status}.`);
  await waitForSuppression(from, false, 10);
}

async function runStopStartTest(inspection) {
  if (String(env.SMS_CONSENT_TEST_CONFIRM || "") !== "run-live-stop-start") {
    throw new Error("Set SMS_CONSENT_TEST_CONFIRM=run-live-stop-start before sending the live STOP/START test.");
  }
  if (!/^https:\/\//i.test(suppressionCheckUrl) || !usableSecret(suppressionApiKey)) {
    throw new Error("The private production suppression check is not configured.");
  }
  const fromLast4 = String(env.SMS_CONSENT_TEST_FROM_LAST4 || "").replace(/\D/g, "").slice(-4);
  const toLast4 = String(env.SMS_CONSENT_TEST_TO_LAST4 || "").replace(/\D/g, "").slice(-4);
  if (!fromLast4 || !toLast4 || fromLast4 === toLast4) {
    throw new Error("Set distinct SMS_CONSENT_TEST_FROM_LAST4 and SMS_CONSENT_TEST_TO_LAST4 values.");
  }
  const source = inspection.rows.find((row) => row.number.endsWith(fromLast4));
  const target = inspection.rows.find((row) => row.number.endsWith(toLast4));
  if (!source || !target) throw new Error("The selected STOP/START test numbers are not active managed numbers.");
  if (!source.desired || !target.desired || source.blockedReason || target.blockedReason) {
    throw new Error("The selected STOP/START test numbers do not have verified consent webhooks.");
  }
  if (source.accountSid !== target.accountSid || shortHash(source.authToken) !== shortHash(target.authToken)) {
    throw new Error("The selected STOP/START test numbers must share one Twilio account.");
  }
  const account = { accountSid: source.accountSid, authToken: source.authToken };
  let stopAccepted = null;
  let startAccepted = null;
  let restoredViaFallback = false;
  try {
    const baseline = await checkSuppression(source.number);
    if (baseline.suppressed) {
      startAccepted = await sendTwilioMessage(account, {
        from: source.number,
        to: target.number,
        body: "START",
      });
      await waitForSuppression(source.number, false);
    }
    stopAccepted = await sendTwilioMessage(account, {
      from: source.number,
      to: target.number,
      body: "STOP",
    });
    await waitForSuppression(source.number, true);
    startAccepted = await sendTwilioMessage(account, {
      from: source.number,
      to: target.number,
      body: "START",
    });
    await waitForSuppression(source.number, false);
  } catch (error) {
    try {
      await signedResumeFallback({
        from: source.number,
        to: target.number,
        authToken: target.authToken,
      });
      restoredViaFallback = true;
    } catch (restoreError) {
      console.error(JSON.stringify({
        criticalRestoreFailure: true,
        sourceLast4: source.number.slice(-4),
        error: String(restoreError.message || restoreError).slice(0, 220),
      }, null, 2));
    }
    throw error;
  }
  return {
    sourceLast4: source.number.slice(-4),
    targetLast4: target.number.slice(-4),
    stopAccepted: Boolean(stopAccepted?.sid),
    startAccepted: Boolean(startAccepted?.sid),
    stopMessageHash: shortHash(stopAccepted?.sid),
    startMessageHash: shortHash(startAccepted?.sid),
    pausedObserved: true,
    resumedObserved: true,
    finalSuppressed: Boolean((await checkSuppression(source.number)).suppressed),
    restoredViaFallback,
  };
}

async function main() {
  if (!/^https:\/\//i.test(webhookUrl)) throw new Error("TWILIO_INBOUND_WEBHOOK_URL must be HTTPS.");
  const { targets, skipped } = await collectTargets();
  if (!targets.length) throw new Error("No active managed service-text numbers were found.");
  const inspection = await inspectConfiguration(targets);
  const blocked = inspection.rows.filter((row) => row.blockedReason);
  const report = {
    mode: applyWebhooks ? "apply-webhooks" : testStopStart ? "test-stop-start" : "dry-run",
    webhookHost: safeHost(webhookUrl),
    activeManagedNumbers: targets.length,
    accounts: inspection.accounts.size,
    alreadyConfigured: inspection.rows.filter((row) => row.desired).length,
    changesPlanned: inspection.rows.filter((row) => !row.desired && !row.blockedReason).length,
    blocked: blocked.length,
    skippedAssistants: skipped.length,
    rows: inspection.rows.map(publicRow),
    skipped,
  };
  console.log(JSON.stringify(report, null, 2));
  if (blocked.length || skipped.length) process.exitCode = 2;
  if ((applyWebhooks || testStopStart) && skipped.length) {
    throw new Error(`Refusing live activation because ${skipped.length} assistant mapping(s) were skipped.`);
  }
  if (applyWebhooks) {
    const applied = await applyConfiguration(inspection);
    console.log(JSON.stringify({ applied: true, ...applied }, null, 2));
  }
  if (testStopStart) {
    const refreshed = await inspectConfiguration(targets);
    const test = await runStopStartTest(refreshed);
    console.log(JSON.stringify({ liveStopStartTest: true, ...test }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error(`Prisma disconnect failed: ${String(error.message || error).slice(0, 180)}`);
    process.exitCode = 1;
  }
});
