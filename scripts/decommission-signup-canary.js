const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apply = process.argv.includes("--apply");
const expectedConfirmation = "REMOVE_SIGNUP_CANARY_2415";
const confirmation = String(process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "");
const expectedLast4 = "2415";
const expectedAssistantPrefix = "myaipa-vapi-assistant-78c28be5ba1d142ece";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : "";
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`${options.label || "Provider request"} failed with HTTP ${response.status}.`);
  return body;
}

async function remove(url, options = {}) {
  const response = await fetch(url, { ...options, method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`${options.label || "Provider delete"} failed with HTTP ${response.status}.`);
}

function vapiHeaders(key) {
  return { Authorization: `Bearer ${key}`, Accept: "application/json" };
}

function twilioHeaders(accountSid, authToken) {
  return { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, Accept: "application/json" };
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

async function resolveTwilioCredentials(vapiBase, vapiKey) {
  if (usableSecret(env.TWILIO_ACCOUNT_SID) && usableSecret(env.TWILIO_AUTH_TOKEN)) {
    return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN };
  }
  const payload = await request(`${vapiBase}/tool?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Vapi tool inventory" });
  for (const tool of listFrom(payload, ["tools"])) {
    const name = String(tool?.function?.name || tool?.name || "");
    if (!/^send_call_summaries_/i.test(name) || !tool?.id) continue;
    const detail = await request(`${vapiBase}/tool/${encodeURIComponent(tool.id)}`, { headers: vapiHeaders(vapiKey), label: "Vapi tool" });
    const values = environmentMap(detail);
    if (usableSecret(values.TWILIO_ACCOUNT_SID) && usableSecret(values.TWILIO_AUTH_TOKEN)) {
      return { accountSid: values.TWILIO_ACCOUNT_SID, authToken: values.TWILIO_AUTH_TOKEN };
    }
  }
  throw new Error("No usable Twilio credentials were found.");
}

async function main() {
  const vapiKey = String(env.VAPI_API_KEY || "").trim();
  const vapiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
  if (!vapiKey) throw new Error("A Vapi credential is required.");
  if (apply && confirmation !== expectedConfirmation) throw new Error(`Apply mode requires --confirm=${expectedConfirmation}.`);
  const { accountSid, authToken } = await resolveTwilioCredentials(vapiBase, vapiKey);
  const [phonePayload, assistantPayload, twilioPayload] = await Promise.all([
    request(`${vapiBase}/phone-number?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Vapi phone inventory" }),
    request(`${vapiBase}/assistant?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Vapi assistant inventory" }),
    request(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=1000`, {
      headers: twilioHeaders(accountSid, authToken),
      label: "Twilio phone inventory",
    }),
  ]);
  const phones = listFrom(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const twilioNumbers = listFrom(twilioPayload, ["incoming_phone_numbers"]);
  const matches = phones.filter((phone) => normalizePhone(phone?.number || phone?.phoneNumber || phone?.providerResourceId).endsWith(expectedLast4));
  if (matches.length !== 1) throw new Error(`Expected exactly one Vapi phone ending ${expectedLast4}; found ${matches.length}.`);
  const phone = matches[0];
  const number = normalizePhone(phone?.number || phone?.phoneNumber || phone?.providerResourceId);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "");
  const assistant = assistants.find((item) => String(item?.id || "") === assistantId);
  if (!assistant || !String(assistant.name || "").startsWith(expectedAssistantPrefix)) {
    throw new Error("The phone matched, but its assistant is not the expected synthetic signup canary.");
  }
  if (phones.some((item) => String(item?.id || "") !== String(phone.id || "") && String(item?.assistantId || item?.assistant?.id || "") === assistantId)) {
    throw new Error("The canary assistant is attached to another phone; refusing deletion.");
  }
  const twilioNumber = twilioNumbers.find((item) => normalizePhone(item?.phone_number) === number);
  const summary = {
    mode: apply ? "apply" : "dry-run",
    targetLast4: expectedLast4,
    assistantName: assistant.name,
    vapiPhoneFound: true,
    vapiAssistantFound: true,
    twilioNumberFound: Boolean(twilioNumber),
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const outputDir = path.join(process.cwd(), "diagnostics", "phone-release");
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(outputDir, `signup-canary-2415-${stamp}.json`), `${JSON.stringify({
    ...summary,
    removedAt: new Date().toISOString(),
    phoneId: phone.id,
    assistantId,
    twilioSidHash: twilioNumber?.sid ? crypto.createHash("sha256").update(twilioNumber.sid).digest("hex") : "",
  }, null, 2)}\n`, { flag: "wx" });
  await remove(`${vapiBase}/phone-number/${encodeURIComponent(phone.id)}`, { headers: vapiHeaders(vapiKey), label: "Delete Vapi canary phone" });
  await remove(`${vapiBase}/assistant/${encodeURIComponent(assistantId)}`, { headers: vapiHeaders(vapiKey), label: "Delete Vapi canary assistant" });
  if (twilioNumber?.sid) {
    await remove(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(twilioNumber.sid)}.json`, {
      headers: twilioHeaders(accountSid, authToken),
      label: "Release Twilio canary number",
    });
  }
  console.log(JSON.stringify({ ...summary, ok: true, auditWritten: true }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
