#!/usr/bin/env node
const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { getTwilioSignature } = require("../server/smsSuppression");

const REPLAY_CONFIRMATION = "REPLAY_STAGING_TWILIO_WEBHOOK_EVENT";

function flagValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || "";
}

function replayPublicConfiguration(env) {
  const stagingEnabled = /^(1|true|yes|on)$/i.test(String(env.TWILIO_WEBHOOK_STAGING_ENABLED || ""));
  const oauthEnabled = /^(1|true|yes|on)$/i.test(String(env.TWILIO_WEBHOOK_OAUTH_ENABLED || ""));
  const baseUrl = String(env.TWILIO_WEBHOOK_STAGING_BASE_URL || "").trim().replace(/\/$/, "");
  const callbackUrl = `${baseUrl}/api/webhooks/twilio/staging/call-status`;
  const tokenUrl = `${baseUrl}/api/integrations/twilio/webhook-oauth/token`;
  const scope = String(env.TWILIO_WEBHOOK_OAUTH_SCOPE || "twilio:webhooks").trim();
  const audience = String(env.TWILIO_WEBHOOK_OAUTH_AUDIENCE || callbackUrl).trim();
  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new Error("TWILIO_WEBHOOK_STAGING_BASE_URL must be a valid public HTTPS URL.");
  }
  if (
    !stagingEnabled
    || !oauthEnabled
    || parsedBase.protocol !== "https:"
    || parsedBase.username
    || parsedBase.password
    || parsedBase.hash
    || !scope
    || !audience
  ) {
    throw new Error("Staging webhook OAuth must be fully configured before replaying an event.");
  }
  return { callbackUrl, tokenUrl, scope, audience };
}

function replayCredentials(env) {
  const clientId = String(env.TWILIO_WEBHOOK_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(env.TWILIO_WEBHOOK_OAUTH_CLIENT_SECRET || "").trim();
  if (!clientId || clientSecret.length < 24) {
    throw new Error("Dedicated staging OAuth replay credentials are incomplete.");
  }
  return { clientId, clientSecret };
}

async function replayEvent(env, { fetchImpl = global.fetch } = {}) {
  const config = replayPublicConfiguration(env);
  const credentials = replayCredentials(env);
  const tokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: config.scope,
    audience: config.audience,
  });
  const tokenResponse = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok) throw new Error(`The staging OAuth token endpoint returned HTTP ${tokenResponse.status}.`);
  const token = await tokenResponse.json();
  const callSid = `CA${crypto.randomBytes(16).toString("hex")}`;
  const event = {
    CallSid: callSid,
    CallStatus: "completed",
    SequenceNumber: "1",
    Timestamp: new Date().toISOString(),
    CallbackSource: "myaipa-staging-replay",
  };
  const form = new URLSearchParams(event);
  if (!String(env.TWILIO_AUTH_TOKEN || "").trim()) {
    throw new Error("TWILIO_AUTH_TOKEN is required to sign the controlled replay event.");
  }
  const signature = getTwilioSignature(config.callbackUrl, event, env.TWILIO_AUTH_TOKEN);
  const send = async () => {
    const response = await fetchImpl(config.callbackUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`The controlled staging replay returned HTTP ${response.status}.`);
    return payload;
  };
  const first = await send();
  const second = await send();
  if (first.duplicate || !first.downstreamCreated || !second.duplicate || second.downstreamCreated) {
    throw new Error("Replay safety failed: the two identical deliveries did not create exactly one downstream record.");
  }
  return { passed: true, firstCreated: true, duplicateSuppressed: true, eventReference: first.eventReference };
}

async function main() {
  if (flagValue("confirm") !== REPLAY_CONFIRMATION) {
    throw new Error(`Replaying requires --confirm=${REPLAY_CONFIRMATION}.`);
  }
  const result = await replayEvent(loadProjectEnv());
  console.log(JSON.stringify({ mode: "replay", ...result }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Twilio staging webhook replay failed: ${String(error?.message || error).slice(0, 500)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  REPLAY_CONFIRMATION,
  replayCredentials,
  replayEvent,
  replayPublicConfiguration,
};
