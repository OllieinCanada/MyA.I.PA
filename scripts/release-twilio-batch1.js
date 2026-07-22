const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const vapiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const vapiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const batchNumber = process.argv.find((arg) => arg.startsWith("--batch="))?.slice("--batch=".length) || "1";
const approvalCutoffs = {
  "1": new Date("2026-07-20T17:49:00.000Z"),
  "2": new Date("2026-07-20T17:49:00.000Z"),
  "3": new Date("2026-07-21T05:15:50.879Z"),
};

// Batch 1 deliberately excludes the 13 Make-routed numbers pending datastore verification.
// It contains the 26 previously approved Vapi/orphan candidates plus 13 obvious active test numbers.
const batch1Targets = new Set([
  "+12492021724", "+12492091486", "+12492092994", "+12492094874", "+12492944894", "+12493154167",
  "+12494026945", "+12494027577", "+12494029111", "+12494212544", "+12494217616", "+12494217750", "+12494219002",
  "+12494219856", "+12494440359", "+12494440476", "+12494443364", "+12494683413", "+12494683936", "+12494689378",
  "+12494754812", "+12494810811", "+12494814884", "+12494865572", "+12494870935", "+12494915023", "+12494926634",
  "+12494956464", "+12495040274", "+12495054889", "+12495069259", "+12495232223", "+12495234812", "+12495280178",
  "+12495592388", "+12497025498", "+12497035723", "+12498060615", "+12498065190",
]);

const batch2Targets = new Set([
  "+12492942573", "+12494020467", "+12494023117", "+12494024844", "+12494025367", "+12494027114", "+12494213497",
  "+12494683961", "+12494753155", "+12494936834", "+12495004574", "+12497008891", "+12497021521",
]);

// Batch 3 preserves the five protected/live numbers, three named customer
// numbers, and all three recently active Make-routed numbers. These targets
// are stale legacy routes, generic AI tests, duplicate Tim's tests, or old
// inactive numbers with no website/repository references.
const batch3Targets = new Set([
  "+12494214600", "+13656012472", "+12492005565", "+12492942389", "+12494810500",
  "+12492020664", "+12492090435", "+12494219221", "+12497035788", "+12494801096",
  "+12494027492", "+12494756793", "+12494910162", "+12494751232", "+12494687285",
  "+12495290194", "+12492947547", "+13656755015", "+12495033725", "+17754168362",
]);

const batchConfig = batchNumber === "1"
  ? { label: "BATCH1-39", targets: batch1Targets }
  : batchNumber === "2"
    ? { label: "BATCH2-13", targets: batch2Targets }
    : batchNumber === "3"
      ? { label: "BATCH3-20", targets: batch3Targets }
    : null;
if (!batchConfig) throw new Error(`Unsupported batch: ${batchNumber}`);
const selectedTargets = batchConfig.targets;
const approvalCutoff = approvalCutoffs[batchNumber];

const protectedNumbers = new Set([
  "+12495033301", // public landing page/demo
  "+12494682588", // live repair pilot
  "+12498000318", // live call-quality pilot
  "+12498005417", // Oliver's Electrical/evaluation
  "+12494213161", // Arscott Plumbing and Heating
]);

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : "";
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`${options.label || url} failed with HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
  return body;
}

async function requestDelete(url, options = {}) {
  const response = await fetch(url, { ...options, method: "DELETE" });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.label || url} failed with HTTP ${response.status}: ${text.slice(0, 300) || "request failed"}`);
  return { status: response.status };
}

async function vapiRequest(pathname) {
  return requestJson(`${vapiBaseUrl}${pathname}`, {
    headers: { Authorization: `Bearer ${vapiKey}`, Accept: "application/json" },
    label: `Vapi ${pathname}`,
  });
}

async function resolveTwilioCredentials() {
  if (usableSecret(env.TWILIO_ACCOUNT_SID) && usableSecret(env.TWILIO_AUTH_TOKEN)) {
    return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN };
  }
  const tools = listFrom(await vapiRequest("/tool?limit=1000"), ["tools"]);
  for (const tool of tools) {
    const name = String(tool?.function?.name || tool?.name || "");
    if (!/^send_call_summaries_/i.test(name) || !tool?.id) continue;
    const detail = await vapiRequest(`/tool/${encodeURIComponent(tool.id)}`);
    const values = environmentMap(detail);
    if (usableSecret(values.TWILIO_ACCOUNT_SID) && usableSecret(values.TWILIO_AUTH_TOKEN)) {
      return { accountSid: values.TWILIO_ACCOUNT_SID, authToken: values.TWILIO_AUTH_TOKEN };
    }
  }
  throw new Error("No usable Twilio credentials were found.");
}

function twilioHeaders(credentials) {
  return {
    Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
    Accept: "application/json",
  };
}

async function fetchTwilioPages(firstUrl, collectionKey, credentials) {
  const records = [];
  let url = firstUrl;
  for (let page = 0; url && page < 100; page += 1) {
    const body = await requestJson(url, { headers: twilioHeaders(credentials), label: `Twilio ${collectionKey}` });
    records.push(...(Array.isArray(body?.[collectionKey]) ? body[collectionKey] : []));
    const next = String(body?.next_page_uri || "").trim();
    url = next ? new URL(next, "https://api.twilio.com").toString() : "";
  }
  return records;
}

function recordDate(record, type) {
  const raw = type === "call"
    ? record?.end_time || record?.start_time || record?.date_created
    : record?.date_sent || record?.date_updated || record?.date_created;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function redactBackup(value, key = "") {
  if (value == null || typeof value !== "object") {
    if (/token|secret|password|authorization|auth_token|api[_-]?key/i.test(key)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactBackup(item, key));
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === "environmentVariables" && Array.isArray(childValue)) {
      result[childKey] = childValue.map((item) => ({
        ...item,
        value: /token|secret|password|auth|api[_-]?key/i.test(String(item?.name || "")) ? "[REDACTED]" : item?.value,
      }));
    } else {
      result[childKey] = redactBackup(childValue, childKey);
    }
  }
  return result;
}

async function main() {
  if (batch1Targets.size !== 39 || batch2Targets.size !== 13 || batch3Targets.size !== 20) {
    throw new Error(`Internal target count mismatch: ${batch1Targets.size}/${batch2Targets.size}/${batch3Targets.size}.`);
  }
  if ([...selectedTargets].some((number) => protectedNumbers.has(number))) throw new Error(`A protected number was included in ${batchConfig.label}.`);
  if (apply && confirmation !== batchConfig.label) throw new Error(`Apply mode requires --confirm=${batchConfig.label}.`);
  if (!vapiKey) throw new Error("VAPI_API_KEY is not configured.");

  const credentials = await resolveTwilioCredentials();
  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}`;
  const [twilioNumbers, calls, messages, vapiPhonePayload] = await Promise.all([
    fetchTwilioPages(`${twilioBase}/IncomingPhoneNumbers.json?PageSize=1000`, "incoming_phone_numbers", credentials),
    fetchTwilioPages(`${twilioBase}/Calls.json?PageSize=1000`, "calls", credentials),
    fetchTwilioPages(`${twilioBase}/Messages.json?PageSize=1000`, "messages", credentials),
    vapiRequest("/phone-number?limit=1000"),
  ]);
  const vapiPhones = listFrom(vapiPhonePayload, ["phoneNumbers", "phone_numbers"]);
  const twilioByNumber = new Map(twilioNumbers.map((record) => [normalizePhone(record?.phone_number), record]));
  const vapiByNumber = new Map(vapiPhones.map((record) => [normalizePhone(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId), record]));
  const missing = [...selectedTargets].filter((number) => !twilioByNumber.has(number));
  if (missing.length) throw new Error(`Preflight stopped: ${missing.length} ${batchConfig.label} numbers are no longer owned: ${missing.join(", ")}`);
  const missingProtected = [...protectedNumbers].filter((number) => !twilioByNumber.has(number));
  if (missingProtected.length) throw new Error(`Preflight stopped: protected numbers are missing: ${missingProtected.join(", ")}`);

  const newActivity = [];
  for (const [type, records] of [["call", calls], ["message", messages]]) {
    for (const record of records) {
      const touched = [normalizePhone(record?.from), normalizePhone(record?.to)].filter((number) => selectedTargets.has(number));
      const at = recordDate(record, type);
      if (touched.length && at && at > approvalCutoff) newActivity.push({ type, numbers: touched, at: at.toISOString() });
    }
  }
  if (newActivity.length) throw new Error(`Preflight stopped: ${batchConfig.label} has ${newActivity.length} activity records newer than the approval audit.`);

  const selectedTwilio = [...selectedTargets].map((number) => twilioByNumber.get(number));
  const selectedVapi = [...selectedTargets].map((number) => vapiByNumber.get(number)).filter(Boolean);
  const assistantIds = [...new Set(selectedVapi.map((phone) => String(phone?.assistantId || phone?.assistant?.id || "")).filter(Boolean))];
  const assistants = await Promise.all(assistantIds.map((id) => vapiRequest(`/assistant/${encodeURIComponent(id)}`)));
  const toolIds = [...new Set(assistants.flatMap((assistant) => Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : []).map(String).filter(Boolean))];
  const tools = await Promise.all(toolIds.map((id) => vapiRequest(`/tool/${encodeURIComponent(id)}`).catch(() => ({ id, backupUnavailable: true }))));

  const summary = {
    mode: apply ? "apply" : "dry-run",
    ownedBefore: twilioNumbers.length,
    batch: batchConfig.label,
    targetCount: selectedTargets.size,
    vapiPhoneRecordsToDetach: selectedVapi.length,
    assistantConfigsBackedUp: assistants.length,
    toolConfigsBackedUp: tools.length,
    protectedNumbersVerified: protectedNumbers.size,
    newActivityAfterApprovalAudit: newActivity.length,
    estimatedMonthlySavingsUsd: Number((selectedTargets.size * 1.15).toFixed(2)),
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const backupDir = path.join(process.cwd(), "diagnostics", "phone-release");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `batch${batchNumber}-before-${stamp}.json`);
  const backup = redactBackup({
    createdAt: new Date().toISOString(),
    batch: batchConfig.label,
    targets: [...selectedTargets].sort(),
    twilioNumbers: selectedTwilio,
    vapiPhones: selectedVapi,
    vapiAssistants: assistants,
    vapiTools: tools,
  });
  const backupText = `${JSON.stringify(backup, null, 2)}\n`;
  fs.writeFileSync(backupPath, backupText, { encoding: "utf8", flag: "wx" });
  const backupSha256 = crypto.createHash("sha256").update(backupText).digest("hex");

  const detached = [];
  for (const phone of selectedVapi) {
    const number = normalizePhone(phone?.number || phone?.phoneNumber || phone?.twilioPhoneNumber || phone?.providerResourceId);
    await requestDelete(`${vapiBaseUrl}/phone-number/${encodeURIComponent(String(phone.id))}`, {
      headers: { Authorization: `Bearer ${vapiKey}`, Accept: "application/json" },
      label: `Detach Vapi ${number}`,
    });
    detached.push(number);
  }

  const released = [];
  const releaseFailures = [];
  for (const number of [...selectedTargets].sort()) {
    const record = twilioByNumber.get(number);
    try {
      await requestDelete(`${twilioBase}/IncomingPhoneNumbers/${encodeURIComponent(String(record.sid))}.json`, {
        headers: twilioHeaders(credentials),
        label: `Release Twilio ${number}`,
      });
      released.push(number);
    } catch (error) {
      releaseFailures.push({ number, error: String(error?.message || error) });
    }
  }

  const [remainingTwilioPayload, remainingVapiPayload] = await Promise.all([
    requestJson(`${twilioBase}/IncomingPhoneNumbers.json?PageSize=1000`, { headers: twilioHeaders(credentials), label: "Verify Twilio inventory" }),
    vapiRequest("/phone-number?limit=1000"),
  ]);
  const remainingTwilio = Array.isArray(remainingTwilioPayload?.incoming_phone_numbers) ? remainingTwilioPayload.incoming_phone_numbers : [];
  const remainingTwilioNumbers = new Set(remainingTwilio.map((record) => normalizePhone(record?.phone_number)));
  const remainingVapi = listFrom(remainingVapiPayload, ["phoneNumbers", "phone_numbers"]);
  const remainingVapiNumbers = new Set(remainingVapi.map((record) => normalizePhone(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId)));
  const protectedStillOwned = [...protectedNumbers].filter((number) => remainingTwilioNumbers.has(number));
  const targetsStillOwned = [...selectedTargets].filter((number) => remainingTwilioNumbers.has(number));
  const targetsStillInVapi = [...selectedTargets].filter((number) => remainingVapiNumbers.has(number));
  const result = {
    ...summary,
    backupPath,
    backupSha256,
    detachedFromVapi: detached.length,
    releasedFromTwilio: released.length,
    releaseFailures,
    ownedAfter: remainingTwilio.length,
    protectedStillOwned: protectedStillOwned.length,
    targetsStillOwned,
    targetsStillInVapi,
  };
  const resultPath = path.join(backupDir, `batch${batchNumber}-result-${stamp}.json`);
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ ...result, backupPath: path.relative(process.cwd(), backupPath), resultPath: path.relative(process.cwd(), resultPath) }, null, 2));
  if (releaseFailures.length || targetsStillOwned.length || targetsStillInVapi.length || protectedStillOwned.length !== protectedNumbers.size) process.exit(2);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
