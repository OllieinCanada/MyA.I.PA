const crypto = require("crypto");
const { loadProjectEnv, redact } = require("./_helpers");
const { analyzeVapiSmsCall, normalizePhone } = require("../server/vapiCallDiagnostics");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim().replace(/\/+$/, "");

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

async function getJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(`Vapi ${path} failed with HTTP ${response.status}: ${String(data.message || data.error || "request failed").slice(0, 240)}`);
  return data;
}

function listFrom(value, extraKeys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "calls", "results", ...extraKeys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function callTime(call) {
  return new Date(call?.createdAt || call?.startedAt || call?.created_at || 0).getTime() || 0;
}

function callPhone(call) {
  return normalizePhone(
    call?.phoneNumber?.number ||
      call?.phoneNumber?.phoneNumber ||
      call?.phoneNumber?.phone_number ||
      call?.to ||
      call?.toNumber
  );
}

function phoneInventoryNumber(record) {
  return normalizePhone(
    record?.number ||
      record?.phoneNumber ||
      record?.twilioPhoneNumber ||
      record?.providerResourceId
  );
}

function callPhoneNumberId(call) {
  return String(call?.phoneNumberId || call?.phoneNumber?.id || "").trim();
}

function customerPhone(call) {
  return normalizePhone(call?.customer?.number || call?.customer?.phoneNumber || call?.caller?.number || call?.from || call?.fromNumber);
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolName(value) {
  return String(value?.name || value?.function?.name || "").trim();
}

function isCompositeToolName(value) {
  return /^send_call_summaries_/i.test(String(value || ""));
}

function messageId(value) {
  const id = String(value?.messageId || value?.messageSid || value?.sid || "").trim();
  return /^SM[0-9A-Za-z]{20,}$/i.test(id) ? id : "";
}

function shortId(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function collectCompositeMessageReferences(call) {
  const compositeCallIds = new Set();
  const references = new Map();
  const visitedCalls = new Set();
  const visitedResults = new Set();

  function visitCalls(value) {
    if (!value || typeof value !== "object" || visitedCalls.has(value)) return;
    visitedCalls.add(value);
    if (Array.isArray(value)) {
      value.forEach(visitCalls);
      return;
    }
    for (const key of ["toolCallList", "toolCalls", "tool_calls"]) {
      for (const item of Array.isArray(value[key]) ? value[key] : []) {
        if (isCompositeToolName(toolName(item))) {
          const id = String(item?.id || item?.toolCallId || item?.tool_call_id || "").trim();
          if (id) compositeCallIds.add(id);
        }
      }
    }
    if (isCompositeToolName(toolName(value))) {
      const id = String(value?.id || value?.toolCallId || value?.tool_call_id || "").trim();
      if (id) compositeCallIds.add(id);
    }
    Object.values(value).forEach(visitCalls);
  }

  function visitResults(value) {
    if (!value || typeof value !== "object" || visitedResults.has(value)) return;
    visitedResults.add(value);
    if (Array.isArray(value)) {
      value.forEach(visitResults);
      return;
    }
    const resultCallId = String(value?.toolCallId || value?.tool_call_id || "").trim();
    if ((resultCallId && compositeCallIds.has(resultCallId)) || isCompositeToolName(toolName(value))) {
      const parsed = parseObject(value.result ?? value.output ?? value.content ?? value.message);
      for (const role of ["owner", "customer"]) {
        const id = messageId(parsed?.[role]);
        if (id) references.set(role, { role, id });
      }
    }
    Object.values(value).forEach(visitResults);
  }

  visitCalls(call);
  visitResults(call);
  return [...references.values()];
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

async function reconcileTwilioMessages(call) {
  const references = collectCompositeMessageReferences(call);
  if (!references.length) return { available: false, reason: "No composite Twilio message IDs were recorded for this call.", messages: [] };

  const assistantId = String(call?.assistantId || call?.assistant?.id || "").trim();
  if (!assistantId) return { available: false, reason: "The call has no assistant ID for credential lookup.", messages: [] };
  const assistant = await getJson(`/assistant/${encodeURIComponent(assistantId)}`);
  const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  const tools = await Promise.all(toolIds.map((id) => getJson(`/tool/${encodeURIComponent(id)}`)));
  const compositeTool = tools.find((tool) => isCompositeToolName(toolName(tool)));
  const toolEnv = environmentMap(compositeTool);
  const accountSid = toolEnv.TWILIO_ACCOUNT_SID;
  const authToken = toolEnv.TWILIO_AUTH_TOKEN;
  if (!usableSecret(accountSid) || !usableSecret(authToken)) {
    return { available: false, reason: "Vapi did not expose usable Twilio credentials for final-status lookup.", messages: [] };
  }

  const messages = await Promise.all(references.map(async ({ role, id }) => {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(id)}.json`,
      { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, Accept: "application/json" } }
    );
    const body = parseObject(await response.text());
    if (!response.ok) {
      return { role, messageIdHash: shortId(id), status: "lookup_failed", errorCode: String(body?.code || response.status).slice(0, 40), fromLast4: "", toLast4: "", sentAt: null };
    }
    return {
      role,
      messageIdHash: shortId(id),
      status: String(body?.status || "unknown").slice(0, 40),
      errorCode: body?.error_code == null ? "" : String(body.error_code).slice(0, 40),
      fromLast4: normalizePhone(body?.from).slice(-4),
      toLast4: normalizePhone(body?.to).slice(-4),
      sentAt: body?.date_sent || body?.date_created || null,
    };
  }));
  return { available: true, reason: "", messages };
}

async function findLatestCall({ aiPhone, sinceMinutes, limit }) {
  let expectedPhoneNumberId = "";
  if (aiPhone) {
    const inventory = listFrom(await getJson("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
    const matchingNumber = inventory.find((record) => phoneInventoryNumber(record) === aiPhone);
    expectedPhoneNumberId = String(matchingNumber?.id || matchingNumber?.phoneNumberId || "").trim();
  }
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
  const page = await getJson(`/call?limit=${encodeURIComponent(limit)}&createdAtGt=${encodeURIComponent(since)}`);
  const calls = listFrom(page).sort((left, right) => callTime(right) - callTime(left));
  if (!calls.length) throw new Error(`No Vapi calls were found in the last ${sinceMinutes} minutes.`);

  for (const candidate of calls) {
    const id = String(candidate?.id || candidate?.callId || "").trim();
    if (!id) continue;
    const detail = await getJson(`/call/${encodeURIComponent(id)}`);
    const matchesId = expectedPhoneNumberId && [callPhoneNumberId(detail), callPhoneNumberId(candidate)].includes(expectedPhoneNumberId);
    const matchesNumber = callPhone(detail) === aiPhone || callPhone(candidate) === aiPhone;
    if (!aiPhone || matchesId || matchesNumber) return detail;
  }
  throw new Error(`No recent Vapi call matched the requested AI number ending ${aiPhone.slice(-4)}.`);
}

function printHuman(report) {
  const line = (label, value) => console.log(`${label}: ${value}`);
  console.log("MyAIPA latest Vapi SMS diagnostic");
  console.log("=================================");
  line("Call", report.call.idHash || "unknown");
  line("Started", report.call.createdAt || "unknown");
  line("Status", [report.call.status, report.call.endedReason].filter(Boolean).join(" / ") || "unknown");
  line("Customer SMS tool", report.customer.invoked ? (report.customer.successful ? "called — success" : report.customer.failed ? "called — failed" : "called — result missing") : "not called");
  line("Owner SMS tool", report.owner.invoked ? (report.owner.successful ? "called — reported success" : report.owner.failed ? "called — failed" : "called — result missing") : "not called");
  if (report.routing.customerDestinationLast4.length) line("Customer destination", report.routing.customerDestinationLast4.map((value) => `***${value}`).join(", "));
  if (report.routing.ownerDestinationLast4.length) line("Owner destination", report.routing.ownerDestinationLast4.map((value) => `***${value}`).join(", "));
  if (report.routing.ownerSenderLast4.length) line("Owner sender", report.routing.ownerSenderLast4.map((value) => `***${value}`).join(", "));
  console.log("");
  line("Finding", `${report.finding.code} (${report.finding.severity})`);
  line("Meaning", report.finding.summary);
  line("Next action", report.finding.nextAction);

  const failedResults = report.owner.calls.flatMap((item) => item.results).filter((item) => item.failed || item.error || item.errorCode || item.sent === false || item.ok === false);
  for (const result of failedResults) {
    line("Owner tool error", [result.errorCode, result.error, result.status].filter(Boolean).join(" — ") || "reported failure without details");
  }
}

async function main() {
  if (!apiKey) {
    throw new Error("VAPI_API_KEY is not set. Add it to .env.local (do not paste it into chat) and rerun this command.");
  }
  const aiPhone = normalizePhone(argument("phone", env.MYAIPA_TEST_AI_PHONE || "+12494682588"));
  const ownerPhone = normalizePhone(argument("owner-phone", env.MYAIPA_TEST_OWNER_PHONE || ""));
  const ownerLast4 = argument("owner-last4", "").replace(/\D/g, "").slice(-4);
  const sinceMinutes = Math.max(5, Math.min(18720, Number(argument("since-minutes", "180")) || 180));
  const limit = Math.max(1, Math.min(100, Number(argument("limit", "20")) || 20));
  const call = await findLatestCall({ aiPhone, sinceMinutes, limit });
  const report = analyzeVapiSmsCall(call, { aiPhone, ownerPhone, ownerLast4, customerPhone: customerPhone(call) });
  if (hasFlag("twilio-status")) report.delivery = await reconcileTwilioMessages(call);
  if (hasFlag("json")) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (report.finding.severity === "critical") process.exitCode = 2;
}

main().catch((error) => {
  console.error("Latest Vapi call diagnostic could not run:");
  console.error(`- ${error.message || error}`);
  console.error(`- Vapi API: ${apiBaseUrl} (${redact(apiKey)})`);
  process.exitCode = 1;
});
