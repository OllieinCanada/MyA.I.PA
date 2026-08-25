const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function phoneLast4(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : "unknown";
}

function assistantIdFromPhone(phone = {}) {
  return String(phone.assistantId || phone.assistant?.id || "").trim();
}

function modelLabel(config = {}) {
  return [config.provider, config.model].filter(Boolean).join("/") || "not configured";
}

function voiceLabel(voice = {}) {
  const base = [voice.provider, voice.voiceId || voice.model].filter(Boolean).join("/") || "not configured";
  return voice.provider === "vapi" ? `${base}/v${Number(voice.version || 1)}` : base;
}

function assistantRole(assistant = {}) {
  const name = String(assistant.name || "");
  return /(?:scenario caller|recorded demo|controlled qa|pricing test|\btest\b)/i.test(name)
    ? "synthetic-demo"
    : "customer-facing";
}

function isVapiVoiceV2(assistant = {}) {
  return assistant?.voice?.provider !== "vapi" || Number(assistant?.voice?.version || 1) >= 2;
}

function hasPublishedVersion(assistant = {}) {
  return /^v\d+$/i.test(String(assistant.latestVersion || "").trim());
}

function hasSecurityFilters(assistant = {}) {
  const plan = assistant?.compliancePlan?.securityFilterPlan;
  return plan?.enabled === true && Array.isArray(plan.filters) && plan.filters.length > 0;
}

function hasTranscriptArtifacts(assistant = {}) {
  return assistant?.artifactPlan?.transcriptPlan?.enabled !== false;
}

function hasCallEvidence(assistant = {}) {
  const plan = assistant?.artifactPlan;
  return Boolean(plan && plan.loggingEnabled !== false && hasTranscriptArtifacts(assistant));
}

function hasSmartEndpointing(assistant = {}) {
  return Boolean(assistant?.startSpeakingPlan?.smartEndpointingPlan?.provider);
}

function hasIdleHook(assistant = {}) {
  return Array.isArray(assistant.hooks) && assistant.hooks.some((hook) => hook?.on === "customer.speech.timeout");
}

function voiceFallbackCount(assistant = {}) {
  return Array.isArray(assistant?.voice?.fallbackPlan?.voices)
    ? assistant.voice.fallbackPlan.voices.length
    : 0;
}

function transcriberFallbackState(assistant = {}) {
  const plan = assistant?.transcriber?.fallbackPlan;
  return {
    manualCount: Array.isArray(plan?.transcribers) ? plan.transcribers.length : 0,
    autoEnabled: plan?.autoFallback?.enabled === true,
  };
}

function isMonitorActive(monitor = {}) {
  if (monitor.active === false || monitor.enabled === false || monitor.status === "disabled") return false;
  return true;
}

function monitorCoversAssistant(monitor = {}, assistantId) {
  const targets = monitor.targets;
  if (targets === "*" || targets?.type === "all") return true;
  if (!Array.isArray(targets)) return false;
  return targets.some((target) =>
    target === "*" ||
    String(target?.id || target?.assistantId || target || "") === String(assistantId)
  );
}

function suiteCoversAssistant(suite = {}, assistantId) {
  return Array.isArray(suite.targetAssignments) && suite.targetAssignments.some((target) =>
    target?.targetType === "assistant" && String(target?.targetId || "") === String(assistantId)
  );
}

function evaluateAssistantReadiness(assistant = {}, context = {}) {
  const id = String(assistant.id || "");
  const role = assistantRole(assistant);
  const structuredOutputIds = Array.isArray(assistant?.artifactPlan?.structuredOutputIds)
    ? assistant.artifactPlan.structuredOutputIds
    : [];
  const scorecardIds = Array.isArray(assistant?.artifactPlan?.scorecardIds)
    ? assistant.artifactPlan.scorecardIds
    : [];
  const transcriberFallback = transcriberFallbackState(assistant);
  const voiceFallbacks = voiceFallbackCount(assistant);
  const simulations = (context.simulationSuites || []).filter((suite) => suiteCoversAssistant(suite, id));
  const monitors = (context.monitors || []).filter((monitor) =>
    isMonitorActive(monitor) && monitorCoversAssistant(monitor, id)
  );
  const issues = [];

  if (!hasCallEvidence(assistant)) {
    issues.push({ level: "high", key: "call-evidence", message: "Transcript/log artifact evidence is not explicitly enabled." });
  }
  if (!hasSecurityFilters(assistant)) {
    issues.push({
      level: role === "customer-facing" ? "high" : "medium",
      key: "security-filters",
      message: "Vapi security filters are not explicitly enabled.",
    });
  }
  if (structuredOutputIds.length === 0) {
    issues.push({ level: "medium", key: "structured-outputs", message: "No structured outputs are attached for automatic lead extraction." });
  }
  if (scorecardIds.length === 0) {
    issues.push({ level: "medium", key: "scorecards", message: "No automatic call-quality scorecard is attached." });
  }
  if (simulations.length === 0) {
    issues.push({ level: "medium", key: "simulations", message: "No Vapi simulation suite targets this active assistant." });
  }
  if (monitors.length === 0) {
    issues.push({ level: "medium", key: "monitoring", message: "No active Vapi monitor covers this assistant." });
  }
  if (!hasSmartEndpointing(assistant)) {
    issues.push({ level: "review", key: "smart-endpointing", message: "Smart endpointing is not configured; test before changing turn timing." });
  }
  if (!hasIdleHook(assistant)) {
    issues.push({ level: "review", key: "idle-hook", message: "No customer-silence hook is configured; test wording and timeout before rollout." });
  }
  if (voiceFallbacks === 0) {
    issues.push({ level: "review", key: "voice-fallback", message: "No fallback voice is configured; a primary TTS outage can end the call." });
  }
  if (transcriberFallback.manualCount === 0 && !transcriberFallback.autoEnabled) {
    issues.push({ level: "review", key: "transcriber-fallback", message: "No transcriber fallback is configured; provider/privacy approval is required before enabling one." });
  }
  if (!isVapiVoiceV2(assistant)) {
    issues.push({ level: "review", key: "vapi-voice-v2", message: "This assistant still uses Vapi Voice V1; pilot V2 before changing its established voice." });
  }
  if (!hasPublishedVersion(assistant)) {
    issues.push({ level: "review", key: "versioning", message: "No published Vapi assistant version is reported; confirm versioning rollout before relying on draft/publish automation." });
  }

  return {
    assistantIdHash: shortHash(id),
    assistantName: String(assistant.name || "Unnamed assistant").slice(0, 120),
    role,
    phones: (context.phones || []).map((phone) => phoneLast4(phone.number || phone.phoneNumber)),
    pipeline: {
      transcriber: modelLabel(assistant.transcriber),
      model: modelLabel(assistant.model),
      voice: voiceLabel(assistant.voice),
    },
    evidence: {
      transcriptAndLogs: hasCallEvidence(assistant),
      structuredOutputs: structuredOutputIds.length,
      scorecards: scorecardIds.length,
    },
    runtime: {
      securityFilters: hasSecurityFilters(assistant),
      smartEndpointing: hasSmartEndpointing(assistant),
      idleHook: hasIdleHook(assistant),
      maxDurationSeconds: Number(assistant.maxDurationSeconds || 0) || null,
      voiceFallbacks,
      vapiVoiceV2: isVapiVoiceV2(assistant),
      transcriberFallback,
      publishedVersion: hasPublishedVersion(assistant) ? assistant.latestVersion : null,
    },
    observability: {
      simulationSuites: simulations.length,
      activeMonitors: monitors.length,
    },
    issues,
  };
}

function summarize(reports = []) {
  const count = (predicate) => reports.filter(predicate).length;
  const allIssues = reports.flatMap((report) => report.issues);
  const issueCounts = allIssues.reduce((counts, issue) => {
    counts[issue.key] = (counts[issue.key] || 0) + 1;
    return counts;
  }, {});
  return {
    activeAssistants: reports.length,
    customerFacingAssistants: count((item) => item.role === "customer-facing"),
    syntheticDemoAssistants: count((item) => item.role === "synthetic-demo"),
    withTranscriptAndLogs: count((item) => item.evidence.transcriptAndLogs),
    withStructuredOutputs: count((item) => item.evidence.structuredOutputs > 0),
    withScorecards: count((item) => item.evidence.scorecards > 0),
    coveredBySimulations: count((item) => item.observability.simulationSuites > 0),
    coveredByMonitoring: count((item) => item.observability.activeMonitors > 0),
    withSmartEndpointing: count((item) => item.runtime.smartEndpointing),
    withIdleHooks: count((item) => item.runtime.idleHook),
    withVoiceFallbacks: count((item) => item.runtime.voiceFallbacks > 0),
    vapiVoiceAssistants: count((item) => item.pipeline.voice.startsWith("vapi/")),
    withVapiVoiceV2: count((item) => item.pipeline.voice.startsWith("vapi/") && item.runtime.vapiVoiceV2),
    withTranscriberFallbacks: count((item) => item.runtime.transcriberFallback.manualCount > 0 || item.runtime.transcriberFallback.autoEnabled),
    withSecurityFilters: count((item) => item.runtime.securityFilters),
    customerFacingWithSecurityFilters: count((item) => item.role === "customer-facing" && item.runtime.securityFilters),
    withPublishedVersions: count((item) => Boolean(item.runtime.publishedVersion)),
    highRiskGaps: allIssues.filter((issue) => issue.level === "high").length,
    issueCounts,
  };
}

function prioritizedRecommendations(summary) {
  const recommendations = [];
  if (summary.withTranscriptAndLogs < summary.activeAssistants) {
    recommendations.push({ action: "Restore transcript/log evidence on every active assistant.", approval: "safe after config backup", priority: 1 });
  }
  if (summary.customerFacingWithSecurityFilters < summary.customerFacingAssistants) {
    recommendations.push({ action: "Apply the existing reject-mode security filter policy to uncovered active assistants.", approval: "safe after regression evals", priority: 1 });
  }
  if (summary.coveredBySimulations < summary.activeAssistants) {
    recommendations.push({ action: "Create chat-first Vapi simulation suites with mocked SMS tools, then add a smaller voice suite.", approval: "safe to configure; runs incur usage", priority: 2 });
  }
  if (summary.coveredByMonitoring < summary.activeAssistants) {
    recommendations.push({ action: "Add production monitors for provider errors, missing transcripts, long calls, and scorecard failures.", approval: "notifier destination and thresholds needed", priority: 2 });
  }
  if (summary.withPublishedVersions < summary.activeAssistants) {
    recommendations.push({ action: "Adopt Vapi assistant/tool draft-publish versioning and make deployment scripts verify the published version before reporting success.", approval: "required: changes the live Vapi deployment workflow", priority: 2 });
  }
  if (summary.withVoiceFallbacks < summary.activeAssistants) {
    recommendations.push({ action: "Pilot a cross-provider fallback voice on one demo assistant before fleet rollout.", approval: "required: voice can change mid-call and affects cost", priority: 3 });
  }
  if (summary.withVapiVoiceV2 < summary.vapiVoiceAssistants) {
    recommendations.push({ action: "A/B-test Vapi Voice V2 on one private demo; it is opt-in, more human-sounding, and advertised at about half the V1 TTS cost.", approval: "required: changes the established voice sound", priority: 3 });
  }
  if (summary.withTranscriberFallbacks < summary.activeAssistants) {
    recommendations.push({ action: "Pilot a manual transcriber fallback with an approved provider.", approval: "required: audio may be routed to another provider", priority: 3 });
  }
  if (summary.withSmartEndpointing < summary.activeAssistants) {
    recommendations.push({ action: "A/B-test LiveKit smart endpointing or Deepgram Flux using voice simulations before changing live calls.", approval: "required: changes conversational timing", priority: 3 });
  }
  return recommendations;
}

async function runAudit({ env = loadProjectEnv(), fetchImpl = fetch } = {}) {
  const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
  const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");

  const warnings = [];
  async function request(route, optional = false) {
    try {
      const response = await fetchImpl(`${apiBase}${route}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(120000),
      });
      const text = await response.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
      return body;
    } catch (error) {
      if (!optional) throw new Error(`${route} failed: ${error.message || error}`);
      warnings.push(`${route} unavailable: ${error.message || error}`);
      return [];
    }
  }

  const [assistantPayload, phonePayload, suitePayload, monitorPayload, evalPayload, outputPayload, scorecardPayload] = await Promise.all([
    request("/assistant?limit=1000"),
    request("/phone-number?limit=1000"),
    request("/eval/simulation/suite?limit=1000", true),
    request("/monitoring/monitor?limit=1000", true),
    request("/eval?limit=1000&page=1", true),
    request("/structured-output?limit=1000", true),
    request("/observability/scorecard?limit=1000", true),
  ]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const phones = listFrom(phonePayload, ["phoneNumbers"]);
  const suites = listFrom(suitePayload, ["simulationSuites", "suites"]);
  const monitors = listFrom(monitorPayload, ["monitors"]);
  const evals = listFrom(evalPayload, ["evals"]);
  const structuredOutputs = listFrom(outputPayload, ["structuredOutputs", "structured_outputs"]);
  const scorecards = listFrom(scorecardPayload, ["scorecards"]);
  const assistantsById = new Map(assistants.map((assistant) => [String(assistant.id || ""), assistant]));
  const phonesByAssistant = new Map();
  for (const phone of phones) {
    const assistantId = assistantIdFromPhone(phone);
    if (!assistantId) continue;
    if (!phonesByAssistant.has(assistantId)) phonesByAssistant.set(assistantId, []);
    phonesByAssistant.get(assistantId).push(phone);
  }
  const reports = [...phonesByAssistant.entries()]
    .map(([id, assignedPhones]) => {
      const assistant = assistantsById.get(id);
      if (!assistant) {
        warnings.push(`Phone-attached assistant ${shortHash(id)} was absent from the assistant inventory.`);
        return null;
      }
      return evaluateAssistantReadiness(assistant, { phones: assignedPhones, simulationSuites: suites, monitors });
    })
    .filter(Boolean)
    .sort((left, right) => left.assistantName.localeCompare(right.assistantName));
  const summary = summarize(reports);
  return {
    generatedAt: new Date().toISOString(),
    scope: "Only assistants attached to a current Vapi phone number; retired and unattached test assistants are excluded.",
    resourceInventory: {
      phoneNumbers: phones.length,
      assistants: assistants.length,
      evals: evals.length,
      simulationSuites: suites.length,
      monitors: monitors.length,
      structuredOutputs: structuredOutputs.length,
      scorecards: scorecards.length,
    },
    summary,
    recommendations: prioritizedRecommendations(summary),
    warnings,
    assistants: reports,
  };
}

async function main() {
  const report = await runAudit();
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--strict") && report.summary.highRiskGaps > 0) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  evaluateAssistantReadiness,
  assistantRole,
  hasCallEvidence,
  hasIdleHook,
  hasPublishedVersion,
  hasSecurityFilters,
  hasSmartEndpointing,
  monitorCoversAssistant,
  prioritizedRecommendations,
  suiteCoversAssistant,
  summarize,
  transcriberFallbackState,
};
