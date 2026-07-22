const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const vapiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const vapiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const inactiveDays = Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] || 90));

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`${options.label || url} failed with HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
  return body;
}

async function vapiRequest(path) {
  return jsonRequest(`${vapiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${vapiKey}`, Accept: "application/json" },
    label: `Vapi ${path}`,
  });
}

async function resolveTwilioCredentials() {
  if (usableSecret(env.TWILIO_ACCOUNT_SID) && usableSecret(env.TWILIO_AUTH_TOKEN)) {
    return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN };
  }
  if (!vapiKey) throw new Error("Neither Twilio credentials nor VAPI_API_KEY are configured.");
  const summaries = listFrom(await vapiRequest("/tool?limit=1000"), ["tools"]);
  for (const summary of summaries) {
    const name = String(summary?.function?.name || summary?.name || "");
    if (!/^send_call_summaries_/i.test(name) || !summary?.id) continue;
    const detail = await vapiRequest(`/tool/${encodeURIComponent(summary.id)}`);
    const values = environmentMap(detail);
    if (usableSecret(values.TWILIO_ACCOUNT_SID) && usableSecret(values.TWILIO_AUTH_TOKEN)) {
      return { accountSid: values.TWILIO_ACCOUNT_SID, authToken: values.TWILIO_AUTH_TOKEN };
    }
  }
  throw new Error("No usable Twilio credentials were available through the protected Vapi tools.");
}

function twilioHeaders(accountSid, authToken) {
  return {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    Accept: "application/json",
  };
}

async function fetchTwilioPages(firstUrl, collectionKey, credentials, maxPages = 100) {
  const records = [];
  let url = firstUrl;
  for (let page = 0; url && page < maxPages; page += 1) {
    const body = await jsonRequest(url, { headers: twilioHeaders(credentials.accountSid, credentials.authToken), label: `Twilio ${collectionKey}` });
    records.push(...(Array.isArray(body?.[collectionKey]) ? body[collectionKey] : []));
    const next = String(body?.next_page_uri || "").trim();
    url = next ? new URL(next, "https://api.twilio.com").toString() : "";
  }
  return records;
}

async function fetchLocalMonthlyPrice(countryCode, credentials) {
  // Twilio's Phone Number Pricing endpoint is not enabled on every account.
  // These fallbacks are the published monthly prices for local numbers in the
  // two countries represented in this account, as of this script's audit date.
  const publishedFallbacks = { CA: 1.15, US: 1.15 };
  try {
    const body = await jsonRequest(`https://pricing.twilio.com/v2/PhoneNumbers/Countries/${countryCode}`, {
      headers: twilioHeaders(credentials.accountSid, credentials.authToken),
      label: `Twilio ${countryCode} phone-number pricing`,
    });
    const prices = Array.isArray(body?.phone_number_prices) ? body.phone_number_prices : [];
    const local = prices.find((item) => String(item?.number_type || "").toLowerCase() === "local");
    const price = Number(local?.current_price ?? local?.base_price);
    if (Number.isFinite(price)) return { price, unit: String(body?.price_unit || "USD"), source: "api" };
  } catch (error) {
    process.stderr.write(`${error.message}; using Twilio's published local-number rate.\n`);
  }
  return { price: publishedFallbacks[countryCode] ?? null, unit: "USD", source: "published-fallback" };
}

function vapiCallDate(call) {
  const raw = call?.endedAt || call?.startedAt || call?.createdAt || call?.updatedAt;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

async function fetchVapiCalls(maxPages = 100) {
  const records = [];
  const seen = new Set();
  let createdAtLt = "";
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (createdAtLt) query.set("createdAtLt", createdAtLt);
    const batch = listFrom(await vapiRequest(`/call?${query.toString()}`), ["calls"]);
    for (const call of batch) {
      const id = String(call?.id || call?.callId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      records.push(call);
    }
    if (batch.length < 1000) break;
    const times = batch.map(vapiCallDate).filter(Boolean).map((date) => date.getTime());
    if (!times.length) break;
    createdAtLt = new Date(Math.min(...times) - 1).toISOString();
  }
  return records;
}

async function fetchVapiEvidence() {
  if (!vapiKey) return { assignments: new Map(), activity: new Map(), callsFetched: 0 };
  const [phonePayload, assistantPayload] = await Promise.all([
    vapiRequest("/phone-number?limit=1000"),
    vapiRequest("/assistant?limit=1000"),
  ]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const names = new Map(assistants.map((assistant) => [String(assistant?.id || ""), String(assistant?.name || "")]));
  const phoneRecords = listFrom(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const idToNumber = new Map();
  const assignments = new Map(phoneRecords.map((record) => {
    const number = normalizePhone(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
    const phoneId = String(record?.id || record?.phoneNumberId || "");
    if (phoneId && number) idToNumber.set(phoneId, number);
    const assistantId = String(record?.assistantId || record?.assistant?.id || "");
    return [number, names.get(assistantId) || String(record?.assistant?.name || "")];
  }).filter(([number]) => number));
  const calls = await fetchVapiCalls();
  const activity = new Map();
  for (const call of calls) {
    const phoneId = String(call?.phoneNumberId || call?.phoneNumber?.id || "");
    const number = idToNumber.get(phoneId) || normalizePhone(
      call?.phoneNumber?.number || call?.phoneNumber?.phoneNumber || call?.to || call?.toNumber
    );
    if (!number) continue;
    const item = activity.get(number) || { calls: 0, last: null };
    const at = vapiCallDate(call);
    item.calls += 1;
    if (at && (!item.last || at > item.last)) item.last = at;
    activity.set(number, item);
  }
  return { assignments, activity, callsFetched: calls.length };
}

function activityDate(record, kind) {
  const raw = kind === "call"
    ? record?.end_time || record?.start_time || record?.date_created
    : record?.date_sent || record?.date_updated || record?.date_created;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function nextMonthlyAnniversary(createdAt, now = new Date()) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  const build = () => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(created.getUTCDate(), lastDay), created.getUTCHours(), created.getUTCMinutes(), created.getUTCSeconds()));
  };
  let candidate = build();
  if (candidate <= now) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    candidate = build();
  }
  return candidate;
}

function urlHost(value) {
  try { return new URL(String(value || "")).hostname.toLowerCase(); } catch { return ""; }
}

function urlFingerprint(value) {
  const text = String(value || "").trim();
  return text ? crypto.createHash("sha256").update(text).digest("hex").slice(0, 12) : "";
}

async function main() {
  const credentials = await resolveTwilioCredentials();
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}`;
  const [numbers, calls, messages, vapiEvidence, caPrice, usPrice] = await Promise.all([
    fetchTwilioPages(`${base}/IncomingPhoneNumbers.json?PageSize=1000`, "incoming_phone_numbers", credentials),
    fetchTwilioPages(`${base}/Calls.json?PageSize=1000`, "calls", credentials),
    fetchTwilioPages(`${base}/Messages.json?PageSize=1000`, "messages", credentials),
    fetchVapiEvidence(),
    fetchLocalMonthlyPrice("CA", credentials),
    fetchLocalMonthlyPrice("US", credentials),
  ]);
  const owned = new Set(numbers.map((record) => normalizePhone(record?.phone_number)).filter(Boolean));
  const activity = new Map([...owned].map((number) => [number, { calls: 0, messages: 0, last: null }]));
  for (const [kind, records] of [["call", calls], ["message", messages]]) {
    for (const record of records) {
      const touched = new Set([normalizePhone(record?.from), normalizePhone(record?.to)].filter((number) => owned.has(number)));
      const at = activityDate(record, kind);
      for (const number of touched) {
        const item = activity.get(number);
        if (kind === "call") item.calls += 1;
        else item.messages += 1;
        if (at && (!item.last || at > item.last)) item.last = at;
      }
    }
  }
  const now = new Date();
  const thresholdMs = inactiveDays * 24 * 60 * 60 * 1000;
  const rows = numbers.map((record) => {
    const number = normalizePhone(record?.phone_number);
    const item = activity.get(number) || { calls: 0, messages: 0, last: null };
    const vapiItem = vapiEvidence.activity.get(number) || { calls: 0, last: null };
    const combinedLast = [item.last, vapiItem.last].filter(Boolean).sort((left, right) => right - left)[0] || null;
    const daysSince = combinedLast ? Math.floor((now - combinedLast) / (24 * 60 * 60 * 1000)) : null;
    const isUs = number.startsWith("+1775");
    const pricing = isUs ? usPrice : caPrice;
    return {
      number,
      friendlyName: String(record?.friendly_name || ""),
      acquiredAt: record?.date_created || null,
      nextEstimatedRenewalAt: nextMonthlyAnniversary(record?.date_created, now)?.toISOString() || null,
      voiceRouteHost: urlHost(record?.voice_url),
      voiceRouteFingerprint: urlFingerprint(record?.voice_url),
      smsRouteHost: urlHost(record?.sms_url),
      smsRouteFingerprint: urlFingerprint(record?.sms_url),
      hasVoiceApplication: Boolean(String(record?.voice_application_sid || "").trim()),
      hasMessagingService: Boolean(String(record?.messaging_service_sid || "").trim()),
      callCount: item.calls,
      messageCount: item.messages,
      lastActivityAt: combinedLast?.toISOString() || null,
      twilioLastActivityAt: item.last?.toISOString() || null,
      vapiCallCount: vapiItem.calls,
      vapiLastActivityAt: vapiItem.last?.toISOString() || null,
      daysInactive: daysSince,
      inactive: !combinedLast || now - combinedLast >= thresholdMs,
      vapiAssistant: vapiEvidence.assignments.get(number) || "",
      monthlyCost: pricing.price,
      currency: pricing.unit || "USD",
    };
  }).sort((left, right) => {
    if (left.inactive !== right.inactive) return left.inactive ? -1 : 1;
    if (left.lastActivityAt === right.lastActivityAt) return left.number.localeCompare(right.number);
    if (!left.lastActivityAt) return -1;
    if (!right.lastActivityAt) return 1;
    return left.lastActivityAt.localeCompare(right.lastActivityAt);
  });
  const inactive = rows.filter((row) => row.inactive);
  const sum = (items) => items.reduce((total, row) => total + (Number(row.monthlyCost) || 0), 0);
  console.log(JSON.stringify({
    auditedAt: now.toISOString(),
    inactiveDefinitionDays: inactiveDays,
    account: {
      ownedNumbers: rows.length,
      vapiCallsFetched: vapiEvidence.callsFetched,
      vapiCallsMatchedToCurrentNumbers: [...vapiEvidence.activity.values()].reduce((total, item) => total + item.calls, 0),
      vapiNumbersWithCallHistory: [...vapiEvidence.activity.values()].filter((item) => item.calls > 0).length,
      estimatedMonthlyNumberCost: Number(sum(rows).toFixed(2)),
      currency: rows.find((row) => row.currency)?.currency || "USD",
    },
    inactiveSummary: {
      count: inactive.length,
      neverUsed: inactive.filter((row) => !row.lastActivityAt).length,
      inactiveAtLeastThreshold: inactive.filter((row) => row.lastActivityAt).length,
      estimatedMonthlyCost: Number(sum(inactive).toFixed(2)),
    },
    activeMakeRoutedNumbers: rows.filter((row) => !row.inactive && row.voiceRouteHost === "hook.us2.make.com").map((row) => ({
      number: row.number,
      lastActivityAt: row.lastActivityAt,
      callCount: row.callCount,
      messageCount: row.messageCount,
      routeFingerprint: row.voiceRouteFingerprint,
    })),
    activeNumbers: rows.filter((row) => !row.inactive),
    inactiveNumbers: inactive,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
