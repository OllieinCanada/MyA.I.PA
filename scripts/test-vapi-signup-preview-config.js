const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { loadProjectEnv } = require("./_helpers");

const previewAssistantId = String(
  process.env.VAPI_PREVIEW_ASSISTANT_ID
  || "fb47b756-5713-4537-bd15-392d78962473"
).trim();
const env = loadProjectEnv();

process.env.VAPI_API_KEY = String(env.VAPI_API_KEY || "").trim();
process.env.VAPI_API_BASE_URL = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim();
process.env.VAPI_PREVIEW_ASSISTANT_ID = previewAssistantId;
process.env.VAPI_PREVIEW_MAX_DURATION_SECONDS = "60";
process.env.NODE_ENV = "test";
process.env.SECURITY_STATE_FORCE_DATABASE = "false";
process.env.VAPI_AUTO_SYNC_ENABLED = "false";
process.env.TRIAL_REMINDER_DISABLE = "true";
process.env.MISSED_CALL_ALERT_ENABLED = "false";
process.env.DAILY_DIGEST_ENABLED = "false";

const { app } = require("../server/index");
const { prisma } = require("../server/prisma");

async function main() {
  if (!process.env.VAPI_API_KEY) throw new Error("VAPI_API_KEY is required.");
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/public/vapi-preview-config`, {
      headers: {
        Origin: "https://www.myaipa.ca",
        Accept: "application/json",
      },
    });
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.enabled, true);
    assert.equal(config.assistantId, previewAssistantId);
    assert.equal(config.maxDurationSeconds, 60);
    assert.equal(config.maxConcurrentCalls, 2);

    const sessionResponse = await fetch(`${baseUrl}/api/public/vapi-preview-session`, {
      method: "POST",
      headers: {
        Origin: "https://www.myaipa.ca",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(sessionResponse.status, 200);
    assert.match(sessionResponse.headers.get("cache-control") || "", /no-store/);
    const payload = await sessionResponse.json();
    assert.equal(payload.assistantId, previewAssistantId);
    assert.equal(payload.maxDurationSeconds, 60);
    assert.ok(payload.token);
    assert.match(payload.sessionId, /^[a-f0-9]{36}$/);

    const decoded = jwt.decode(payload.token);
    assert.equal(decoded?.token?.tag, "public");
    assert.equal(decoded?.token?.restrictions?.enabled, true);
    assert.equal(decoded?.token?.restrictions?.allowTransientAssistant, false);
    assert.deepEqual(decoded?.token?.restrictions?.allowedOrigins, ["https://www.myaipa.ca"]);
    assert.deepEqual(decoded?.token?.restrictions?.allowedAssistantIds, [previewAssistantId]);
    assert.ok(Number(decoded?.exp) > Math.floor(Date.now() / 1000));
    assert.equal(decoded?.jti, payload.sessionId);

    const secondSessionResponse = await fetch(`${baseUrl}/api/public/vapi-preview-session`, {
      method: "POST",
      headers: {
        Origin: "https://www.myaipa.ca",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(secondSessionResponse.status, 200);
    const secondSession = await secondSessionResponse.json();
    assert.match(secondSession.sessionId, /^[a-f0-9]{36}$/);

    const busyResponse = await fetch(`${baseUrl}/api/public/vapi-preview-session`, {
      method: "POST",
      headers: {
        Origin: "https://www.myaipa.ca",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(busyResponse.status, 429);
    assert.match(String((await busyResponse.json()).error || ""), /busy/i);

    const releaseResponse = await fetch(`${baseUrl}/api/public/vapi-preview-session/release`, {
      method: "POST",
      headers: {
        Origin: "https://www.myaipa.ca",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId: payload.sessionId }),
    });
    assert.equal(releaseResponse.status, 204);

    const secondReleaseResponse = await fetch(`${baseUrl}/api/public/vapi-preview-session/release`, {
      method: "POST",
      headers: {
        Origin: "https://www.myaipa.ca",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId: secondSession.sessionId }),
    });
    assert.equal(secondReleaseResponse.status, 204);

    console.log(JSON.stringify({
      ok: true,
      enabled: config.enabled,
      assistantId: payload.assistantId,
      maxDurationSeconds: payload.maxDurationSeconds,
      maxConcurrentCalls: config.maxConcurrentCalls,
      thirdConcurrentCallBlocked: true,
      tokenScope: decoded.token.tag,
      allowedOrigins: decoded.token.restrictions.allowedOrigins,
      allowTransientAssistant: decoded.token.restrictions.allowTransientAssistant,
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
