const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const vapiApiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const vapiApiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const days = Math.max(
  1,
  Math.min(
    365,
    Number(process.argv.find((argument) => argument.startsWith("--days="))?.split("=")[1] || 30)
  )
);
const usdCadRate = Number(
  process.argv.find((argument) => argument.startsWith("--usd-cad="))?.split("=")[1] ||
  env.USD_CAD_RATE ||
  0
);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function clean(value, max = 200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function hashLast4(value) {
  const normalized = normalizePhone(value);
  return normalized ? `***${normalized.slice(-4)}` : "unknown";
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

function dateValue(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    throw new Error(`${options.label || url} failed with HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
  }
  return body;
}

async function vapiRequest(path) {
  return jsonRequest(`${vapiApiBase}${path}`, {
    headers: { Authorization: `Bearer ${vapiApiKey}`, Accept: "application/json" },
    label: `Vapi ${path}`,
  });
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(
    entries
      .map((entry) => [String(entry?.name || ""), String(entry?.value || "")])
      .filter(([name]) => name)
  );
}

async function resolveTwilioCredentials() {
  if (usableSecret(env.TWILIO_ACCOUNT_SID) && usableSecret(env.TWILIO_AUTH_TOKEN)) {
    const local = { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, source: "local_environment" };
    if (await hasUsableTwilioCredentials(local)) return local;
  }
  const tools = listFrom(await vapiRequest("/tool?limit=1000"), ["tools"]);
  const checked = new Set();
  for (const summary of tools) {
    const name = String(summary?.function?.name || summary?.name || "");
    if (!/^send_call_summaries_/i.test(name) || !summary?.id) continue;
    const detail = await vapiRequest(`/tool/${encodeURIComponent(summary.id)}`);
    const values = environmentMap(detail);
    if (usableSecret(values.TWILIO_ACCOUNT_SID) && usableSecret(values.TWILIO_AUTH_TOKEN)) {
      const fingerprint = `${values.TWILIO_ACCOUNT_SID}:${values.TWILIO_AUTH_TOKEN}`;
      if (checked.has(fingerprint)) continue;
      checked.add(fingerprint);
      const candidate = {
        accountSid: values.TWILIO_ACCOUNT_SID,
        authToken: values.TWILIO_AUTH_TOKEN,
        source: "protected_vapi_tool",
      };
      if (await hasUsableTwilioCredentials(candidate)) return candidate;
    }
  }
  throw new Error("No usable Twilio credentials were available locally or through the protected Vapi tools.");
}

function twilioHeaders(credentials) {
  return {
    Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
    Accept: "application/json",
  };
}

async function hasUsableTwilioCredentials(credentials) {
  if (!usableSecret(credentials?.accountSid) || !usableSecret(credentials?.authToken)) return false;
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Usage/Records.json?PageSize=1`,
      {
        headers: twilioHeaders(credentials),
        signal: AbortSignal.timeout(15000),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchTwilioPages(firstUrl, collectionKey, credentials, maxPages = 100) {
  const records = [];
  let url = firstUrl;
  for (let page = 0; url && page < maxPages; page += 1) {
    const body = await jsonRequest(url, {
      headers: twilioHeaders(credentials),
      label: `Twilio ${collectionKey}`,
    });
    records.push(...(Array.isArray(body?.[collectionKey]) ? body[collectionKey] : []));
    const nextPage = String(body?.next_page_uri || "").trim();
    url = nextPage ? new URL(nextPage, "https://api.twilio.com").toString() : "";
  }
  return records;
}

function vapiCallDate(call) {
  return dateValue(call?.endedAt || call?.startedAt || call?.createdAt || call?.updatedAt);
}

async function fetchVapiCallsSince(cutoff, maxPages = 100) {
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
      const at = vapiCallDate(call);
      if (at && at >= cutoff) records.push(call);
    }
    if (batch.length < 1000) break;
    const times = batch.map(vapiCallDate).filter(Boolean).map((date) => date.getTime());
    if (!times.length || Math.min(...times) < cutoff.getTime()) break;
    createdAtLt = new Date(Math.min(...times) - 1).toISOString();
  }
  return records;
}

function nestedValue(source, paths) {
  for (const path of paths) {
    let current = source;
    for (const segment of path.split(".")) current = current?.[segment];
    if (current != null && current !== "") return current;
  }
  return null;
}

function vapiCost(call) {
  return Math.abs(number(call?.cost ?? call?.totalCost ?? call?.costInUsd ?? call?.price));
}

function vapiDurationSeconds(call) {
  const direct = number(call?.durationSeconds ?? call?.durationSec ?? call?.duration);
  if (direct) return direct;
  const started = dateValue(call?.startedAt || call?.createdAt);
  const ended = dateValue(call?.endedAt || call?.completedAt);
  return started && ended ? Math.max(0, (ended.getTime() - started.getTime()) / 1000) : 0;
}

function vapiTwilioSid(call) {
  return clean(
    nestedValue(call, [
      "twilioCallSid",
      "twilio.callSid",
      "phoneCallProviderDetails.twilioCallSid",
      "phoneCallProviderDetails.callSid",
      "transport.callSid",
      "metadata.twilioCallSid",
    ]),
    80
  );
}

function addBreakdownValue(target, key, value) {
  if (/(?:tokens?|characters?|cachedprompt|prompttokens|completiontokens)$/i.test(key.replace(/[^a-z]/gi, ""))) return;
  if (value == null) return;
  if (typeof value === "number" || typeof value === "string") {
    const amount = number(value);
    if (amount) target[key] = number(target[key]) + Math.abs(amount);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => addBreakdownValue(target, `${key}[${index}]`, item));
    return;
  }
  if (typeof value !== "object") return;
  const direct = number(value.cost ?? value.amount ?? value.price);
  if (direct) {
    target[key] = number(target[key]) + Math.abs(direct);
    return;
  }
  Object.entries(value).forEach(([nestedKey, nested]) => {
    addBreakdownValue(target, key ? `${key}.${nestedKey}` : nestedKey, nested);
  });
}

function aggregateVapiBreakdown(calls) {
  const totals = {};
  for (const call of calls) {
    const breakdown = call?.costBreakdown || call?.costs || call?.costsBreakdown || call?.analysis?.costBreakdown;
    if (!breakdown || typeof breakdown !== "object") continue;
    if (Array.isArray(breakdown)) {
      breakdown.forEach((item, index) => {
        const key = String(item?.type || item?.name || item?.category || `item[${index}]`);
        addBreakdownValue(totals, key, item);
      });
    } else {
      Object.entries(breakdown).forEach(([key, value]) => addBreakdownValue(totals, key, value));
    }
  }
  return Object.fromEntries(
    Object.entries(totals)
      .map(([key, value]) => [key, round(value)])
      .sort((left, right) => right[1] - left[1])
  );
}

function twilioRecordDate(record, kind) {
  const raw = kind === "call"
    ? record?.start_time || record?.date_created || record?.date_updated
    : record?.date_sent || record?.date_created || record?.date_updated;
  return dateValue(raw);
}

function selectTwilioUsage(records) {
  const normalized = records
    .map((record) => ({
      category: clean(record?.category || "unknown"),
      description: clean(record?.description || record?.category || "Twilio usage"),
      price: Math.abs(number(record?.price)),
      currency: clean(record?.price_unit || "USD"),
    }))
    .filter((record) => record.price);
  const total = normalized.find((record) => /^(total[-_ ]?price)$/i.test(record.category.replace(/[^a-z0-9_-]/gi, "")));
  if (total) return { totalCost: total.price, source: "account_total", records: normalized, included: [total.category] };

  const leaf = normalized.filter((record) => {
    const key = record.category.toLowerCase();
    return !normalized.some((other) => other !== record && other.category.toLowerCase().startsWith(`${key}-`));
  });
  const selected = leaf.length ? leaf : normalized;
  return {
    totalCost: selected.reduce((sum, record) => sum + record.price, 0),
    source: "leaf_categories",
    records: normalized,
    included: selected.map((record) => record.category),
  };
}

function cad(value) {
  return usdCadRate > 0 ? round(number(value) * usdCadRate) : null;
}

async function main() {
  if (!vapiApiKey) throw new Error("VAPI_API_KEY is not configured.");
  const credentials = await resolveTwilioCredentials();
  const end = new Date();
  const cutoff = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}`;
  const callUrl = new URL(`${twilioBase}/Calls.json`);
  callUrl.searchParams.set("StartTime>=", dateOnly(cutoff));
  callUrl.searchParams.set("PageSize", "1000");
  const messageUrl = new URL(`${twilioBase}/Messages.json`);
  messageUrl.searchParams.set("DateSent>=", dateOnly(cutoff));
  messageUrl.searchParams.set("PageSize", "1000");
  const usageUrl = new URL(`${twilioBase}/Usage/Records.json`);
  usageUrl.searchParams.set("StartDate", dateOnly(cutoff));
  usageUrl.searchParams.set("EndDate", dateOnly(end));
  usageUrl.searchParams.set("PageSize", "1000");
  const numbersUrl = new URL(`${twilioBase}/IncomingPhoneNumbers.json`);
  numbersUrl.searchParams.set("PageSize", "1000");

  const [vapiCalls, twilioCallsRaw, twilioMessagesRaw, usageRecords, activeNumbers] = await Promise.all([
    fetchVapiCallsSince(cutoff),
    fetchTwilioPages(callUrl.toString(), "calls", credentials),
    fetchTwilioPages(messageUrl.toString(), "messages", credentials),
    fetchTwilioPages(usageUrl.toString(), "usage_records", credentials),
    fetchTwilioPages(numbersUrl.toString(), "incoming_phone_numbers", credentials),
  ]);

  const twilioCalls = twilioCallsRaw.filter((call) => {
    const at = twilioRecordDate(call, "call");
    return at && at >= cutoff && at <= end;
  });
  const twilioMessages = twilioMessagesRaw.filter((message) => {
    const at = twilioRecordDate(message, "message");
    return at && at >= cutoff && at <= end;
  });
  const twilioCallsBySid = new Map(twilioCalls.map((call) => [String(call?.sid || ""), call]));
  const matchedTwilioSids = new Set();
  const perCall = vapiCalls.map((call) => {
    const sid = vapiTwilioSid(call);
    const twilio = sid ? twilioCallsBySid.get(sid) : null;
    if (twilio?.sid) matchedTwilioSids.add(twilio.sid);
    return {
      phone: hashLast4(
        nestedValue(call, [
          "phoneNumber.number",
          "phoneNumber.phoneNumber",
          "phoneNumber.twilioPhoneNumber",
          "to",
          "toNumber",
        ])
      ),
      durationSeconds: vapiDurationSeconds(call),
      vapiCost: vapiCost(call),
      twilioCost: Math.abs(number(twilio?.price)),
      twilioMatched: Boolean(twilio),
    };
  });

  const totalDurationSeconds = perCall.reduce((sum, call) => sum + call.durationSeconds, 0);
  const totalMinutes = totalDurationSeconds / 60;
  const totalVapiCost = perCall.reduce((sum, call) => sum + call.vapiCost, 0);
  const matchedTwilioCallCost = perCall.reduce((sum, call) => sum + call.twilioCost, 0);
  const directTwilioCallCost = twilioCalls.reduce((sum, call) => sum + Math.abs(number(call?.price)), 0);
  const directTwilioMessageCost = twilioMessages.reduce((sum, message) => sum + Math.abs(number(message?.price)), 0);
  const usage = selectTwilioUsage(usageRecords);
  const knownProviderCost = totalVapiCost + usage.totalCost;
  const phoneNumberCostRecord =
    usage.records.find((record) => record.category.toLowerCase() === "phonenumbers") ||
    usage.records.find((record) => record.category.toLowerCase() === "phonenumbers-local");
  const historicalPhoneNumberCost = number(phoneNumberCostRecord?.price);
  const twilioUsageExcludingNumberRent = Math.max(0, usage.totalCost - historicalPhoneNumberCost);
  const measuredVariableProviderCost = totalVapiCost + twilioUsageExcludingNumberRent;
  const vapiBreakdown = aggregateVapiBreakdown(vapiCalls);
  const transportCost = Object.entries(vapiBreakdown)
    .filter(([key]) => /transport|telephony|twilio/i.test(key))
    .reduce((sum, [, value]) => sum + number(value), 0);
  const callCount = perCall.length;

  const byNumber = new Map();
  for (const call of perCall) {
    const row = byNumber.get(call.phone) || {
      phone: call.phone,
      calls: 0,
      minutes: 0,
      vapiCost: 0,
      matchedTwilioCost: 0,
    };
    row.calls += 1;
    row.minutes += call.durationSeconds / 60;
    row.vapiCost += call.vapiCost;
    row.matchedTwilioCost += call.twilioCost;
    byNumber.set(call.phone, row);
  }

  console.log(JSON.stringify({
    measuredAt: end.toISOString(),
    window: { days, from: cutoff.toISOString(), to: end.toISOString() },
    currency: {
      providerCurrency: "USD",
      usdCadRate: usdCadRate > 0 ? usdCadRate : null,
      note: usdCadRate > 0 ? "CAD values use the supplied indicative USD/CAD rate." : "Pass --usd-cad=<rate> to add CAD estimates.",
    },
    coverage: {
      vapiCalls: callCount,
      vapiMinutes: round(totalMinutes, 2),
      twilioCalls: twilioCalls.length,
      vapiCallsMatchedToTwilio: matchedTwilioSids.size,
      twilioMessages: twilioMessages.length,
      callsWithVapiCost: perCall.filter((call) => call.vapiCost > 0).length,
    },
    measuredCosts: {
      vapiReportedCostUsd: round(totalVapiCost),
      vapiReportedCostCad: cad(totalVapiCost),
      twilioWholeAccountCostUsd: round(usage.totalCost),
      twilioWholeAccountCostCad: cad(usage.totalCost),
      historicalPhoneNumberRentUsd: round(historicalPhoneNumberCost),
      historicalPhoneNumberRentCad: cad(historicalPhoneNumberCost),
      twilioUsageExcludingNumberRentUsd: round(twilioUsageExcludingNumberRent),
      twilioUsageExcludingNumberRentCad: cad(twilioUsageExcludingNumberRent),
      measuredVariableProviderCostUsd: round(measuredVariableProviderCost),
      measuredVariableProviderCostCad: cad(measuredVariableProviderCost),
      knownProviderCostUsd: round(knownProviderCost),
      knownProviderCostCad: cad(knownProviderCost),
      crossChecks: {
        matchedTwilioCallCostUsd: round(matchedTwilioCallCost),
        allTwilioCallRecordsUsd: round(directTwilioCallCost),
        allTwilioMessageRecordsUsd: round(directTwilioMessageCost),
        twilioUsageTotalSource: usage.source,
      },
    },
    averages: {
      averageCallDurationMinutes: callCount ? round(totalMinutes / callCount, 2) : null,
      vapiReportedCostPerCallUsd: callCount ? round(totalVapiCost / callCount) : null,
      vapiReportedCostPerCallCad: callCount ? cad(totalVapiCost / callCount) : null,
      vapiReportedCostPerMinuteUsd: totalMinutes ? round(totalVapiCost / totalMinutes) : null,
      vapiReportedCostPerMinuteCad: totalMinutes ? cad(totalVapiCost / totalMinutes) : null,
      measuredVariableProviderCostPerCallUsd: callCount ? round(measuredVariableProviderCost / callCount) : null,
      measuredVariableProviderCostPerCallCad: callCount ? cad(measuredVariableProviderCost / callCount) : null,
      measuredVariableProviderCostPerMinuteUsd: totalMinutes ? round(measuredVariableProviderCost / totalMinutes) : null,
      measuredVariableProviderCostPerMinuteCad: totalMinutes ? cad(measuredVariableProviderCost / totalMinutes) : null,
      knownProviderCostPerCallUsd: callCount ? round(knownProviderCost / callCount) : null,
      knownProviderCostPerCallCad: callCount ? cad(knownProviderCost / callCount) : null,
      knownProviderCostPerMinuteUsd: totalMinutes ? round(knownProviderCost / totalMinutes) : null,
      knownProviderCostPerMinuteCad: totalMinutes ? cad(knownProviderCost / totalMinutes) : null,
    },
    vapiBreakdown,
    byAiNumber: [...byNumber.values()]
      .map((row) => ({
        phone: row.phone,
        calls: row.calls,
        minutes: round(row.minutes, 2),
        vapiCostUsd: round(row.vapiCost),
        matchedTwilioCostUsd: round(row.matchedTwilioCost),
        vapiCostPerCallUsd: row.calls ? round(row.vapiCost / row.calls) : null,
      }))
      .sort((left, right) => right.calls - left.calls),
    twilioUsage: {
      source: usage.source,
      activePhoneNumbersNow: activeNumbers.length,
      includedCategories: usage.included,
      billableCategories: usage.records,
    },
    completeness: {
      directProviderCostsMeasured: true,
      callAndMessageRecordCrossChecksMeasured: true,
      fixedInfrastructureConfigured: Boolean(env.FIXED_MONTHLY_COSTS_JSON || env.FIXED_MONTHLY_COST_USD),
      stripeFeesAllocated: false,
      supportLabourAllocated: false,
      makeSubscriptionAllocated: false,
      renderSubscriptionAllocated: false,
    },
    warnings: [
      transportCost && usage.totalCost
        ? "The Vapi breakdown contains transport/telephony cost while Twilio account usage is also present. Review the provider invoice relationship before treating their sum as non-overlapping."
        : "",
      "Render, Make, domain, email, payment-processing, support labour, and other overhead are not included until their actual monthly amounts are configured.",
      "Twilio account usage includes account-wide number rental, voice, and messaging. It is blended across all Vapi calls in this report.",
      "AI-number labels are intentionally limited to the final four digits; no caller identities or transcripts are included.",
    ].filter(Boolean),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
