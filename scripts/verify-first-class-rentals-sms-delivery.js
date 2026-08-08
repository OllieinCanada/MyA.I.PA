const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { executeCompositeNotifications, normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const vapiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const vapiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12493154508";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const verifyRecent = args.includes("--verify-recent");
const confirmation = args.find((item) => item.startsWith("--confirm="))?.slice(10) || "";
const expectedCustomerLast4 = (args.find((item) => item.startsWith("--customer-last4="))?.slice(17) || "").replace(/\D/g, "").slice(-4);
const expectedOwnerLast4 = (args.find((item) => item.startsWith("--owner-last4="))?.slice(14) || "").replace(/\D/g, "").slice(-4);
const confirmationPhrase = "SEND_FIRST_CLASS_ROUTING_TEST";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function envMap(tool) {
  return Object.fromEntries((tool?.environmentVariables || []).map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

async function vapiRequest(pathname) {
  const response = await fetch(`${vapiBase}${pathname}`, { headers: { Authorization: `Bearer ${vapiKey}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Vapi ${pathname} failed with HTTP ${response.status}.`);
  return payload;
}

async function twilioStatus(accountSid, authToken, messageId) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageId)}.json`,
    { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, Accept: "application/json" } }
  );
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: String(payload?.status || "unknown"),
    errorCode: payload?.error_code == null ? "" : String(payload.error_code),
    messageIdHash: hash(messageId),
  };
}

async function recentTwilioStatuses(accountSid, authToken, senderNumber, expectedLast4s) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json?PageSize=50`,
    { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, Accept: "application/json" } }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio message history failed with HTTP ${response.status}.`);
  const wanted = new Set(expectedLast4s);
  const found = {};
  for (const message of Array.isArray(payload?.messages) ? payload.messages : []) {
    const from = normalizeE164(message?.from);
    const to = normalizeE164(message?.to);
    const last4 = to.slice(-4);
    if (from !== senderNumber || !wanted.has(last4) || found[last4]) continue;
    if (!/^MY AI PA TEST\b/i.test(String(message?.body || ""))) continue;
    found[last4] = {
      status: String(message?.status || "unknown"),
      errorCode: message?.error_code == null ? "" : String(message.error_code),
      messageIdHash: hash(message?.sid),
      dateSent: String(message?.date_sent || ""),
    };
  }
  return found;
}

async function main() {
  if (!vapiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!expectedCustomerLast4 || !expectedOwnerLast4) throw new Error("Provide --customer-last4 and --owner-last4 to protect both destinations.");

  const phones = listFrom(await vapiRequest("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber) === targetPhone);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "");
  if (!assistantId) throw new Error("The 4508 assistant was not found.");
  const assistant = await vapiRequest(`/assistant/${encodeURIComponent(assistantId)}`);
  const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  const tools = await Promise.all(toolIds.map((id) => vapiRequest(`/tool/${encodeURIComponent(id)}`)));
  const tool = tools.find((item) => /^send_call_summaries_4508_/i.test(String(item?.function?.name || item?.name || "")));
  if (!tool) throw new Error("The isolated 4508 summary tool was not found.");
  const toolEnv = envMap(tool);

  const callsPayload = await vapiRequest(`/call?limit=50&createdAtGt=${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}`);
  const calls = listFrom(callsPayload, ["calls"])
    .filter((call) => String(call?.phoneNumberId || call?.phoneNumber?.id || "") === String(phone?.id || ""))
    .sort((left, right) => new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0));
  const customerNumber = normalizeE164(calls[0]?.customer?.number || calls[0]?.customer?.phoneNumber || calls[0]?.from || calls[0]?.fromNumber);
  const ownerNumber = normalizeE164(toolEnv.DEFAULT_OWNER_TO_NUMBER);
  const senderNumber = normalizeE164(toolEnv.DEFAULT_FROM_NUMBER);
  const protectedRouting = customerNumber.endsWith(expectedCustomerLast4)
    && ownerNumber.endsWith(expectedOwnerLast4)
    && senderNumber === targetPhone;
  const report = {
    mode: apply ? "apply" : "dry-run",
    senderLast4: senderNumber.slice(-4),
    customerLast4: customerNumber.slice(-4),
    ownerLast4: ownerNumber.slice(-4),
    protectedRouting,
    ownerSmsEnabled: String(toolEnv.OWNER_SMS_ENABLED || "true").toLowerCase() !== "false",
    suppressionCheckConfigured: /^https:\/\//i.test(toolEnv.SMS_SUPPRESSION_CHECK_URL || "") && Boolean(toolEnv.SMS_SUPPRESSION_API_KEY),
    secretPrinted: false,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!protectedRouting) throw new Error("Protected routing verification failed; no message was sent.");
  if (verifyRecent) {
    const recent = await recentTwilioStatuses(
      toolEnv.TWILIO_ACCOUNT_SID,
      toolEnv.TWILIO_AUTH_TOKEN,
      senderNumber,
      [expectedOwnerLast4, expectedCustomerLast4]
    );
    console.log(JSON.stringify({ recent, secretPrinted: false }, null, 2));
    if (!recent[expectedOwnerLast4] || !recent[expectedCustomerLast4]) process.exitCode = 2;
    return;
  }
  if (!apply) return;
  if (confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const result = await executeCompositeNotifications({
    args: { businessName: "First Class Rentals Niagara", requestType: "routing_test", name: "My AI PA routing verification" },
    env: { ...toolEnv, CALLER_NUMBER: customerNumber, CALL_ID: `fcr-routing-test-${Date.now()}` },
    fetchImpl: fetch,
    btoaImpl: (value) => Buffer.from(value).toString("base64"),
    URLSearchParamsImpl: URLSearchParams,
  });
  const delivery = {};
  for (const role of ["owner", "customer"]) {
    const messageId = String(result?.[role]?.messageId || "");
    delivery[role] = messageId
      ? await twilioStatus(toolEnv.TWILIO_ACCOUNT_SID, toolEnv.TWILIO_AUTH_TOKEN, messageId)
      : { ok: false, status: String(result?.[role]?.status || "not_sent"), errorCode: String(result?.[role]?.errorCode || ""), messageIdHash: "" };
  }
  console.log(JSON.stringify({
    complete: result.complete === true,
    executionOrder: result.executionOrder || [],
    owner: delivery.owner,
    customer: delivery.customer,
    secretPrinted: false,
  }, null, 2));
  if (!result.complete || !delivery.owner.ok || !delivery.customer.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
