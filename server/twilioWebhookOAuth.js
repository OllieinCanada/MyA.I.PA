const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const DEFAULT_SCOPE = "twilio:webhooks";
const DEFAULT_TOKEN_TTL_SECONDS = 300;
const CALL_STATUS_VALUES = new Set([
  "queued",
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
]);

function httpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function normalizeHttpsUrl(value, label, { optional = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw && optional) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw httpError(`${label} is invalid.`, 503, "TWILIO_WEBHOOK_OAUTH_CONFIG_INVALID");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw httpError(`${label} must be a public HTTPS URL without embedded credentials or a fragment.`, 503, "TWILIO_WEBHOOK_OAUTH_CONFIG_INVALID");
  }
  return parsed.toString().replace(/\/$/, "");
}

function getTwilioWebhookOAuthConfig(env = process.env) {
  const stagingEnabled = enabled(env.TWILIO_WEBHOOK_STAGING_ENABLED);
  const oauthEnabled = enabled(env.TWILIO_WEBHOOK_OAUTH_ENABLED);
  const baseUrl = normalizeHttpsUrl(env.TWILIO_WEBHOOK_STAGING_BASE_URL, "TWILIO_WEBHOOK_STAGING_BASE_URL", { optional: true });
  const callbackUrl = baseUrl ? `${baseUrl}/api/webhooks/twilio/staging/call-status` : "";
  const connectivityUrl = baseUrl ? `${baseUrl}/api/webhooks/twilio/staging/connectivity` : "";
  const tokenUrl = baseUrl ? `${baseUrl}/api/integrations/twilio/webhook-oauth/token` : "";
  const downstreamUrl = normalizeHttpsUrl(env.TWILIO_WEBHOOK_STAGING_DOWNSTREAM_URL, "TWILIO_WEBHOOK_STAGING_DOWNSTREAM_URL", { optional: true });
  const clientId = String(env.TWILIO_WEBHOOK_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(env.TWILIO_WEBHOOK_OAUTH_CLIENT_SECRET || "").trim();
  const signingSecret = String(env.TWILIO_WEBHOOK_OAUTH_SIGNING_SECRET || "").trim();
  const audience = String(env.TWILIO_WEBHOOK_OAUTH_AUDIENCE || callbackUrl || "").trim();
  const issuer = String(env.TWILIO_WEBHOOK_OAUTH_ISSUER || "myaipa-api").trim();
  const scope = String(env.TWILIO_WEBHOOK_OAUTH_SCOPE || DEFAULT_SCOPE).trim();
  const tokenTtlSeconds = Math.max(60, Math.min(600, Number(env.TWILIO_WEBHOOK_OAUTH_TOKEN_TTL_SECONDS || DEFAULT_TOKEN_TTL_SECONDS) || DEFAULT_TOKEN_TTL_SECONDS));

  if (stagingEnabled || oauthEnabled) {
    if (!baseUrl || !clientId || clientSecret.length < 24 || signingSecret.length < 32 || !audience || !issuer || !scope) {
      throw httpError("Twilio staging webhook OAuth is enabled but its dedicated credentials or URLs are incomplete.", 503, "TWILIO_WEBHOOK_OAUTH_NOT_CONFIGURED");
    }
  }
  if (stagingEnabled && !downstreamUrl) {
    throw httpError("Twilio staging webhook delivery is enabled without a staging downstream destination.", 503, "TWILIO_WEBHOOK_STAGING_SINK_NOT_CONFIGURED");
  }

  return {
    stagingEnabled,
    oauthEnabled,
    baseUrl,
    callbackUrl,
    connectivityUrl,
    tokenUrl,
    downstreamUrl,
    downstreamApiKey: String(env.TWILIO_WEBHOOK_STAGING_DOWNSTREAM_API_KEY || "").trim(),
    clientId,
    clientSecret,
    signingSecret,
    audience,
    issuer,
    scope,
    tokenTtlSeconds,
  };
}

function parseBasicCredentials(authorization) {
  const match = String(authorization || "").trim().match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function requestedCredentials({ authorization = "", body = {} } = {}) {
  const basic = parseBasicCredentials(authorization);
  return {
    clientId: basic?.clientId || String(body.client_id || "").trim(),
    clientSecret: basic?.clientSecret || String(body.client_secret || "").trim(),
  };
}

function issueTwilioWebhookAccessToken({ authorization = "", body = {}, env = process.env } = {}) {
  const config = getTwilioWebhookOAuthConfig(env);
  if (!config.oauthEnabled || !config.stagingEnabled) {
    throw httpError("Twilio staging webhook OAuth is disabled.", 404, "TWILIO_WEBHOOK_OAUTH_DISABLED");
  }
  if (String(body.grant_type || "") !== "client_credentials") {
    throw httpError("Only the client_credentials grant is supported.", 400, "TWILIO_WEBHOOK_OAUTH_GRANT_INVALID");
  }
  const credentials = requestedCredentials({ authorization, body });
  if (!safeEqual(credentials.clientId, config.clientId) || !safeEqual(credentials.clientSecret, config.clientSecret)) {
    throw httpError("Invalid OAuth client credentials.", 401, "TWILIO_WEBHOOK_OAUTH_CLIENT_INVALID");
  }
  const requestedScope = String(body.scope || config.scope).trim();
  const requestedAudience = String(body.audience || config.audience).trim();
  if (requestedScope !== config.scope || requestedAudience !== config.audience) {
    throw httpError("The requested OAuth scope or audience is not allowed.", 400, "TWILIO_WEBHOOK_OAUTH_REQUEST_INVALID");
  }
  const accessToken = jwt.sign(
    {
      typ: "twilio-webhook-access",
      scope: config.scope,
      client: crypto.createHash("sha256").update(config.clientId).digest("hex").slice(0, 16),
    },
    config.signingSecret,
    {
      algorithm: "HS256",
      audience: config.audience,
      issuer: config.issuer,
      subject: "twilio-webhook-delivery",
      expiresIn: config.tokenTtlSeconds,
      jwtid: crypto.randomBytes(18).toString("base64url"),
      mutatePayload: false,
      header: { typ: "JWT" },
    }
  );
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: config.tokenTtlSeconds,
    scope: config.scope,
  };
}

function verifyTwilioWebhookBearer(authorization, env = process.env) {
  const config = getTwilioWebhookOAuthConfig(env);
  if (!config.oauthEnabled || !config.stagingEnabled) return false;
  const match = String(authorization || "").trim().match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  try {
    const claims = jwt.verify(match[1], config.signingSecret, {
      algorithms: ["HS256"],
      audience: config.audience,
      issuer: config.issuer,
      subject: "twilio-webhook-delivery",
      clockTolerance: 5,
    });
    return claims?.typ === "twilio-webhook-access" && String(claims?.scope || "") === config.scope;
  } catch {
    return false;
  }
}

function normalizeCallStatusEvent(body = {}) {
  const callSid = String(body.CallSid || "").trim();
  const callStatus = String(body.CallStatus || "").trim().toLowerCase();
  const sequenceNumber = String(body.SequenceNumber ?? "").trim();
  if (!/^CA[a-zA-Z0-9]{32}$/.test(callSid)) {
    throw httpError("A valid Twilio CallSid is required.", 400, "TWILIO_CALL_STATUS_SID_INVALID");
  }
  if (!CALL_STATUS_VALUES.has(callStatus)) {
    throw httpError("A recognized Twilio call status is required.", 400, "TWILIO_CALL_STATUS_INVALID");
  }
  if (sequenceNumber && !/^\d{1,10}$/.test(sequenceNumber)) {
    throw httpError("The Twilio sequence number is invalid.", 400, "TWILIO_CALL_STATUS_SEQUENCE_INVALID");
  }
  const eventId = [callSid, callStatus, sequenceNumber || "none"].join(":");
  const idempotencyKey = crypto.createHash("sha256").update(`twilio-staging-call-status:${eventId}`).digest("hex");
  return {
    eventId,
    idempotencyKey,
    eventReference: crypto.createHash("sha256").update(callSid).digest("hex").slice(0, 12),
    payload: {
      eventId: idempotencyKey,
      eventType: "twilio.call-status",
      callSid,
      callStatus,
      sequenceNumber: sequenceNumber || null,
      timestamp: String(body.Timestamp || "").trim().slice(0, 80) || null,
      callbackSource: String(body.CallbackSource || "").trim().slice(0, 80) || null,
    },
  };
}

async function deliverTwilioStagingEvent({ event, env = process.env, fetchImpl = global.fetch } = {}) {
  const config = getTwilioWebhookOAuthConfig(env);
  if (!config.stagingEnabled || !config.downstreamUrl || typeof fetchImpl !== "function") {
    throw httpError("The staging downstream webhook is unavailable.", 503, "TWILIO_WEBHOOK_STAGING_SINK_UNAVAILABLE");
  }
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": event.idempotencyKey,
    "X-MyAIPA-Event-Key": event.idempotencyKey,
  };
  if (config.downstreamApiKey) {
    headers.Authorization = `Bearer ${config.downstreamApiKey}`;
    headers["X-MyAIPA-Integration-Key"] = config.downstreamApiKey;
  }
  let response;
  try {
    response = await fetchImpl(config.downstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(event.payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw httpError("The staging Make/CRM webhook could not be reached.", 502, "TWILIO_WEBHOOK_STAGING_SINK_UNREACHABLE");
  }
  if (!response.ok) {
    throw httpError("The staging Make/CRM webhook rejected the event.", 502, "TWILIO_WEBHOOK_STAGING_SINK_REJECTED");
  }
  return { delivered: true, status: response.status };
}

async function processTwilioStagingCallStatus({
  body,
  claimEvent,
  completeEvent,
  releaseEvent,
  deliverEvent = deliverTwilioStagingEvent,
} = {}) {
  if (![claimEvent, completeEvent, releaseEvent, deliverEvent].every((fn) => typeof fn === "function")) {
    throw new Error("Twilio staging webhook processing dependencies are incomplete.");
  }
  const event = normalizeCallStatusEvent(body);
  const claim = await claimEvent({ provider: "twilio-staging", eventId: event.eventId, eventType: "call-status" });
  if (claim.duplicate) {
    return { received: true, duplicate: true, downstreamCreated: false, eventReference: event.eventReference };
  }
  if (!claim.claimed) {
    throw httpError("The webhook replay claim could not be established.", 503, "TWILIO_WEBHOOK_REPLAY_UNAVAILABLE");
  }
  try {
    await deliverEvent({ event });
    const completed = await completeEvent(claim);
    if (!completed) throw httpError("The webhook replay claim could not be completed.", 503, "TWILIO_WEBHOOK_REPLAY_COMPLETE_FAILED");
    return { received: true, duplicate: false, downstreamCreated: true, eventReference: event.eventReference };
  } catch (error) {
    await releaseEvent(claim);
    throw error;
  }
}

module.exports = {
  CALL_STATUS_VALUES,
  DEFAULT_SCOPE,
  deliverTwilioStagingEvent,
  getTwilioWebhookOAuthConfig,
  issueTwilioWebhookAccessToken,
  normalizeCallStatusEvent,
  processTwilioStagingCallStatus,
  verifyTwilioWebhookBearer,
};
