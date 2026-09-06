const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { loadProjectEnv } = require("./_helpers");
const { requireCanadianNumber } = require("../server/canadianPhoneNumber");

const env = loadProjectEnv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const deploy = args.includes("--deploy");
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const confirmationPhrase = "CONFIGURE_FORWARDING_ONBOARDING";
const serviceId = String(
  args.find((arg) => arg.startsWith("--service-id="))?.slice("--service-id=".length)
  || env.RENDER_SERVICE_ID
  || ""
).trim();
const renderConfigPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml");
const callbackUrl = "https://api.myaipa.ca/api/webhooks/twilio/forwarding-verification-status";
const tokenTtlSeconds = "86400";

function stripYamlValue(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function readRenderCredentials() {
  const source = fs.readFileSync(renderConfigPath, "utf8");
  const apiBlock = source.match(/(?:^|\r?\n)api:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\s*$)/);
  const key = stripYamlValue(apiBlock?.[1]?.match(/^\s+key:\s*(.+)$/m)?.[1]);
  const host = stripYamlValue(apiBlock?.[1]?.match(/^\s+host:\s*(.+)$/m)?.[1]).replace(/\/+$/, "");
  if (!key || !host) throw new Error("The signed-in Render CLI profile is unavailable or incomplete.");
  return { key, host };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}.`);
  return payload;
}

function renderHeaders(credentials, body = false) {
  return {
    authorization: `Bearer ${credentials.key}`,
    accept: "application/json",
    ...(body ? { "content-type": "application/json" } : {}),
  };
}

async function readRenderEnv(credentials, key) {
  const payload = await requestJson(
    `${credentials.host}/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
    { headers: renderHeaders(credentials) }
  );
  return String(payload?.value ?? payload?.envVar?.value ?? "").trim();
}

async function writeRenderEnv(credentials, key, value) {
  await requestJson(
    `${credentials.host}/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
    { method: "PUT", headers: renderHeaders(credentials, true), body: JSON.stringify({ value }) }
  );
}

async function verifyTwilioOwnership(renderEnv, candidate) {
  const accountSid = renderEnv.TWILIO_ACCOUNT_SID;
  const username = renderEnv.TWILIO_API_KEY_SID || accountSid;
  const password = renderEnv.TWILIO_API_KEY_SECRET || renderEnv.TWILIO_AUTH_TOKEN;
  if (!/^AC[a-f0-9]{32}$/i.test(accountSid) || !username || !password) {
    throw new Error("Render does not expose usable Twilio credentials for ownership verification.");
  }
  const query = new URLSearchParams({ PhoneNumber: candidate, PageSize: "20" });
  const payload = await requestJson(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?${query}`,
    { headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, accept: "application/json" } }
  );
  const matches = (payload?.incoming_phone_numbers || []).filter((item) => item.phone_number === candidate);
  if (matches.length !== 1) throw new Error("The forwarding verification caller ID is not uniquely owned by this Twilio account.");
}

async function main() {
  if (!/^srv-[a-z0-9]+$/i.test(serviceId)) throw new Error("A valid RENDER_SERVICE_ID is required.");
  if (apply && confirmation !== confirmationPhrase) {
    throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);
  }
  const credentials = readRenderCredentials();
  const keys = [
    "TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER", "FORWARDING_VERIFICATION_CALLER_ID", "FORWARDING_SETUP_SECRET",
  ];
  const renderEnv = {};
  for (const key of keys) renderEnv[key] = await readRenderEnv(credentials, key);

  const requestedCaller = args.find((arg) => arg.startsWith("--caller-id="))?.slice("--caller-id=".length);
  const callerId = requireCanadianNumber(requestedCaller || renderEnv.FORWARDING_VERIFICATION_CALLER_ID || renderEnv.TWILIO_FROM_NUMBER, "Verification caller ID");
  await verifyTwilioOwnership(renderEnv, callerId);
  const setupSecret = renderEnv.FORWARDING_SETUP_SECRET.length >= 32
    ? renderEnv.FORWARDING_SETUP_SECRET
    : crypto.randomBytes(32).toString("hex");
  const updates = new Map([
    ["FORWARDING_VERIFICATION_CALLER_ID", callerId],
    ["FORWARDING_VERIFICATION_STATUS_CALLBACK_URL", callbackUrl],
    ["FORWARDING_SETUP_SECRET", setupSecret],
    ["FORWARDING_SETUP_URL_TTL_SECONDS", tokenTtlSeconds],
  ]);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    serviceId,
    callerIdLast4: callerId.slice(-4),
    callerIdOwnershipVerified: true,
    secretAction: renderEnv.FORWARDING_SETUP_SECRET.length >= 32 ? "preserve" : "generate",
    keys: [...updates.keys()],
    deployRequested: deploy,
    secretValuesPrinted: false,
  }, null, 2));
  if (!apply) {
    console.log(`Dry run only. Re-run with --apply --deploy --confirm=${confirmationPhrase}.`);
    return;
  }

  for (const [key, value] of updates) await writeRenderEnv(credentials, key, value);
  for (const [key, expected] of updates) {
    const stored = await readRenderEnv(credentials, key);
    if (stored !== expected) throw new Error(`Render did not verify ${key}.`);
  }
  let deployPayload = null;
  if (deploy) {
    deployPayload = await requestJson(
      `${credentials.host}/services/${encodeURIComponent(serviceId)}/deploys`,
      { method: "POST", headers: renderHeaders(credentials, true), body: JSON.stringify({ deployMode: "deploy_only" }) }
    );
  }
  console.log(JSON.stringify({
    ok: true,
    serviceId,
    keysVerified: [...updates.keys()],
    callerIdOwnershipVerified: true,
    secretPreservedOrGenerated: true,
    deployId: deployPayload?.id || deployPayload?.deploy?.id || "",
    deployStatus: deployPayload?.status || deployPayload?.deploy?.status || (deploy ? "requested" : "not_requested"),
    secretValuesPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
