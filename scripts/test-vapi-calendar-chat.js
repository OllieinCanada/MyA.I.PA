const crypto = require("crypto");
const fs = require("fs");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmationPhrase = "CREATE_TEST_BOOKING_2588";
const confirmation = valueFor("confirm");
const envFile = valueFor("env-file");
const targetPhone = normalizeE164(valueFor("phone") || "+12494682588");
const expectedCustomerLast4 = String(valueFor("customer-last4") || "5488").replace(/\D/g, "").slice(-4);
const requestedStart = valueFor("start") || "2026-07-27T10:00:00-04:00";
const durationMinutes = Math.max(15, Math.min(480, Number(valueFor("duration") || 60) || 60));
const apiBase = String(process.env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const apiKey = String(
  process.env.VAPI_API_KEY
    || process.env.VAPI_KEY
    || process.env.VAPI_TOKEN
    || envValueFromFile(envFile, ["VAPI_API_KEY", "VAPI_KEY", "VAPI_TOKEN"])
    || ""
).trim();
const toolName = "request_appointment";

function valueFor(name) {
  const prefix = `--${name}=`;
  const item = args.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length).trim() : "";
}

function envValueFromFile(filePath, names) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const wanted = new Set(names);
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !wanted.has(match[1])) continue;
    return match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return "";
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function shortId(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function customerNumber(call) {
  return normalizeE164(call?.customer?.number || call?.customer?.phoneNumber || call?.caller?.number || call?.from || call?.fromNumber);
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10}/g, "[redacted phone]")
    .slice(0, 600);
}

function outputText(chat) {
  return listFrom(chat?.output)
    .map((item) => {
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) {
        return item.content.map((part) => String(part?.text || part?.content || "")).filter(Boolean).join(" ");
      }
      return String(item?.message || item?.text || "");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function collectBookingEvidence(...roots) {
  const evidence = {
    invoked: false,
    statuses: new Set(),
    appointmentIdHashes: new Set(),
    failed: false,
  };
  const visited = new Set();

  function visit(value) {
    if (value == null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/request_appointment/i.test(trimmed)) evidence.invoked = true;
      if (/\bCONFIRMED\b/i.test(trimmed)) evidence.statuses.add("CONFIRMED");
      if (/\bPENDING\b/i.test(trimmed)) evidence.statuses.add("PENDING");
      if (/\b(?:tool|request|booking).{0,30}(?:failed|error)|(?:failed|error).{0,30}(?:tool|request|booking)/i.test(trimmed)) evidence.failed = true;
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          visit(JSON.parse(trimmed));
        } catch {
          // Non-JSON assistant text.
        }
      }
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const name = String(value?.name || value?.function?.name || "").toLowerCase();
    if (name === toolName) evidence.invoked = true;
    const status = String(value?.status || "").toUpperCase();
    if (["CONFIRMED", "PENDING"].includes(status)) evidence.statuses.add(status);
    const appointmentId = String(value?.appointmentId || value?.appointment?.id || "").trim();
    if (appointmentId) evidence.appointmentIdHashes.add(shortId(appointmentId));
    if (value?.ok === false || value?.failed === true) evidence.failed = true;
    Object.values(value).forEach(visit);
  }

  roots.forEach(visit);
  return {
    invoked: evidence.invoked,
    statuses: [...evidence.statuses],
    appointmentIdHashes: [...evidence.appointmentIdHashes],
    failed: evidence.failed,
  };
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${String(payload.message || payload.error || "request failed").slice(0, 240)}`);
  }
  return payload;
}

async function chatTurn({ assistantId, input, previousChatId }) {
  const chat = await request("/chat", {
    method: "POST",
    body: {
      assistantId,
      input,
      name: `calendar-api-test-${Date.now()}`.slice(0, 40),
      ...(previousChatId ? { previousChatId } : {}),
    },
  });
  const chatId = String(chat?.id || "").trim();
  const detail = chatId ? await request(`/chat/${encodeURIComponent(chatId)}`) : {};
  return {
    id: chatId,
    answer: sanitizeText(outputText(chat) || outputText(detail)),
    evidence: collectBookingEvidence(chat, detail),
  };
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!targetPhone) throw new Error("--phone must be a valid E.164 phone number.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(requestedStart)) {
    throw new Error("--start must be an ISO 8601 date/time with a UTC offset.");
  }
  if (apply && confirmation !== confirmationPhrase) {
    throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);
  }

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  if (!phone) throw new Error(`Vapi phone ending ${targetPhone.slice(-4)} was not found.`);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!assistantId) throw new Error("The target phone has no assigned assistant.");

  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds.map(String) : [];
  const tools = await Promise.all(toolIds.map((id) => request(`/tool/${encodeURIComponent(id)}`)));
  const appointmentTool = tools.find((tool) => String(tool?.function?.name || tool?.name || "").toLowerCase() === toolName);
  if (!appointmentTool) throw new Error("The live assistant does not have request_appointment attached.");

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const calls = listFrom(await request(`/call?limit=100&createdAtGt=${encodeURIComponent(since)}`), ["calls"]);
  const matchingCallSummaries = calls
    .filter((call) => String(call?.phoneNumberId || call?.phoneNumber?.id || "").trim() === String(phone.id || "").trim())
    .sort((left, right) => new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0));
  let caller = "";
  for (const summary of matchingCallSummaries) {
    const callId = String(summary?.id || "").trim();
    const detail = callId ? await request(`/call/${encodeURIComponent(callId)}`) : summary;
    const candidate = customerNumber(detail);
    if (candidate && (!expectedCustomerLast4 || candidate.endsWith(expectedCustomerLast4))) {
      caller = candidate;
      break;
    }
  }
  if (!caller) throw new Error(`No recent caller ending ${expectedCustomerLast4 || "(any)"} was found for the target assistant.`);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    phoneEnding: targetPhone.slice(-4),
    callerEnding: caller.slice(-4),
    assistantIdHash: shortId(assistantId),
    appointmentToolIdHash: shortId(appointmentTool.id),
    requestedStart,
    durationMinutes,
    plannedChatTurns: 2,
    realEffects: apply ? ["appointment request", "owner/customer notifications", "Google Calendar event if automatically confirmed"] : [],
  }, null, 2));
  if (!apply) return;

  const firstInput = `I consent to the recording and to continuing. I want to book a calendar integration test appointment for ${requestedStart}, lasting ${durationMinutes} minutes. My name is API Calendar Test. My callback number is ${caller}. The service is a My AI PA calendar integration test. Please read the booking details back before you submit it.`;
  const first = await chatTurn({ assistantId, input: firstInput });
  console.log(JSON.stringify({
    turn: 1,
    chatIdHash: shortId(first.id),
    assistantAnswer: first.answer,
    evidence: first.evidence,
  }, null, 2));

  let final = first;
  if (!first.evidence.invoked) {
    if (!first.id) throw new Error("The first Vapi chat turn returned no chat ID.");
    const secondInput = `Yes. I explicitly confirm the appointment for ${requestedStart}, lasting ${durationMinutes} minutes, for the My AI PA calendar integration test. Please book it now using the callback number and name I already provided.`;
    final = await chatTurn({ assistantId, input: secondInput, previousChatId: first.id });
    console.log(JSON.stringify({
      turn: 2,
      chatIdHash: shortId(final.id),
      assistantAnswer: final.answer,
      evidence: final.evidence,
    }, null, 2));
  }

  const statuses = final.evidence.statuses;
  if (!final.evidence.invoked) throw new Error("The controlled chat never invoked request_appointment.");
  if (final.evidence.failed) throw new Error("The appointment tool reported a failure.");
  if (!statuses.includes("CONFIRMED") && !statuses.includes("PENDING")) {
    throw new Error("The appointment tool was invoked, but no authoritative booking status was returned.");
  }

  console.log(JSON.stringify({
    completed: true,
    toolInvoked: true,
    status: statuses.includes("CONFIRMED") ? "CONFIRMED" : "PENDING",
    appointmentIdHashes: final.evidence.appointmentIdHashes,
    googleCalendarEventExpected: statuses.includes("CONFIRMED"),
  }, null, 2));
}

main().catch((error) => {
  console.error(`Vapi calendar chat test failed: ${error.message || error}`);
  process.exitCode = 1;
});
