const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12494956809";
const targetEndpointingMs = 300;
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "GRIMSBY-ENDPOINTING-300MS";
const tailoredMarker = "## GRIMSBY ELECTRIC WEBSITE-TAILORED OVERRIDE v1";
const isolatedMarker = "send_call_summaries_pilot_6809_v1";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function prompt(assistant) {
  return (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stable(value[key]);
    return result;
  }, {});
}

function sameJson(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  if (!response.ok) {
    const detail = payload.message || payload.error || payload.text || "request failed";
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return payload;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (apply && confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!phone || !assistantId) throw new Error("The Grimsby phone or assistant was not found.");
  const assignedPhones = phones.filter((record) => String(record?.assistantId || record?.assistant?.id || "").trim() === assistantId).map(phoneNumber).filter(Boolean);
  if (assignedPhones.length !== 1 || assignedPhones[0] !== targetPhone) throw new Error(`Refusing to tune a shared assistant: ${assignedPhones.join(", ") || "none"}.`);

  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const currentTranscriber = assistant?.transcriber || {};
  if (currentTranscriber.provider !== "deepgram" || currentTranscriber.model !== "nova-3") throw new Error("The Grimsby assistant is not using the expected Deepgram Nova-3 transcriber.");
  const currentEndpointingMs = Number(currentTranscriber.endpointing);
  if (!Number.isFinite(currentEndpointingMs) || currentEndpointingMs < 250 || currentEndpointingMs > 800) {
    throw new Error(`Refusing to tune an unexpected endpointing value: ${currentTranscriber.endpointing}.`);
  }
  const currentPrompt = prompt(assistant);
  if (!currentPrompt.includes(tailoredMarker) || !currentPrompt.includes(isolatedMarker)) throw new Error("The tailored prompt or isolated SMS marker is missing.");
  const currentToolIds = (assistant?.model?.toolIds || []).map(String);
  const nextTranscriber = { ...currentTranscriber, endpointing: targetEndpointingMs };
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    targetPhoneLast4: targetPhone.slice(-4),
    assistantIdHash: hash(assistantId),
    assignedPhoneCount: assignedPhones.length,
    endpointingCurrentMs: currentEndpointingMs,
    endpointingTargetMs: targetEndpointingMs,
    changedFields: currentEndpointingMs === targetEndpointingMs ? [] : ["transcriber.endpointing"],
    promptChange: false,
    toolChange: false,
    smsRoutingChange: false,
  }, null, 2));
  if (!apply) return;

  const backupDir = path.join(process.cwd(), "diagnostics", "vapi-grimsby-electric");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `latency-before-${stamp}.json`);
  const resultPath = path.join(backupDir, `latency-result-${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), phone, assistant }, null, 2)}\n`, { flag: "wx" });

  let patched = false;
  try {
    await request(`/assistant/${encodeURIComponent(assistantId)}`, { method: "PATCH", body: { transcriber: nextTranscriber } });
    patched = true;
    const verified = await request(`/assistant/${encodeURIComponent(assistantId)}`);
    const verifiedPrompt = prompt(verified);
    const verifiedToolIds = (verified?.model?.toolIds || []).map(String);
    const withoutEndpointing = (transcriber) => {
      const { endpointing: _endpointing, ...rest } = transcriber || {};
      return rest;
    };
    const checks = {
      endpointing300ms: Number(verified?.transcriber?.endpointing) === targetEndpointingMs,
      transcriberOtherwisePreserved: sameJson(withoutEndpointing(verified?.transcriber), withoutEndpointing(currentTranscriber)),
      keytermsPreserved: (verified?.transcriber?.keyterm || []).includes("Grimsby Electric") && (verified?.transcriber?.keyterm || []).includes("Ron Cournoyer"),
      smartFormattingPreserved: verified?.transcriber?.smartFormat === true && verified?.transcriber?.numerals === true,
      promptPreserved: verifiedPrompt === currentPrompt,
      toolIdsPreserved: sameJson(verifiedToolIds.slice().sort(), currentToolIds.slice().sort()),
      ownerSmsDisabledPromptPreserved: verifiedPrompt.includes("Owner SMS is temporarily disabled by policy"),
      artifactPlanPreserved: sameJson(verified?.artifactPlan, assistant?.artifactPlan),
    };
    const healthy = Object.values(checks).every(Boolean);
    const result = { applied: true, verified: healthy, endpointingBeforeMs: currentEndpointingMs, endpointingAfterMs: Number(verified?.transcriber?.endpointing), assistantIdHash: hash(assistantId), checks, backupPath, resultPath };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ ...result, backupPath: path.relative(process.cwd(), backupPath), resultPath: path.relative(process.cwd(), resultPath) }, null, 2));
    if (!healthy) throw new Error("Live read-back did not verify the isolated latency change.");
  } catch (error) {
    if (patched) await request(`/assistant/${encodeURIComponent(assistantId)}`, { method: "PATCH", body: { transcriber: currentTranscriber } }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
