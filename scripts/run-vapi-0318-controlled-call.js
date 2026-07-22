const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");
const { isManagedIsolatedTool } = require("../server/vapiIsolatedSmsProvisioning");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const apply = process.argv.slice(2).includes("--apply");
const targetAiNumber = "+12498000318";

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : fallback;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
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
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

function transcriptFrom(call) {
  if (String(call?.transcript || "").trim()) return String(call.transcript).trim();
  const messages = call?.artifact?.messages || call?.messages || [];
  return Array.isArray(messages)
    ? messages.filter((message) => ["assistant", "bot", "user", "customer"].includes(String(message?.role || "").toLowerCase()))
      .map((message) => `${message.role}: ${message.message || message.content || message.text || ""}`).join("\n")
    : "";
}

function hasEnded(call) {
  return Boolean(call?.endedReason || call?.endedAt || ["ended", "completed", "failed"].includes(String(call?.status || "").toLowerCase()));
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetAiNumber);
  if (!phone) throw new Error("0318 was not found in Vapi.");
  const assistantId = String(phone.assistantId || phone?.assistant?.id || "").trim();
  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  const tools = await Promise.all(toolIds.map((id) => request(`/tool/${encodeURIComponent(id)}`)));
  const isolatedTool = tools.find(isManagedIsolatedTool);
  if (!isolatedTool) throw new Error("0318 has no managed isolated SMS tool.");
  const protectedOwner = normalizeE164(environmentMap(isolatedTool).DEFAULT_OWNER_TO_NUMBER);
  const toNumber = normalizeE164(argument("to", protectedOwner));
  if (!toNumber) throw new Error("A valid controlled-call destination is required.");
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", aiLast4: targetAiNumber.slice(-4), destinationLast4: toNumber.slice(-4), assistantIdHash: shortHash(assistantId), assistantName: assistant.name || "", phoneNumberIdHash: shortHash(phone.id), note: "Rerun with --apply to place one outbound call." }, null, 2));
    return;
  }

  const created = await request("/call", {
    method: "POST",
    body: { assistantId, phoneNumberId: phone.id, customer: { number: toNumber } },
  });
  const callId = String(created.id || created.callId || "").trim();
  if (!callId) throw new Error("Vapi accepted the request without returning a call ID.");
  console.log(JSON.stringify({ event: "controlled_call_started", callIdHash: shortHash(callId), aiLast4: targetAiNumber.slice(-4), destinationLast4: toNumber.slice(-4) }));

  const deadline = Date.now() + 10 * 60 * 1000;
  let call = created;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    call = await request(`/call/${encodeURIComponent(callId)}`);
    if (hasEnded(call)) break;
  }
  if (!hasEnded(call)) throw new Error("The controlled call did not finish within ten minutes.");
  const transcript = transcriptFrom(call);
  const lower = transcript.toLowerCase();
  console.log(JSON.stringify({
    event: "controlled_call_finished",
    callIdHash: shortHash(callId),
    endedReason: call.endedReason || call.status || "",
    startedAt: call.startedAt || call.createdAt || "",
    endedAt: call.endedAt || "",
    checks: {
      noLegacyToolFiller: !/(this will just take a sec|this'll just take a sec|one moment|hold on)/i.test(transcript),
      noUnsupportedAffirmation: !/(is a licensed contractor|is insured|committed to equal opportunity)/i.test(transcript),
      noHardCallbackPromise: !/(we'll call you (at|after|within)|we'll have someone (call|reach out) (at|after|within|right away))/i.test(lower),
      safeUnknownClaimResponse: /i don't have that confirmed/i.test(lower),
      callbackClarified: /as soon as possible.*after 3.*fallback/i.test(lower),
      safeClosing: /the team will review your request and call you back\. goodbye\./i.test(lower),
    },
    transcript,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
