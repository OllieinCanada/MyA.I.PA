const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");
const {
  OUTPUT_DEFINITIONS,
  SCORECARD_NAME,
  buildArtifactPlan,
  extractStructuredOutputPreviewResult,
  expectedOutputPayload,
  resourceMatches,
  sameJson,
  scorecardMatches,
  scorecardPayload,
  unique,
} = require("../server/deanComplaintQuality");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12892057487";
const expectedAssistantName = "My AI PA — Dean Allison Private Demo";
const requiredPromptMarker = "## MY AI PA UNOFFICIAL CONSTITUENCY DEMO POLICY v2";
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "DEAN-COMPLAINT-QUALITY-V1";

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

function assistantId(record) {
  return String(record?.assistantId || record?.assistant?.id || "").trim();
}

function systemPrompt(assistant) {
  return (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "";
}

function callTime(call) {
  return new Date(call?.createdAt || call?.startedAt || 0).getTime() || 0;
}

async function request(pathname, { method = "GET", body, allow404 = false } = {}) {
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
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    const detail = payload.message || payload.error || payload.text || "request failed";
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return payload;
}

async function safeDelete(pathname) {
  try { await request(pathname, { method: "DELETE", allow404: true }); } catch (error) { console.error(`Rollback warning: ${error.message}`); }
}

function safePreviewSummary(definition, result) {
  if (definition.schema.type === "boolean") return { evaluated: typeof result === "boolean", result: typeof result === "boolean" ? result : null };
  if (!result || typeof result !== "object" || Array.isArray(result)) return { evaluated: false, populatedFields: [] };
  const allowedOperationalFields = ["callType", "initialTone", "finalTone", "urgency", "smsDeliveryOutcome", "officialOfficeReferralNeeded", "sensitiveInformationOffered"];
  return {
    evaluated: true,
    populatedFields: Object.keys(result).filter((key) => result[key] !== undefined && result[key] !== null && result[key] !== ""),
    operationalValues: Object.fromEntries(allowedOperationalFields.filter((key) => Object.prototype.hasOwnProperty.call(result, key)).map((key) => [key, result[key]])),
    missingDetailCount: Array.isArray(result.missingDetails) ? result.missingDetails.length : null,
  };
}

async function latestCallId(phoneId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const calls = listFrom(await request(`/call?limit=100&createdAtGt=${encodeURIComponent(since)}`), ["calls"])
    .sort((left, right) => callTime(right) - callTime(left));
  for (const candidate of calls) {
    const id = String(candidate?.id || candidate?.callId || "").trim();
    if (!id) continue;
    const detail = await request(`/call/${encodeURIComponent(id)}`);
    if (String(detail?.phoneNumberId || detail?.phoneNumber?.id || "") === phoneId || phoneNumber(detail?.phoneNumber) === targetPhone) return id;
  }
  return "";
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (apply && confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const target = phones.find((record) => phoneNumber(record) === targetPhone);
  const phoneId = String(target?.id || target?.phoneNumberId || "").trim();
  const targetAssistantId = assistantId(target);
  if (!phoneId || !targetAssistantId) throw new Error("The Dean private-demo phone or assistant was not found.");
  const assignedPhones = phones.filter((record) => assistantId(record) === targetAssistantId).map(phoneNumber).filter(Boolean);
  if (assignedPhones.length !== 1 || assignedPhones[0] !== targetPhone) {
    throw new Error(`Refusing to patch a shared assistant. Assigned phones: ${assignedPhones.join(", ") || "none"}.`);
  }

  const [assistant, outputPayload, scorecardPayloadResponse] = await Promise.all([
    request(`/assistant/${encodeURIComponent(targetAssistantId)}`),
    request("/structured-output?limit=1000"),
    request("/observability/scorecard?limit=1000"),
  ]);
  const prompt = systemPrompt(assistant);
  if (assistant.name !== expectedAssistantName || !prompt.startsWith(requiredPromptMarker)) {
    throw new Error("Refusing to upgrade an unexpected assistant or playbook version.");
  }
  const currentToolIds = unique(assistant?.model?.toolIds);
  if (!currentToolIds.some((id) => id)) throw new Error("Refusing to upgrade an assistant with no attached tools.");

  const allOutputs = listFrom(outputPayload, ["structuredOutputs", "structured_outputs"]);
  const allScorecards = listFrom(scorecardPayloadResponse, ["scorecards"]);
  const duplicateOutputs = OUTPUT_DEFINITIONS
    .map((definition) => ({ name: definition.name, count: allOutputs.filter((item) => item?.name === definition.name).length }))
    .filter((item) => item.count > 1);
  if (duplicateOutputs.length) throw new Error(`Duplicate Dean structured outputs found: ${duplicateOutputs.map((item) => item.name).join(", ")}.`);
  const matchingScorecards = allScorecards.filter((item) => item?.name === SCORECARD_NAME);
  if (matchingScorecards.length > 1) throw new Error(`Duplicate ${SCORECARD_NAME} scorecards found.`);

  const plannedOutputs = OUTPUT_DEFINITIONS.map((definition) => {
    const existing = allOutputs.find((item) => item?.name === definition.name) || null;
    const payload = expectedOutputPayload(definition, targetAssistantId);
    return { definition, existing, payload, action: existing ? (resourceMatches(existing, payload) ? "reuse" : "conflict") : "create" };
  });
  const outputConflicts = plannedOutputs.filter((item) => item.action === "conflict");
  if (outputConflicts.length) throw new Error(`Existing Dean quality outputs differ from the approved definitions: ${outputConflicts.map((item) => item.definition.name).join(", ")}.`);

  const existingOutputByKey = Object.fromEntries(plannedOutputs.filter((item) => item.existing).map((item) => [item.definition.key, item.existing]));
  let scorecardAction = "create";
  if (matchingScorecards.length && Object.keys(existingOutputByKey).length === OUTPUT_DEFINITIONS.length) {
    scorecardAction = scorecardMatches(matchingScorecards[0], scorecardPayload(existingOutputByKey, targetAssistantId)) ? "reuse" : "conflict";
  } else if (matchingScorecards.length) {
    scorecardAction = "validate-after-output-resolution";
  }
  if (scorecardAction === "conflict") throw new Error(`Existing ${SCORECARD_NAME} differs from the approved definition.`);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    targetPhoneLast4: targetPhone.slice(-4),
    assistantIdHash: hash(targetAssistantId),
    assignedPhoneCount: assignedPhones.length,
    outputActions: Object.fromEntries(plannedOutputs.map((item) => [item.definition.key, item.action])),
    scorecardAction,
    scorecardPoints: 100,
    recordingPolicyChange: false,
    modelOrVoiceChange: false,
  }, null, 2));
  if (!apply) return;

  const diagnosticDir = path.join(process.cwd(), "diagnostics", "dean-allison-live");
  fs.mkdirSync(diagnosticDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(diagnosticDir, `complaint-quality-before-${stamp}.json`);
  const resultPath = path.join(diagnosticDir, `complaint-quality-result-${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    targetPhoneLast4: targetPhone.slice(-4),
    assistantIdHash: hash(targetAssistantId),
    artifactPlan: assistant.artifactPlan || {},
    matchingStructuredOutputIds: plannedOutputs.map((item) => item.existing?.id).filter(Boolean),
    matchingScorecardIds: matchingScorecards.map((item) => item.id),
  }, null, 2)}\n`, { flag: "wx" });

  const createdOutputIds = [];
  let createdScorecardId = "";
  let assistantPatched = false;
  try {
    const outputByKey = {};
    for (const item of plannedOutputs) {
      const resource = item.existing || await request("/structured-output", { method: "POST", body: item.payload });
      if (!item.existing) createdOutputIds.push(resource.id);
      outputByKey[item.definition.key] = resource;
    }

    const desiredScorecard = scorecardPayload(outputByKey, targetAssistantId);
    let scorecard = matchingScorecards[0] || null;
    if (scorecard && !scorecardMatches(scorecard, desiredScorecard)) throw new Error(`Existing ${SCORECARD_NAME} differs from the approved definition.`);
    if (!scorecard) {
      scorecard = await request("/observability/scorecard", { method: "POST", body: desiredScorecard });
      createdScorecardId = scorecard.id;
    }

    const structuredOutputIds = OUTPUT_DEFINITIONS.map((definition) => outputByKey[definition.key].id);
    const artifactPlan = buildArtifactPlan(assistant.artifactPlan, structuredOutputIds, scorecard.id);
    await request(`/assistant/${encodeURIComponent(targetAssistantId)}`, { method: "PATCH", body: { artifactPlan } });
    assistantPatched = true;

    const [verifiedAssistant, verifiedScorecard, ...verifiedOutputs] = await Promise.all([
      request(`/assistant/${encodeURIComponent(targetAssistantId)}`),
      request(`/observability/scorecard/${encodeURIComponent(scorecard.id)}`),
      ...structuredOutputIds.map((id) => request(`/structured-output/${encodeURIComponent(id)}`)),
    ]);
    const checks = {
      dedicatedPhone: assignedPhones.length === 1 && assignedPhones[0] === targetPhone,
      playbookPreserved: systemPrompt(verifiedAssistant).startsWith(requiredPromptMarker),
      modelPreserved: verifiedAssistant?.model?.model === assistant?.model?.model && verifiedAssistant?.model?.provider === assistant?.model?.provider,
      voicePreserved: verifiedAssistant?.voice?.provider === assistant?.voice?.provider && verifiedAssistant?.voice?.voiceId === assistant?.voice?.voiceId,
      toolIdsPreserved: sameJson(unique(verifiedAssistant?.model?.toolIds).sort(), currentToolIds.slice().sort()),
      recordingPreserved: verifiedAssistant?.artifactPlan?.recordingEnabled === assistant?.artifactPlan?.recordingEnabled,
      outputsAttached: structuredOutputIds.every((id) => (verifiedAssistant?.artifactPlan?.structuredOutputIds || []).includes(id)),
      scorecardAttached: (verifiedAssistant?.artifactPlan?.scorecardIds || []).includes(scorecard.id),
      outputDefinitionsVerified: verifiedOutputs.every((resource, index) => resourceMatches(resource, expectedOutputPayload(OUTPUT_DEFINITIONS[index], targetAssistantId))),
      scorecardVerified: scorecardMatches(verifiedScorecard, desiredScorecard),
    };
    const healthy = Object.values(checks).every(Boolean);

    const callId = await latestCallId(phoneId);
    const preview = {};
    const previewWarnings = [];
    if (callId) {
      for (const definition of OUTPUT_DEFINITIONS) {
        try {
          const response = await request("/structured-output/run", {
            method: "POST",
            body: { callIds: [callId], previewEnabled: true, structuredOutputId: outputByKey[definition.key].id },
          });
          preview[definition.key] = safePreviewSummary(definition, extractStructuredOutputPreviewResult(response));
          if (!preview[definition.key].evaluated) previewWarnings.push(`${definition.key} preview returned no recognized result`);
        } catch (error) {
          preview[definition.key] = { evaluated: false };
          previewWarnings.push(`${definition.key} preview failed: ${String(error.message || error).slice(0, 180)}`);
        }
      }
    } else {
      previewWarnings.push("no Dean private-demo call from the last 24 hours was available for preview");
    }

    const result = {
      applied: true,
      verified: healthy,
      targetPhoneLast4: targetPhone.slice(-4),
      assistantIdHash: hash(targetAssistantId),
      createdStructuredOutputCount: createdOutputIds.length,
      createdScorecard: Boolean(createdScorecardId),
      checks,
      latestCallPreview: preview,
      previewWarnings,
      backupPath: path.relative(process.cwd(), backupPath),
      resultPath: path.relative(process.cwd(), resultPath),
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify(result, null, 2));
    if (!healthy) throw new Error("Live read-back did not verify every complaint-quality change.");
  } catch (error) {
    if (assistantPatched) {
      await request(`/assistant/${encodeURIComponent(targetAssistantId)}`, {
        method: "PATCH",
        body: { artifactPlan: assistant.artifactPlan || {} },
      }).catch((rollbackError) => console.error(`Assistant rollback warning: ${rollbackError.message}`));
    }
    if (createdScorecardId) await safeDelete(`/observability/scorecard/${encodeURIComponent(createdScorecardId)}`);
    for (const id of createdOutputIds.reverse()) await safeDelete(`/structured-output/${encodeURIComponent(id)}`);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
