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
const confirmationPhrase = "GRIMSBY-VAPI-UPGRADE-6809";
const requiredPromptMarker = "## GRIMSBY ELECTRIC WEBSITE-TAILORED OVERRIDE v1";
const isolatedToolMarker = "send_call_summaries_pilot_6809_v1";
const scorecardName = "Grimsby Call Quality v1";

const outputDefinitions = [
  {
    key: "lead",
    name: "Grimsby Lead Intake v1",
    description: "Extracts the useful lead details stated during a Grimsby Electric call without inventing missing information.",
    schema: {
      type: "object",
      properties: {
        callType: { type: "string", enum: ["service_lead", "informational_faq", "message", "safety_only", "other"], description: "The primary purpose of the call." },
        callerName: { type: "string", description: "The caller's name, only if stated." },
        callbackNumber: { type: "string", description: "The best callback number, only if stated or available from trusted call context." },
        serviceAddress: { type: "string", description: "The electrical service address, only if stated." },
        city: { type: "string", description: "The service city, only if stated." },
        customerType: { type: "string", enum: ["residential", "commercial", "industrial", "unknown"], description: "The job context." },
        reasonForCall: { type: "string", description: "A concise description of the electrical work or problem." },
        safetyConcern: { type: "string", description: "Any immediate safety concern mentioned by the caller." },
        preferredStartDate: { type: "string", description: "The caller's preferred start date or timing, not a confirmed appointment." },
        preferredCallbackTime: { type: "string", description: "The caller's preferred callback time." },
        siteName: { type: "string", description: "Company or site name for commercial or industrial work, if stated." },
        operationsAffected: { type: "boolean", description: "Whether the caller said business operations are affected." },
        followUpNeeded: { type: "boolean", description: "Whether Grimsby Electric should follow up." },
      },
      additionalProperties: false,
    },
  },
  {
    key: "intake",
    name: "Grimsby Intake Complete v1",
    description: "True when either: (a) a service lead or message requiring follow-up captured the caller's name, callback route, service location when relevant, reason for calling, preferred timing, and callback preference; or (b) the call was informational, FAQ-only, or safety-only and lead intake was not appropriate. Do not penalize a successful informational call for correctly skipping lead intake.",
    schema: { type: "boolean" },
  },
  {
    key: "claims",
    name: "Grimsby Claims Safe v1",
    description: "True only when the assistant avoided unsupported promises or claims about price, free quotes, scheduling, emergency dispatch, insurance, warranties, permits, or outcomes.",
    schema: { type: "boolean" },
  },
  {
    key: "safety",
    name: "Grimsby Electrical Safety v1",
    description: "True when the assistant avoided electrical troubleshooting and, if danger was mentioned, gave appropriate move-away and emergency or utility guidance. True when no safety issue occurred and no unsafe advice was given.",
    schema: { type: "boolean" },
  },
  {
    key: "handoff",
    name: "Grimsby SMS Handoff v1",
    description: "True when either: (a) a service lead or message required handoff and every notification channel currently enabled for the tool completed successfully; or (b) the call was informational, FAQ-only, or safety-only and no lead handoff was appropriate. A deliberately disabled owner channel does not count as a failure. False for a failed enabled channel, duplicated call, or falsely claimed handoff.",
    schema: { type: "boolean" },
  },
  {
    key: "heard",
    name: "Grimsby Caller Heard v1",
    description: "True when the assistant acknowledged the caller naturally, asked clear questions one at a time, and accurately recapped or responded without sounding dismissive or needlessly repetitive.",
    schema: { type: "boolean" },
  },
];

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function systemPrompt(assistant) {
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

function unique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
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

function expectedOutputPayload(definition, assistantId) {
  return {
    name: definition.name,
    description: definition.description,
    type: "ai",
    schema: definition.schema,
    assistantIds: [assistantId],
  };
}

function resourceMatches(resource, payload) {
  return resource?.name === payload.name
    && resource?.description === payload.description
    && (resource?.type || "ai") === payload.type
    && sameJson(resource?.schema, payload.schema)
    && unique(resource?.assistantIds).includes(payload.assistantIds[0]);
}

function scorecardPayload(outputByKey, assistantId) {
  const points = { intake: 25, claims: 25, safety: 20, handoff: 15, heard: 15 };
  return {
    name: scorecardName,
    description: "Automatically grades Grimsby Electric calls for complete intake, accurate claims, safe guidance, SMS handoff, and a caller-centred conversation.",
    metrics: Object.entries(points).map(([key, metricPoints]) => ({
      structuredOutputId: outputByKey[key].id,
      conditions: [{
        type: "comparator",
        comparator: "=",
        value: true,
        points: metricPoints,
      }],
    })),
    assistantIds: [assistantId],
  };
}

function scorecardMatches(resource, payload) {
  const compactMetrics = (metrics) => (metrics || []).map((metric) => ({
    structuredOutputId: metric.structuredOutputId,
    conditions: (metric.conditions || []).map((condition) => ({
      comparator: condition.comparator,
      value: condition.value,
      points: condition.points,
    })),
  }));
  return resource?.name === payload.name
    && resource?.description === payload.description
    && sameJson(compactMetrics(resource?.metrics), compactMetrics(payload.metrics))
    && unique(resource?.assistantIds).includes(payload.assistantIds[0]);
}

function buildAssistantPatch(assistant, structuredOutputIds, scorecardId) {
  const transcriber = {
    ...(assistant?.transcriber || {}),
    provider: "deepgram",
    model: "nova-3",
    language: "en",
    smartFormat: true,
    numerals: true,
    keyterm: [
      "Grimsby Electric",
      "Ron Cournoyer",
      "ECRA",
      "ESA",
      "ESafe certification",
      "Wellandport",
      "Dunnville",
      "Caistor Centre",
      "St. Catharines",
      "Stoney Creek",
      "Beamsville",
      "Fonthill",
      "Port Colborne",
      "panel upgrade",
      "machine safety",
      "network cabling",
    ],
  };
  const artifactPlan = {
    ...(assistant?.artifactPlan || {}),
    structuredOutputIds: unique([...(assistant?.artifactPlan?.structuredOutputIds || []), ...structuredOutputIds]),
    scorecardIds: unique([...(assistant?.artifactPlan?.scorecardIds || []), scorecardId]),
  };
  return {
    transcriber,
    backgroundSpeechDenoisingPlan: {
      ...(assistant?.backgroundSpeechDenoisingPlan || {}),
      smartDenoisingPlan: { enabled: true },
    },
    artifactPlan,
  };
}

async function safeDelete(pathname) {
  try { await request(pathname, { method: "DELETE", allow404: true }); } catch (error) { console.error(`Rollback warning: ${error.message}`); }
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (apply && confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const target = phones.find((record) => phoneNumber(record) === targetPhone);
  if (!target) throw new Error(`Vapi phone ${targetPhone} was not found.`);
  const assistantId = String(target?.assistantId || target?.assistant?.id || "").trim();
  if (!assistantId) throw new Error("Target Vapi phone has no assigned assistant.");
  const assignedPhones = phones
    .filter((record) => String(record?.assistantId || record?.assistant?.id || "").trim() === assistantId)
    .map(phoneNumber)
    .filter(Boolean);
  if (assignedPhones.length !== 1 || assignedPhones[0] !== targetPhone) {
    throw new Error(`Refusing to patch a shared assistant. Assigned phones: ${assignedPhones.join(", ") || "none"}.`);
  }

  const [assistant, outputPayload, scorecardPayloadResponse] = await Promise.all([
    request(`/assistant/${encodeURIComponent(assistantId)}`),
    request("/structured-output?limit=1000"),
    request("/observability/scorecard?limit=1000"),
  ]);
  const prompt = systemPrompt(assistant);
  if (!prompt.includes(requiredPromptMarker) || !prompt.includes(isolatedToolMarker)) {
    throw new Error("Refusing to upgrade: the Grimsby tailored prompt or isolated SMS marker is missing.");
  }
  const currentToolIds = unique(assistant?.model?.toolIds);
  if (!currentToolIds.length) throw new Error("Refusing to upgrade an assistant with no attached tool IDs.");

  const allOutputs = listFrom(outputPayload, ["structuredOutputs", "structured_outputs"]);
  const allScorecards = listFrom(scorecardPayloadResponse, ["scorecards"]);
  const duplicateNames = outputDefinitions
    .map((definition) => ({ name: definition.name, count: allOutputs.filter((item) => item?.name === definition.name).length }))
    .filter((item) => item.count > 1);
  if (duplicateNames.length) throw new Error(`Duplicate Grimsby structured outputs found: ${duplicateNames.map((item) => `${item.name} (${item.count})`).join(", ")}.`);
  const matchingScorecards = allScorecards.filter((item) => item?.name === scorecardName);
  if (matchingScorecards.length > 1) throw new Error(`Duplicate ${scorecardName} scorecards found.`);

  const plannedOutputs = outputDefinitions.map((definition) => {
    const existing = allOutputs.find((item) => item?.name === definition.name) || null;
    const payload = expectedOutputPayload(definition, assistantId);
    return { definition, existing, payload, action: existing ? (resourceMatches(existing, payload) ? "reuse" : "conflict") : "create" };
  });
  const conflicts = plannedOutputs.filter((item) => item.action === "conflict");
  if (conflicts.length) throw new Error(`Existing structured outputs differ from the approved definitions: ${conflicts.map((item) => item.definition.name).join(", ")}.`);
  const existingOutputByKey = Object.fromEntries(
    plannedOutputs.filter((item) => item.existing).map((item) => [item.definition.key, item.existing]),
  );
  let plannedScorecardAction = "create";
  if (matchingScorecards.length && Object.keys(existingOutputByKey).length === outputDefinitions.length) {
    plannedScorecardAction = scorecardMatches(matchingScorecards[0], scorecardPayload(existingOutputByKey, assistantId)) ? "reuse" : "conflict";
  } else if (matchingScorecards.length) {
    plannedScorecardAction = "validate-after-output-resolution";
  }
  if (plannedScorecardAction === "conflict") throw new Error(`Existing ${scorecardName} differs from the approved scorecard definition.`);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    targetPhoneLast4: targetPhone.slice(-4),
    assistantIdHash: hash(assistantId),
    assignedPhoneCount: assignedPhones.length,
    currentToolCount: currentToolIds.length,
    outputActions: Object.fromEntries(plannedOutputs.map((item) => [item.definition.key, item.action])),
    scorecardAction: plannedScorecardAction,
    assistantChanges: ["Deepgram Nova-3 keyterms", "smart number/date formatting", "Krisp smart denoising", "structured lead extraction", "automatic call scorecard"],
    managedVoiceAutoFallback: assistant?.voice?.provider === "vapi",
    recordingPolicyChange: false,
  }, null, 2));
  if (!apply) return;

  const backupDir = path.join(process.cwd(), "diagnostics", "vapi-grimsby-electric");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `upgrade-before-${stamp}.json`);
  const resultPath = path.join(backupDir, `upgrade-result-${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    targetPhone,
    phone: target,
    assistant,
    matchingStructuredOutputs: plannedOutputs.map((item) => item.existing).filter(Boolean),
    matchingScorecards,
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

    const desiredScorecard = scorecardPayload(outputByKey, assistantId);
    let scorecard = matchingScorecards[0] || null;
    if (scorecard && !scorecardMatches(scorecard, desiredScorecard)) {
      throw new Error(`Existing ${scorecardName} differs from the approved scorecard definition.`);
    }
    if (!scorecard) {
      scorecard = await request("/observability/scorecard", { method: "POST", body: desiredScorecard });
      createdScorecardId = scorecard.id;
    }

    const structuredOutputIds = outputDefinitions.map((definition) => outputByKey[definition.key].id);
    const patch = buildAssistantPatch(assistant, structuredOutputIds, scorecard.id);
    await request(`/assistant/${encodeURIComponent(assistantId)}`, { method: "PATCH", body: patch });
    assistantPatched = true;

    const [verified, verifiedScorecard, ...verifiedOutputs] = await Promise.all([
      request(`/assistant/${encodeURIComponent(assistantId)}`),
      request(`/observability/scorecard/${encodeURIComponent(scorecard.id)}`),
      ...structuredOutputIds.map((id) => request(`/structured-output/${encodeURIComponent(id)}`)),
    ]);
    const verifiedPrompt = systemPrompt(verified);
    const verifiedToolIds = unique(verified?.model?.toolIds);
    const checks = {
      assignedOnlyTo6809: assignedPhones.length === 1 && assignedPhones[0] === targetPhone,
      tailoredPromptPreserved: verifiedPrompt.includes(requiredPromptMarker),
      isolatedSmsPromptPreserved: verifiedPrompt.includes(isolatedToolMarker),
      toolIdsPreserved: sameJson(currentToolIds.slice().sort(), verifiedToolIds.slice().sort()),
      nova3Preserved: verified?.transcriber?.provider === "deepgram" && verified?.transcriber?.model === "nova-3",
      keytermsInstalled: outputDefinitions.length > 0 && ["Grimsby Electric", "Ron Cournoyer", "ESafe certification"].every((term) => (verified?.transcriber?.keyterm || []).includes(term)),
      smartFormattingEnabled: verified?.transcriber?.smartFormat === true && verified?.transcriber?.numerals === true,
      smartDenoisingEnabled: verified?.backgroundSpeechDenoisingPlan?.smartDenoisingPlan?.enabled === true,
      managedVoiceAutoFallbackPreserved: verified?.voice?.provider === "vapi"
        && verified?.voice?.voiceId === assistant?.voice?.voiceId
        && verified?.voice?.version === assistant?.voice?.version,
      outputsAttached: structuredOutputIds.every((id) => (verified?.artifactPlan?.structuredOutputIds || []).includes(id)),
      scorecardAttached: (verified?.artifactPlan?.scorecardIds || []).includes(scorecard.id),
      outputDefinitionsVerified: verifiedOutputs.every((resource, index) => resourceMatches(resource, expectedOutputPayload(outputDefinitions[index], assistantId))),
      scorecardVerified: scorecardMatches(verifiedScorecard, desiredScorecard),
      recordingPolicyUntouched: !Object.prototype.hasOwnProperty.call(patch.artifactPlan, "recordingEnabled")
        && !Object.prototype.hasOwnProperty.call(patch.artifactPlan, "videoRecordingEnabled"),
    };
    const healthy = Object.values(checks).every(Boolean);
    const result = {
      applied: true,
      verified: healthy,
      targetPhone,
      assistantIdHash: hash(assistantId),
      structuredOutputIdHashes: Object.fromEntries(outputDefinitions.map((definition) => [definition.key, hash(outputByKey[definition.key].id)])),
      scorecardIdHash: hash(scorecard.id),
      createdStructuredOutputCount: createdOutputIds.length,
      createdScorecard: Boolean(createdScorecardId),
      checks,
      backupPath,
      resultPath,
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ ...result, backupPath: path.relative(process.cwd(), backupPath), resultPath: path.relative(process.cwd(), resultPath) }, null, 2));
    if (!healthy) throw new Error("Live read-back did not pass every verification check.");
  } catch (error) {
    if (assistantPatched) {
      try {
        await request(`/assistant/${encodeURIComponent(assistantId)}`, {
          method: "PATCH",
          body: {
            transcriber: assistant.transcriber,
            voice: assistant.voice,
            backgroundSpeechDenoisingPlan: assistant.backgroundSpeechDenoisingPlan || {},
            artifactPlan: assistant.artifactPlan || {},
          },
        });
      } catch (rollbackError) {
        console.error(`Assistant rollback warning: ${rollbackError.message}`);
      }
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
