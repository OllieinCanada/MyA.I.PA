const crypto = require("crypto");

const LEGACY_NOTIFICATION_TOOLS = new Set([
  "send_owner_sms_dynamic",
  "record_lead_and_notify_owner",
  "create_lead_handoff",
]);

function clean(value, maxLength = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isVapiNotificationTool(name) {
  const normalized = clean(name, 180).toLowerCase();
  return LEGACY_NOTIFICATION_TOOLS.has(normalized)
    || /^send_call_summaries_(?:pilot_)?\d{4}(?:_[a-f0-9]{8})?_v\d+$/i.test(normalized);
}

function buildTrustedVapiLeadInput(parameters = {}, businessId) {
  const resolvedBusinessId = Number(businessId);
  if (!Number.isInteger(resolvedBusinessId) || resolvedBusinessId <= 0) {
    const error = new Error("A server-routed business is required for Vapi lead capture.");
    error.statusCode = 422;
    error.code = "VAPI_BUSINESS_ROUTE_REQUIRED";
    throw error;
  }
  const address = [parameters.streetAddress, parameters.city]
    .map((value) => clean(value, 240))
    .filter(Boolean)
    .join(", ");
  const summary = [
    clean(parameters.jobDetails, 800),
    address && `Address: ${address}`,
    parameters.bestCallbackTime && `Best callback time: ${clean(parameters.bestCallbackTime, 180)}`,
  ].filter(Boolean).join(". ") || "New service request";
  return {
    businessId: resolvedBusinessId,
    name: clean(parameters.name, 120) || "Unknown caller",
    callerPhone: parameters.rawPhoneNumber || parameters.callbackNumber,
    callbackNumber: parameters.rawPhoneNumber || parameters.callbackNumber,
    summary,
    intent: clean(parameters.intent, 40) || "QUOTE",
    urgency: clean(parameters.urgency, 40) || "MEDIUM",
  };
}

function getVapiToolExecutionIdentity({ toolCall, businessId, call }) {
  const toolCallId = clean(toolCall?.id);
  if (!toolCallId) {
    const error = new Error("Vapi toolCall.id is required for idempotent execution.");
    error.statusCode = 400;
    error.code = "VAPI_TOOL_IDEMPOTENCY_KEY_REQUIRED";
    throw error;
  }
  const resolvedBusinessId = Number(businessId);
  if (!Number.isInteger(resolvedBusinessId) || resolvedBusinessId <= 0) {
    const error = new Error("A server-routed business is required for Vapi tool execution.");
    error.statusCode = 422;
    error.code = "VAPI_BUSINESS_ROUTE_REQUIRED";
    throw error;
  }
  const toolName = clean(toolCall?.name, 180).toLowerCase();
  const callExternalId = clean(call?.id || call?.callId || call?.externalId, 180) || null;
  return {
    idempotencyKey: crypto
      .createHash("sha256")
      .update(`vapi:${resolvedBusinessId}:${toolCallId}`)
      .digest("hex"),
    toolCallId,
    toolName,
    businessId: resolvedBusinessId,
    callExternalId,
  };
}

async function claimVapiToolExecution({ prisma, toolCall, businessId, call }) {
  const identity = getVapiToolExecutionIdentity({ toolCall, businessId, call });
  try {
    const execution = await prisma.vapiToolExecution.create({
      data: { ...identity, status: "PROCESSING" },
    });
    return { claimed: true, execution, identity };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const execution = await prisma.vapiToolExecution.findUnique({
      where: { idempotencyKey: identity.idempotencyKey },
    });
    if (!execution) throw error;
    return { claimed: false, execution, identity };
  }
}

async function completeVapiToolExecution({ prisma, id, result }) {
  return prisma.vapiToolExecution.update({
    where: { id },
    data: {
      status: "COMPLETED",
      result: result && typeof result === "object" ? result : { ok: true },
      errorCode: null,
      completedAt: new Date(),
    },
  });
}

async function failVapiToolExecution({ prisma, id, error }) {
  return prisma.vapiToolExecution.update({
    where: { id },
    data: {
      status: "FAILED",
      errorCode: clean(error?.code || "VAPI_TOOL_EXECUTION_FAILED", 120),
      completedAt: new Date(),
    },
  });
}

module.exports = {
  buildTrustedVapiLeadInput,
  claimVapiToolExecution,
  completeVapiToolExecution,
  failVapiToolExecution,
  getVapiToolExecutionIdentity,
  isVapiNotificationTool,
};
