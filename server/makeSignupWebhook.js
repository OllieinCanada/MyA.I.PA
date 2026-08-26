const crypto = require("crypto");

const DEFAULT_MAKE_SIGNUP_TIMEOUT_MS = 185_000;

function normalizeHostList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isStandardMakeWebhookHost(hostname) {
  return /^hook(?:\.[a-z0-9-]+)*\.make\.com$/i.test(String(hostname || ""));
}

function validateMakeWebhookUrl(value, additionalAllowedHosts = "") {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("MAKE_SIGNUP_WEBHOOK_URL must be a valid HTTPS Make webhook URL.");
  }

  const allowedHosts = new Set(normalizeHostList(additionalAllowedHosts));
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (!isStandardMakeWebhookHost(hostname) && !allowedHosts.has(hostname))) {
    throw new Error("MAKE_SIGNUP_WEBHOOK_URL must use HTTPS and an approved Make webhook host.");
  }
  if (!url.pathname || url.pathname === "/") {
    throw new Error("MAKE_SIGNUP_WEBHOOK_URL is missing its webhook path.");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => key !== "submittedAt")
      .map((key) => [key, stableObject(value[key])])
  );
}

function buildMakeSignupEventKey(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const stableProviderId = String(
    body?.stripe?.checkoutSessionId
      || body?.source?.stripeCheckoutSessionId
      || body?.signupId
      || body?.submissionId
      || ""
  ).trim();
  const source = stableProviderId || JSON.stringify(stableObject(body));
  return `signup_${crypto.createHash("sha256").update(source).digest("hex").slice(0, 32)}`;
}

function buildMakeSignupHeaders({ apiKey = "", eventKey = "" } = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-myaipa-event-key": String(eventKey || "").trim(),
  };
  if (String(apiKey || "").trim()) headers["x-make-apikey"] = String(apiKey).trim();
  return headers;
}

function getMakeRequestId(response) {
  const headers = response?.headers;
  if (!headers || typeof headers.get !== "function") return "";
  return String(
    headers.get("x-make-request-id")
      || headers.get("x-request-id")
      || headers.get("cf-ray")
      || ""
  ).trim().slice(0, 160);
}

function firstString(data, paths) {
  for (const path of paths) {
    const value = path.reduce((current, key) => current?.[key], data);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function classifyMakeSignupResponse(rawText, parsedData) {
  const text = String(rawText || "").trim();
  const data = parsedData && typeof parsedData === "object" && !Array.isArray(parsedData)
    ? parsedData
    : {};
  const explicitFailure = data.success === false || data.ok === false;
  if (explicitFailure) {
    return {
      complete: false,
      kind: "rejected",
      code: "MAKE_SIGNUP_REJECTED",
    };
  }

  if (!text || !Object.keys(data).length) {
    return {
      complete: false,
      kind: text ? "unrecognized" : "empty",
      code: "MAKE_SIGNUP_RESPONSE_INCOMPLETE",
    };
  }

  const acknowledged = data.success === true || data.ok === true;
  const twilioPhoneNumber = firstString(data, [
    ["twilioPhoneNumber"],
    ["twilio_phone_number"],
    ["phoneNumber"],
    ["data", "twilioPhoneNumber"],
    ["data", "phoneNumber"],
  ]);
  const vapiPhoneNumberId = firstString(data, [
    ["vapiPhoneNumberId"],
    ["phoneNumberId"],
    ["data", "vapiPhoneNumberId"],
    ["data", "phoneNumberId"],
  ]);
  const vapiAssistantId = firstString(data, [
    ["vapiAssistantId"],
    ["assistantId"],
    ["data", "vapiAssistantId"],
    ["data", "assistantId"],
  ]);
  const complete = Boolean(
    acknowledged
      && twilioPhoneNumber
      && vapiPhoneNumberId
      && vapiAssistantId
  );

  return {
    complete,
    kind: complete ? "completed" : acknowledged ? "acknowledged_incomplete" : "unrecognized",
    code: complete ? "" : "MAKE_SIGNUP_RESPONSE_INCOMPLETE",
    twilioPhoneNumber,
    vapiPhoneNumberId,
    vapiAssistantId,
  };
}

function parseMakeSignupTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 190_000) {
    return DEFAULT_MAKE_SIGNUP_TIMEOUT_MS;
  }
  return Math.round(parsed);
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return controller.signal;
}

module.exports = {
  DEFAULT_MAKE_SIGNUP_TIMEOUT_MS,
  buildMakeSignupEventKey,
  buildMakeSignupHeaders,
  classifyMakeSignupResponse,
  createTimeoutSignal,
  getMakeRequestId,
  isStandardMakeWebhookHost,
  parseMakeSignupTimeoutMs,
  validateMakeWebhookUrl,
};
