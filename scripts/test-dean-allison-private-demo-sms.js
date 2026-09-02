const { loadProjectEnv } = require("./_helpers");
const { executeCompositeNotifications, normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const twilioToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
const targetPhone = "+12892057487";
const recipientPhone = normalizeE164(env.DEAN_ALLISON_DEMO_OWNER_PHONE || "+19057885488");
const send = process.argv.includes("--send");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "SEND-DEAN-DEMO-SMS-TEST";

function list(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function safeJson(text) {
  try { return text ? JSON.parse(text) : {}; } catch (_error) { return {}; }
}

async function vapiRequest(resource, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${resource}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = safeJson(await response.text());
  if (!response.ok) throw new Error(`${method} ${resource} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

function toolName(record) {
  return String(record?.function?.name || record?.name || "").trim();
}

function environmentMap(tool) {
  return Object.fromEntries((tool?.environmentVariables || []).map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function approvalAudit(tool) {
  const rules = tool?.rejectionPlan?.conditions?.[0]?.conditions || [];
  const approvalPattern = String(rules[0]?.regex || "").replace(/^\(\?i\)/, "");
  const cancellationPattern = String(rules[1]?.regex || "").replace(/^\(\?i\)/, "");
  if (!approvalPattern || !cancellationPattern) return { healthy: false, acceptsYesPlease: false, rejectsCancellation: false };
  const approval = new RegExp(approvalPattern, "i");
  const cancellation = new RegExp(cancellationPattern, "i");
  const wouldReject = (phrase) => !approval.test(phrase) || cancellation.test(phrase);
  const acceptsYesPlease = !wouldReject("Yes, please.");
  const rejectsCancellation = wouldReject("Yes, don't send it.");
  return { healthy: acceptsYesPlease && rejectsCancellation, acceptsYesPlease, rejectsCancellation };
}

function basicAuth(accountSid, token) {
  return `Basic ${Buffer.from(`${accountSid}:${token}`, "utf8").toString("base64")}`;
}

async function twilioMessage(accountSid, messageSid) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`, {
    headers: { Authorization: basicAuth(accountSid, twilioToken), Accept: "application/json" },
  });
  const payload = safeJson(await response.text());
  if (!response.ok) throw new Error(`Twilio message verification failed with HTTP ${response.status}.`);
  return payload;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!recipientPhone) throw new Error("DEAN_ALLISON_DEMO_OWNER_PHONE is not a valid phone number.");
  if (send && confirmation !== confirmationPhrase) throw new Error(`Live SMS mode requires --confirm=${confirmationPhrase}.`);

  const [phonesPayload, toolsPayload] = await Promise.all([
    vapiRequest("/phone-number?limit=1000"),
    vapiRequest("/tool?limit=1000"),
  ]);
  const phone = list(phonesPayload, ["phoneNumbers", "phone_numbers"])
    .find((item) => normalizeE164(item?.number || item?.phoneNumber || item?.providerResourceId) === targetPhone);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!assistantId) throw new Error("The Dean Allison private-demo assistant is not attached to the expected number.");
  const assistant = await vapiRequest(`/assistant/${encodeURIComponent(assistantId)}`);
  const attachedIds = new Set((assistant?.model?.toolIds || []).map(String));
  const toolSummary = list(toolsPayload, ["tools"]).find((item) => attachedIds.has(String(item?.id || "")) && /^send_call_summaries_/i.test(toolName(item)));
  if (!toolSummary?.id) throw new Error("The protected SMS summary tool is not attached to the assistant.");
  const tool = await vapiRequest(`/tool/${encodeURIComponent(toolSummary.id)}`);
  const audit = approvalAudit(tool);
  if (!audit.healthy) throw new Error("The live SMS confirmation gate did not pass its safety audit.");

  if (!send) {
    console.log(JSON.stringify({ mode: "configuration-only", phoneLast4: targetPhone.slice(-4), approvalGate: audit, providerMessagesSent: 0 }, null, 2));
    return;
  }
  if (!twilioToken) throw new Error("TWILIO_AUTH_TOKEN is not configured for provider verification.");
  const toolEnv = environmentMap(tool);
  const accountSid = String(toolEnv.TWILIO_ACCOUNT_SID || "").trim();
  if (!accountSid) throw new Error("The attached tool does not contain a Twilio account reference.");

  const notificationResult = await executeCompositeNotifications({
    args: {
      businessName: "My AI PA private demonstration",
      requestType: "constituent_demo",
      name: "My AI PA Test Caller",
      jobDetails: "passport application delay",
      city: "Grimsby, Ontario",
      preferredStartDate: "correct public contact for official help",
      bestCallbackTime: "weekday afternoons",
      message: "Controlled SMS test for a federal passport application concern.",
    },
    env: {
      ...toolEnv,
      CALLER_NUMBER: recipientPhone,
      CALL_ID: `dean-private-sms-test-${Date.now()}`,
    },
    fetchImpl: fetch,
    btoaImpl: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    URLSearchParamsImpl: URLSearchParams,
  });
  const messageIds = [notificationResult.owner?.messageId, notificationResult.customer?.messageId].filter(Boolean);
  const messages = await Promise.all(messageIds.map((messageSid) => twilioMessage(accountSid, messageSid)));
  const statuses = messages.map((message) => String(message.status || "unknown"));
  const acceptedCount = statuses.filter((status) => !["failed", "undelivered", "canceled"].includes(status)).length;
  const routesMatch = messages.every((message) => normalizeE164(message.from) === targetPhone && normalizeE164(message.to) === recipientPhone);
  const verified = notificationResult.complete === true && messageIds.length === 2 && acceptedCount === 2 && routesMatch;
  console.log(JSON.stringify({
    mode: "live-controlled-sms",
    phoneLast4: targetPhone.slice(-4),
    recipientLast4: recipientPhone.slice(-4),
    approvalGate: audit,
    protectedToolCompleted: notificationResult.complete === true,
    ownerAccepted: notificationResult.owner?.sent === true,
    customerAccepted: notificationResult.customer?.sent === true,
    providerMessageCount: messages.length,
    providerAcceptedCount: acceptedCount,
    providerStatuses: statuses,
    providerRoutesMatch: routesMatch,
    verified,
  }, null, 2));
  if (!verified) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
