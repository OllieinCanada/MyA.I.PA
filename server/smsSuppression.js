const crypto = require("crypto");
const { prisma } = require("./prisma");

const OPT_OUT_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const OPT_IN_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);

function httpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeSmsPhone(value, field = "phoneNumber") {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = raw.startsWith("+")
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw httpError(`${field} must be a valid E.164 phone number.`, 400, "SMS_PHONE_INVALID");
  }
  return normalized;
}

function classifySmsPreference(body) {
  const keyword = String(body || "")
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z]+|[^A-Z]+$/g, "")
    .replace(/\s+/g, "");
  if (OPT_OUT_KEYWORDS.has(keyword)) return { action: "SUPPRESS", keyword };
  if (OPT_IN_KEYWORDS.has(keyword)) return { action: "RESUME", keyword };
  if (keyword === "HELP" || keyword === "INFO") return { action: "HELP", keyword };
  return { action: "NONE", keyword: "" };
}

function getTwilioWebhookUrl(req, env = process.env) {
  const configured = String(env.TWILIO_INBOUND_WEBHOOK_URL || "").trim();
  if (configured) return configured;
  const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${protocol}://${host}${req.originalUrl || req.url || ""}` : "";
}

function getTwilioSignature(url, params, authToken) {
  const suffix = Object.keys(params || {})
    .sort()
    .map((key) => {
      const value = params[key];
      if (Array.isArray(value)) return value.map((item) => `${key}${String(item ?? "")}`).join("");
      return `${key}${String(value ?? "")}`;
    })
    .join("");
  return crypto.createHmac("sha1", String(authToken || "")).update(`${url}${suffix}`).digest("base64");
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function verifyTwilioWebhookRequest(req, env = process.env) {
  const authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
  const supplied = String(req.headers["x-twilio-signature"] || "").trim();
  const url = getTwilioWebhookUrl(req, env);
  if (!authToken || !supplied || !url) return false;
  return safeEqual(supplied, getTwilioSignature(url, req.body || {}, authToken));
}

function normalizeSmsUpstreamUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw httpError("The inbound SMS upstream URL is invalid.", 400, "SMS_UPSTREAM_INVALID");
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "api.vapi.ai"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
  ) {
    throw httpError("The inbound SMS upstream URL is not allowed.", 400, "SMS_UPSTREAM_NOT_ALLOWED");
  }
  return url.toString();
}

async function getSmsInboundRoute(phoneNumber, { prismaClient = prisma } = {}) {
  const normalized = normalizeSmsPhone(phoneNumber, "To");
  return prismaClient.smsInboundRoute.findUnique({ where: { phoneNumber: normalized } });
}

function appendFormValue(form, key, value) {
  if (Array.isArray(value)) {
    for (const item of value) form.append(key, String(item ?? ""));
    return;
  }
  form.append(key, String(value ?? ""));
}

async function forwardSmsToUpstream({
  phoneNumber,
  params,
  authToken,
  prismaClient = prisma,
  fetchImpl = global.fetch,
}) {
  const route = await getSmsInboundRoute(phoneNumber, { prismaClient });
  if (!route) {
    throw httpError("Inbound SMS routing is temporarily unavailable.", 503, "SMS_UPSTREAM_ROUTE_MISSING");
  }
  const upstreamUrl = normalizeSmsUpstreamUrl(route.upstreamUrl);
  if (String(route.upstreamMethod || "POST").toUpperCase() !== "POST") {
    throw httpError("Inbound SMS routing is temporarily unavailable.", 503, "SMS_UPSTREAM_METHOD_INVALID");
  }
  if (!String(authToken || "").trim() || typeof fetchImpl !== "function") {
    throw httpError("Inbound SMS routing is temporarily unavailable.", 503, "SMS_UPSTREAM_AUTH_UNAVAILABLE");
  }
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) appendFormValue(form, key, value);
  let response;
  try {
    response = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Twilio-Signature": getTwilioSignature(upstreamUrl, params || {}, authToken),
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw httpError("Inbound SMS routing is temporarily unavailable.", 502, "SMS_UPSTREAM_UNAVAILABLE");
  }
  const body = (await response.text()).slice(0, 1024 * 1024);
  if (!response.ok) {
    throw httpError("Inbound SMS routing is temporarily unavailable.", 502, "SMS_UPSTREAM_REJECTED");
  }
  return {
    status: response.status,
    contentType: String(response.headers.get("content-type") || "application/xml"),
    body,
    upstreamHost: new URL(upstreamUrl).hostname,
  };
}

async function getSmsSuppression(phoneNumber, { prismaClient = prisma } = {}) {
  const normalized = normalizeSmsPhone(phoneNumber);
  return prismaClient.smsSuppression.findUnique({ where: { phoneNumber: normalized } });
}

async function isSmsSuppressed(phoneNumber, options = {}) {
  const record = await getSmsSuppression(phoneNumber, options);
  return Boolean(record?.suppressed);
}

async function recordSmsPreference({
  phoneNumber,
  keyword,
  source = "TWILIO_INBOUND",
  messageSid = "",
  prismaClient = prisma,
  now = new Date(),
}) {
  const normalized = normalizeSmsPhone(phoneNumber, "From");
  const preference = classifySmsPreference(keyword);
  if (!["SUPPRESS", "RESUME"].includes(preference.action)) {
    return { changed: false, action: preference.action, keyword: preference.keyword, phoneNumber: normalized };
  }
  const suppressed = preference.action === "SUPPRESS";
  const record = await prismaClient.smsSuppression.upsert({
    where: { phoneNumber: normalized },
    create: {
      phoneNumber: normalized,
      suppressed,
      keyword: preference.keyword,
      source: String(source || "TWILIO_INBOUND").slice(0, 80),
      lastMessageSid: String(messageSid || "").slice(0, 80) || null,
      lastInboundAt: now,
      suppressedAt: suppressed ? now : null,
      resumedAt: suppressed ? null : now,
    },
    update: {
      suppressed,
      keyword: preference.keyword,
      source: String(source || "TWILIO_INBOUND").slice(0, 80),
      lastMessageSid: String(messageSid || "").slice(0, 80) || null,
      lastInboundAt: now,
      ...(suppressed
        ? { suppressedAt: now, resumedAt: null }
        : { resumedAt: now }),
    },
  });
  return {
    changed: true,
    action: preference.action,
    keyword: preference.keyword,
    phoneNumber: normalized,
    suppressed: Boolean(record.suppressed),
    updatedAt: record.updatedAt,
  };
}

function getSuppressionApiKey(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return String(req.headers["x-myaipa-sms-suppression-key"] || bearer).trim();
}

function hasValidSuppressionApiKey(req, env = process.env) {
  const expected = String(env.SMS_SUPPRESSION_API_KEY || "").trim();
  return safeEqual(getSuppressionApiKey(req), expected);
}

module.exports = {
  OPT_IN_KEYWORDS,
  OPT_OUT_KEYWORDS,
  classifySmsPreference,
  getSmsSuppression,
  getSmsInboundRoute,
  getTwilioSignature,
  getTwilioWebhookUrl,
  forwardSmsToUpstream,
  hasValidSuppressionApiKey,
  isSmsSuppressed,
  normalizeSmsPhone,
  normalizeSmsUpstreamUrl,
  recordSmsPreference,
  verifyTwilioWebhookRequest,
};
