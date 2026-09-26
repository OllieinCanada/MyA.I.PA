const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apply = process.argv.includes("--apply");
const confirmation = String(process.argv.find((arg) => arg.startsWith("--confirm="))?.split("=")[1] || "");
const EXPECTED_CONFIRMATION = "DECOMMISSION_SEVEN_20260907";
const targetLast4 = new Set(["2271", "8678", "5417", "3161", "0420", "0673", "1703", "7487"]);
const expectedNames = new Map([
  ["2271", "Robert's ElectricalAI"],
  ["8678", "Mike's ElectricalAI"],
  ["5417", "Oliver's ElectricalAI"],
  ["3161", "Arscott Plumbing and Heating Inc.AI"],
  ["0420", "myaipa-vapi-assistant-"],
  ["0673", "My AI PA — Tim's Scenario Caller"],
  ["1703", "My AI PA — Tim's Recorded Demo"],
  ["7487", "My AI PA — Dean Allison Private Demo"],
]);

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : "";
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`${options.label || url} failed with HTTP ${response.status}: ${String(body?.message || body?.error || text || "request failed").slice(0, 240)}`);
  return body;
}

async function remove(url, options = {}) {
  const response = await fetch(url, { ...options, method: "DELETE" });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.label || url} failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
}

function vapiHeaders(key) {
  return { Authorization: `Bearer ${key}`, Accept: "application/json" };
}

function twilioHeaders(accountSid, authToken) {
  return { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, Accept: "application/json" };
}

async function resolveTwilioCredentials(vapiBase, vapiKey) {
  if (usableSecret(env.TWILIO_ACCOUNT_SID) && usableSecret(env.TWILIO_AUTH_TOKEN)) {
    return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN };
  }
  const payload = await request(`${vapiBase}/tool?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Vapi tools" });
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

function redact(value, key = "") {
  if (value == null || typeof value !== "object") {
    return /token|secret|password|authorization|auth_token|api[_-]?key/i.test(key) ? "[REDACTED]" : value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
}

async function main() {
  const vapiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
  const vapiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
  if (!vapiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (apply && confirmation !== EXPECTED_CONFIRMATION) throw new Error(`Apply mode requires --confirm=${EXPECTED_CONFIRMATION}.`);

  const credentials = await resolveTwilioCredentials(vapiBase, vapiKey);
  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}`;
  const [phonePayload, assistantPayload, twilioPayload] = await Promise.all([
    request(`${vapiBase}/phone-number?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Vapi phone inventory" }),
    request(`${vapiBase}/assistant?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Vapi assistant inventory" }),
    request(`${twilioBase}/IncomingPhoneNumbers.json?PageSize=1000`, { headers: twilioHeaders(credentials.accountSid, credentials.authToken), label: "Twilio inventory" }),
  ]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const assistantById = new Map(assistants.map((item) => [String(item?.id || ""), item]));
  const phones = listFrom(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const twilioNumbers = listFrom(twilioPayload, ["incoming_phone_numbers"]);
  const currentTargets = phones.map((phone) => {
    const number = normalizePhone(phone?.number || phone?.phoneNumber || phone?.twilioPhoneNumber || phone?.providerResourceId);
    const last4 = number.slice(-4);
    const assistantId = String(phone?.assistantId || phone?.assistant?.id || "");
    const assistant = assistantById.get(assistantId);
    return { last4, number, phone, assistantId, assistant, assistantName: String(assistant?.name || phone?.assistant?.name || "") };
  }).filter((item) => targetLast4.has(item.last4));
  const priorBackup = fs.existsSync(path.join(process.cwd(), "diagnostics", "phone-release"))
    ? fs.readdirSync(path.join(process.cwd(), "diagnostics", "phone-release"))
      .filter((name) => name.startsWith("decommission-seven-before-") && name.endsWith(".json"))
      .sort().reverse().map((name) => path.join(process.cwd(), "diagnostics", "phone-release", name))[0]
    : "";
  const backedUpTargets = priorBackup ? JSON.parse(fs.readFileSync(priorBackup, "utf8")).targets || [] : [];
  const backupByLast4 = new Map(backedUpTargets.map((item) => [String(item?.last4 || ""), item]));
  const currentByLast4 = new Map(currentTargets.map((item) => [item.last4, item]));
  const targets = [...targetLast4].map((last4) => {
    const current = currentByLast4.get(last4);
    const backup = backupByLast4.get(last4);
    if (!current) return backup;
    return {
      ...backup,
      ...current,
      assistantId: current.assistantId || backup?.assistantId || "",
      assistantName: current.assistantName || backup?.assistantName || backup?.assistant?.name || "",
    };
  }).filter(Boolean);
  const matchedLast4 = new Set(targets.map((item) => item.last4));
  const missing = [...targetLast4].filter((last4) => !matchedLast4.has(last4));
  if (missing.length) throw new Error(`Preflight stopped: target endings not uniquely found in Vapi: ${missing.join(", ")}`);
  if (currentTargets.length !== new Set(currentTargets.map((item) => item.last4)).size) throw new Error("Preflight stopped: one or more target endings matched multiple Vapi phone records.");
  for (const target of targets) {
    const expected = expectedNames.get(target.last4);
    if (!String(target.assistantName || target.assistant?.name || "").includes(expected)) {
      throw new Error(`Preflight stopped: assistant identity mismatch for ending ${target.last4}.`);
    }
  }
  const twilioByNumber = new Map(twilioNumbers.map((item) => [normalizePhone(item?.phone_number), item]));
  const twilioTargets = targets.filter((target) => twilioByNumber.has(target.number));
  const assistantIds = targets.map((item) => item.assistantId).filter(Boolean);
  if (new Set(assistantIds).size !== targets.length) throw new Error("Preflight stopped: a target assistant is shared by multiple target numbers.");
  const nonTargetPhonesUsingAssistants = phones.filter((phone) => {
    const number = normalizePhone(phone?.number || phone?.phoneNumber || phone?.twilioPhoneNumber || phone?.providerResourceId);
    const assistantId = String(phone?.assistantId || phone?.assistant?.id || "");
    return !targetLast4.has(number.slice(-4)) && assistantIds.includes(assistantId);
  });
  if (nonTargetPhonesUsingAssistants.length) throw new Error("Preflight stopped: a target assistant is also attached to a retained phone.");

  const summary = {
    mode: apply ? "apply" : "dry-run",
    targetCount: targets.length,
    targets: targets.map((item) => ({ last4: item.last4, assistantName: item.assistantName })),
    vapiPhonesToDelete: currentTargets.length,
    vapiAssistantsToDelete: assistantIds.filter((id) => assistantById.has(id)).length,
    twilioNumbersToRelease: twilioTargets.length,
    alreadyAbsentFromTwilio: targets.filter((target) => !twilioByNumber.has(target.number)).map((target) => target.last4),
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Dry run only. Re-run with --apply --confirm=${EXPECTED_CONFIRMATION}.`);
    return;
  }

  const outputDir = path.join(process.cwd(), "diagnostics", "phone-release");
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(outputDir, `decommission-seven-before-${stamp}.json`);
  const backupText = `${JSON.stringify(redact({ createdAt: new Date().toISOString(), targets }), null, 2)}\n`;
  fs.writeFileSync(backupPath, backupText, { encoding: "utf8", flag: "wx" });
  const backupSha256 = crypto.createHash("sha256").update(backupText).digest("hex");

  for (const target of currentTargets) {
    await remove(`${vapiBase}/phone-number/${encodeURIComponent(String(target.phone.id))}`, { headers: vapiHeaders(vapiKey), label: `Delete Vapi phone ending ${target.last4}` });
  }
  for (const target of targets) {
    if (assistantById.has(target.assistantId)) await remove(`${vapiBase}/assistant/${encodeURIComponent(target.assistantId)}`, { headers: vapiHeaders(vapiKey), label: `Delete Vapi assistant for ending ${target.last4}` });
  }
  for (const target of twilioTargets) {
    const record = twilioByNumber.get(target.number);
    await remove(`${twilioBase}/IncomingPhoneNumbers/${encodeURIComponent(String(record.sid))}.json`, { headers: twilioHeaders(credentials.accountSid, credentials.authToken), label: `Release Twilio number ending ${target.last4}` });
  }

  const [phonesAfterPayload, assistantsAfterPayload, twilioAfterPayload] = await Promise.all([
    request(`${vapiBase}/phone-number?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Verify Vapi phones" }),
    request(`${vapiBase}/assistant?limit=1000`, { headers: vapiHeaders(vapiKey), label: "Verify Vapi assistants" }),
    request(`${twilioBase}/IncomingPhoneNumbers.json?PageSize=1000`, { headers: twilioHeaders(credentials.accountSid, credentials.authToken), label: "Verify Twilio inventory" }),
  ]);
  const remainingPhoneEndings = new Set(listFrom(phonesAfterPayload, ["phoneNumbers", "phone_numbers"]).map((item) => normalizePhone(item?.number || item?.phoneNumber || item?.twilioPhoneNumber || item?.providerResourceId).slice(-4)));
  const remainingAssistantIds = new Set(listFrom(assistantsAfterPayload, ["assistants"]).map((item) => String(item?.id || "")));
  const remainingTwilioEndings = new Set(listFrom(twilioAfterPayload, ["incoming_phone_numbers"]).map((item) => normalizePhone(item?.phone_number).slice(-4)));
  const result = {
    ...summary,
    backupPath: path.relative(process.cwd(), backupPath),
    backupSha256,
    remainingVapiPhoneTargets: [...targetLast4].filter((value) => remainingPhoneEndings.has(value)),
    remainingVapiAssistantTargets: targets.filter((item) => remainingAssistantIds.has(item.assistantId)).map((item) => item.last4),
    remainingTwilioTargets: [...targetLast4].filter((value) => remainingTwilioEndings.has(value)),
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.remainingVapiPhoneTargets.length || result.remainingVapiAssistantTargets.length || result.remainingTwilioTargets.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
