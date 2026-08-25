const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateAssistantReadiness,
  monitorCoversAssistant,
  summarize,
  suiteCoversAssistant,
} = require("../scripts/audit-vapi-2026-readiness");

function readyAssistant(overrides = {}) {
  return {
    id: "assistant-1",
    name: "Production assistant",
    latestVersion: "v3",
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      fallbackPlan: { transcribers: [{ provider: "assembly-ai" }] },
    },
    model: { provider: "openai", model: "gpt-4.1" },
    voice: {
      provider: "11labs",
      voiceId: "voice-1",
      fallbackPlan: { voices: [{ provider: "vapi", voiceId: "Elliot" }] },
    },
    artifactPlan: {
      loggingEnabled: true,
      transcriptPlan: { enabled: true },
      structuredOutputIds: ["output-1"],
      scorecardIds: ["scorecard-1"],
    },
    compliancePlan: {
      securityFilterPlan: { enabled: true, filters: [{ type: "prompt-injection" }] },
    },
    startSpeakingPlan: { smartEndpointingPlan: { provider: "livekit" } },
    hooks: [{ on: "customer.speech.timeout", options: { timeoutSeconds: 12 } }],
    maxDurationSeconds: 300,
    ...overrides,
  };
}

test("coverage helpers recognize direct and all-assistant targets", () => {
  assert.equal(suiteCoversAssistant({ targetAssignments: [{ targetType: "assistant", targetId: "assistant-1" }] }, "assistant-1"), true);
  assert.equal(suiteCoversAssistant({ targetAssignments: [{ targetType: "squad", targetId: "assistant-1" }] }, "assistant-1"), false);
  assert.equal(monitorCoversAssistant({ targets: "*" }, "assistant-1"), true);
  assert.equal(monitorCoversAssistant({ targets: [{ type: "assistant", id: "assistant-1" }] }, "assistant-1"), true);
});

test("fully covered assistant has no readiness issues", () => {
  const report = evaluateAssistantReadiness(readyAssistant(), {
    phones: [{ number: "+19055551234" }],
    simulationSuites: [{ targetAssignments: [{ targetType: "assistant", targetId: "assistant-1" }] }],
    monitors: [{ targets: "*", active: true }],
  });
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.phones, ["1234"]);
  assert.equal(report.runtime.voiceFallbacks, 1);
  assert.equal(report.runtime.publishedVersion, "v3");
  assert.equal(report.observability.simulationSuites, 1);
});

test("missing coverage is classified without changing assistant configuration", () => {
  const report = evaluateAssistantReadiness({
    id: "assistant-2",
    name: "Uncovered assistant",
    transcriber: { provider: "deepgram", model: "nova-3" },
    model: { provider: "openai", model: "gpt-4.1" },
    voice: { provider: "11labs", voiceId: "voice-2" },
    artifactPlan: { loggingEnabled: false, transcriptPlan: { enabled: false } },
  });
  const issueLevels = Object.fromEntries(report.issues.map((issue) => [issue.key, issue.level]));
  assert.equal(issueLevels["call-evidence"], "high");
  assert.equal(issueLevels["security-filters"], "high");
  assert.equal(issueLevels.simulations, "medium");
  assert.equal(issueLevels["voice-fallback"], "review");
  assert.equal(issueLevels["transcriber-fallback"], "review");
  assert.equal(issueLevels.versioning, "review");
});

test("Vapi Voice V1 is flagged for a pilot while non-Vapi voices are not", () => {
  const v1 = evaluateAssistantReadiness(readyAssistant({
    voice: { provider: "vapi", voiceId: "Jess" },
  }));
  assert.equal(v1.runtime.vapiVoiceV2, false);
  assert.equal(v1.issues.some((issue) => issue.key === "vapi-voice-v2"), true);

  const external = evaluateAssistantReadiness(readyAssistant());
  assert.equal(external.runtime.vapiVoiceV2, true);
  assert.equal(external.issues.some((issue) => issue.key === "vapi-voice-v2"), false);
});

test("synthetic demo assistants do not inflate customer-facing high-risk totals", () => {
  const report = evaluateAssistantReadiness({
    id: "assistant-demo",
    name: "My AI PA Recorded Demo",
    artifactPlan: { loggingEnabled: true, transcriptPlan: { enabled: true } },
  });
  assert.equal(report.role, "synthetic-demo");
  assert.equal(report.issues.find((issue) => issue.key === "security-filters").level, "medium");
});

test("summary counts production coverage", () => {
  const covered = evaluateAssistantReadiness(readyAssistant(), {
    simulationSuites: [{ targetAssignments: [{ targetType: "assistant", targetId: "assistant-1" }] }],
    monitors: [{ targets: "*" }],
  });
  const uncovered = evaluateAssistantReadiness({ id: "assistant-2", name: "Uncovered" });
  const result = summarize([covered, uncovered]);
  assert.equal(result.activeAssistants, 2);
  assert.equal(result.coveredBySimulations, 1);
  assert.equal(result.withVoiceFallbacks, 1);
  assert.equal(result.withPublishedVersions, 1);
  assert.equal(result.highRiskGaps, 2);
});
