const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12494956809";
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "GRIMSBY-CALL-TYPE-QUALITY-V2";
const names = {
  lead: "Grimsby Lead Intake v1",
  intake: "Grimsby Intake Complete v1",
  handoff: "Grimsby SMS Handoff v1",
  scorecard: "Grimsby Call Quality v1",
};
const intakeDescription = "True when either: (a) a service lead or message requiring follow-up captured the caller's name, callback route, service location when relevant, reason for calling, preferred timing, and callback preference; or (b) the call was informational, FAQ-only, or safety-only and lead intake was not appropriate. Do not penalize a successful informational call for correctly skipping lead intake.";
const handoffDescription = "True when either: (a) a service lead or message required handoff and every notification channel currently enabled for the tool completed successfully; or (b) the call was informational, FAQ-only, or safety-only and no lead handoff was appropriate. A deliberately disabled owner channel does not count as a failure. False for a failed enabled channel, duplicated call, or falsely claimed handoff.";
const callTypeSchema = { type: "string", enum: ["service_lead", "informational_faq", "message", "safety_only", "other"], description: "The primary purpose of the call." };

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "calls", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function callTime(call) {
  return new Date(call?.createdAt || call?.startedAt || 0).getTime() || 0;
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

function outputByName(outputs, name) {
  const matches = outputs.filter((item) => item?.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${name}; found ${matches.length}.`);
  return matches[0];
}

function mutableOutput(output) {
  return {
    name: output.name,
    description: output.description,
    type: output.type,
    schema: output.schema,
    assistantIds: output.assistantIds,
  };
}

async function latestCallId(phoneId) {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const calls = listFrom(await request(`/call?limit=100&createdAtGt=${encodeURIComponent(since)}`))
    .sort((left, right) => callTime(right) - callTime(left));
  for (const candidate of calls) {
    const id = String(candidate?.id || candidate?.callId || "").trim();
    if (!id) continue;
    const detail = await request(`/call/${encodeURIComponent(id)}`);
    if (String(detail?.phoneNumberId || detail?.phoneNumber?.id || "") === phoneId || phoneNumber(detail?.phoneNumber) === targetPhone) return id;
  }
  return "";
}

function previewResult(payload) {
  if (typeof payload?.result === "boolean") return payload.result;
  if (typeof payload?.structuredOutput?.result === "boolean") return payload.structuredOutput.result;
  for (const item of listFrom(payload, ["outputs"])) {
    if (typeof item?.result === "boolean") return item.result;
  }
  return null;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (apply && confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  const phoneId = String(phone?.id || phone?.phoneNumberId || "").trim();
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!phoneId || !assistantId) throw new Error("The Grimsby phone or assistant was not found.");
  const assignedPhones = phones.filter((record) => String(record?.assistantId || record?.assistant?.id || "").trim() === assistantId).map(phoneNumber).filter(Boolean);
  if (assignedPhones.length !== 1 || assignedPhones[0] !== targetPhone) throw new Error(`Refusing to patch a shared assistant: ${assignedPhones.join(", ") || "none"}.`);

  const [assistant, outputsPayload, scorecardsPayload] = await Promise.all([
    request(`/assistant/${encodeURIComponent(assistantId)}`),
    request("/structured-output?limit=1000"),
    request("/observability/scorecard?limit=1000"),
  ]);
  const outputs = listFrom(outputsPayload, ["structuredOutputs", "structured_outputs"]);
  const lead = outputByName(outputs, names.lead);
  const intake = outputByName(outputs, names.intake);
  const handoff = outputByName(outputs, names.handoff);
  const scorecard = outputByName(listFrom(scorecardsPayload, ["scorecards"]), names.scorecard);
  const attachedOutputIds = assistant?.artifactPlan?.structuredOutputIds || [];
  const attachedScorecardIds = assistant?.artifactPlan?.scorecardIds || [];
  if (![lead.id, intake.id, handoff.id].every((id) => attachedOutputIds.includes(id)) || !attachedScorecardIds.includes(scorecard.id)) {
    throw new Error("The expected Grimsby outputs or scorecard are not attached to the assistant.");
  }
  const scorecardMetricIds = (scorecard?.metrics || []).map((metric) => metric?.structuredOutputId);
  if (![intake.id, handoff.id].every((id) => scorecardMetricIds.includes(id))) throw new Error("The Grimsby scorecard does not reference both conditional quality outputs.");

  const nextLeadSchema = {
    ...(lead.schema || {}),
    properties: { ...(lead?.schema?.properties || {}), callType: callTypeSchema },
  };
  const currentCallType = lead?.schema?.properties?.callType || null;
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    targetPhoneLast4: targetPhone.slice(-4),
    assistantIdHash: hash(assistantId),
    assignedPhoneCount: assignedPhones.length,
    callTypeFieldCurrent: Boolean(currentCallType),
    callTypeFieldTarget: true,
    intakeCallTypeAwareCurrent: intake?.description === intakeDescription,
    intakeCallTypeAwareTarget: true,
    handoffCallTypeAwareCurrent: handoff?.description === handoffDescription,
    handoffCallTypeAwareTarget: true,
    scorecardIdPreserved: true,
  }, null, 2));
  if (!apply) return;

  const backupDir = path.join(process.cwd(), "diagnostics", "vapi-grimsby-electric");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `call-type-quality-before-${stamp}.json`);
  const resultPath = path.join(backupDir, `call-type-quality-result-${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), phone, assistant, lead, intake, handoff, scorecard }, null, 2)}\n`, { flag: "wx" });

  const patched = [];
  try {
    await request(`/structured-output/${encodeURIComponent(lead.id)}`, { method: "PATCH", body: { schema: nextLeadSchema } });
    patched.push(lead);
    await request(`/structured-output/${encodeURIComponent(intake.id)}`, { method: "PATCH", body: { description: intakeDescription } });
    patched.push(intake);
    await request(`/structured-output/${encodeURIComponent(handoff.id)}`, { method: "PATCH", body: { description: handoffDescription } });
    patched.push(handoff);

    const [verifiedLead, verifiedIntake, verifiedHandoff, verifiedScorecard] = await Promise.all([
      request(`/structured-output/${encodeURIComponent(lead.id)}`),
      request(`/structured-output/${encodeURIComponent(intake.id)}`),
      request(`/structured-output/${encodeURIComponent(handoff.id)}`),
      request(`/observability/scorecard/${encodeURIComponent(scorecard.id)}`),
    ]);
    const verifiedCallType = verifiedLead?.schema?.properties?.callType || {};
    const checks = {
      callTypeSchemaInstalled: verifiedCallType.type === callTypeSchema.type
        && verifiedCallType.description === callTypeSchema.description
        && JSON.stringify([...(verifiedCallType.enum || [])].sort()) === JSON.stringify([...callTypeSchema.enum].sort()),
      intakeCallTypeAware: verifiedIntake?.description === intakeDescription,
      handoffCallTypeAware: verifiedHandoff?.description === handoffDescription,
      outputIdsPreserved: verifiedLead.id === lead.id && verifiedIntake.id === intake.id && verifiedHandoff.id === handoff.id,
      scorecardIdPreserved: verifiedScorecard.id === scorecard.id,
      scorecardMetricsPreserved: [intake.id, handoff.id].every((id) => (verifiedScorecard?.metrics || []).some((metric) => metric?.structuredOutputId === id)),
    };
    const callId = await latestCallId(phoneId);
    const previews = { intake: null, handoff: null };
    const previewWarnings = [];
    if (callId) {
      for (const [key, output] of [["intake", intake], ["handoff", handoff]]) {
        try {
          const preview = await request("/structured-output/run", { method: "POST", body: { callIds: [callId], previewEnabled: true, structuredOutputId: output.id } });
          previews[key] = previewResult(preview);
          if (previews[key] == null) previewWarnings.push(`${key} preview returned an unrecognized response shape`);
        } catch (error) {
          previewWarnings.push(`${key} preview failed: ${error.message}`);
        }
      }
    } else {
      previewWarnings.push("no recent Grimsby call was available for preview");
    }
    const healthy = Object.values(checks).every(Boolean);
    const result = { applied: true, verified: healthy, assistantIdHash: hash(assistantId), checks, latestFaqPreview: previews, previewWarnings, backupPath, resultPath };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ ...result, backupPath: path.relative(process.cwd(), backupPath), resultPath: path.relative(process.cwd(), resultPath) }, null, 2));
    if (!healthy) throw new Error("Live read-back did not verify every call-type quality change.");
  } catch (error) {
    for (const original of patched.reverse()) {
      await request(`/structured-output/${encodeURIComponent(original.id)}`, { method: "PATCH", body: mutableOutput(original) }).catch(() => {});
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
