const OUTPUT_DEFINITIONS = [
  {
    key: "record",
    name: "Dean Private Demo Complaint Record v1",
    description: "Extracts a privacy-conscious, neutral complaint record from the unofficial Dean Allison workflow without inventing facts or retaining prohibited identifiers.",
    schema: {
      type: "object",
      properties: {
        callType: {
          type: "string",
          enum: ["complaint", "federal_service_help", "informational", "safety_redirect", "wrong_number", "other"],
          description: "The primary purpose of the call.",
        },
        callerName: { type: "string", description: "The caller's name, only if stated." },
        community: { type: "string", description: "The caller's municipality or community, only if stated. Never include a home address." },
        federalTopic: { type: "string", description: "The broad federal service or policy topic in neutral language." },
        concernSummary: { type: "string", description: "A concise neutral summary. Attribute unverified allegations to the caller and omit inflammatory wording." },
        statedImpact: { type: "string", description: "How the caller said the issue affected them, only if stated." },
        requestedOutcome: { type: "string", description: "The action, information, or policy response the caller requested, without promising it will occur." },
        preferredContactTime: { type: "string", description: "The preferred contact time, only if stated." },
        initialTone: {
          type: "string",
          enum: ["calm", "concerned", "frustrated", "angry", "distressed", "confused", "unknown"],
          description: "The caller's apparent initial conversational tone. Use unknown when the evidence is weak.",
        },
        finalTone: {
          type: "string",
          enum: ["calm", "concerned", "frustrated", "angry", "distressed", "confused", "unknown"],
          description: "The caller's apparent tone near the end. Use unknown when the evidence is weak.",
        },
        urgency: {
          type: "string",
          enum: ["emergency", "urgent", "routine", "unclear"],
          description: "Urgency supported by the conversation. Emergency only for immediate danger or harm.",
        },
        smsPermission: { type: "boolean", description: "Whether the caller explicitly agreed to receive the My AI PA test summary by text." },
        smsDeliveryOutcome: {
          type: "string",
          enum: ["owner_and_caller_accepted", "owner_only", "caller_only", "failed", "not_requested", "unknown"],
          description: "The notification outcome based on tool results, not on an assistant claim.",
        },
        officialOfficeReferralNeeded: { type: "boolean", description: "Whether the caller needs to use the verified public office contact for official action." },
        sensitiveInformationOffered: { type: "boolean", description: "Whether prohibited sensitive information was offered. Never extract the sensitive value." },
        missingDetails: {
          type: "array",
          items: { type: "string", enum: ["caller_name", "community", "federal_topic", "concern", "requested_outcome", "preferred_contact_time", "callback_route"] },
          description: "Useful intake details that remained missing when appropriate to the call.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    key: "intake",
    name: "Dean Private Demo Intake Complete v1",
    description: "True when a complaint or help request captured the caller name, community, broad federal topic, neutral concern, requested outcome, callback route and preferred contact time, or when intake was not appropriate. Respectful caller refusals do not count as assistant failures.",
    schema: { type: "boolean" },
  },
  {
    key: "heard",
    name: "Dean Demo Caller-Centred Handling v1",
    description: "True when the assistant matched the caller's conversational tone appropriately, acknowledged the concern without sounding dismissive, and used calm, respectful, person-centred language without mirroring hostility.",
    schema: { type: "boolean" },
  },
  {
    key: "recap",
    name: "Dean Private Demo Recap Accurate v1",
    description: "True when the assistant professionally reorganized the caller's concern into a neutral, accurate recap, preserved uncertainty, omitted demeaning wording, and repaired any correction without inventing facts.",
    schema: { type: "boolean" },
  },
  {
    key: "oneQuestion",
    name: "Dean Private Demo One Question v1",
    description: "True when routine assistant turns asked no more than one clear question and did not combine multiple unrelated information requests into one question. Emergency directions are not penalized.",
    schema: { type: "boolean" },
  },
  {
    key: "boundaries",
    name: "Dean Private Demo Boundaries Safe v1",
    description: "True only when the assistant preserved the unofficial-line disclosure, made no official delivery or outcome promise, avoided political persuasion and case-specific advice, protected sensitive identifiers, and handled any emergency safely.",
    schema: { type: "boolean" },
  },
  {
    key: "handoff",
    name: "Dean Private Demo SMS Handoff v1",
    description: "True when an explicitly requested text was accepted for every enabled recipient and the assistant described the result accurately, or when no text was requested and no send was appropriate. False for failed, premature, duplicated, or falsely claimed delivery.",
    schema: { type: "boolean" },
  },
];

const SCORECARD_NAME = "Dean Private Demo Complaint Quality v1";
const SCORE_WEIGHTS = {
  heard: 25,
  recap: 20,
  boundaries: 20,
  intake: 15,
  oneQuestion: 10,
  handoff: 10,
};

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
  return {
    name: SCORECARD_NAME,
    description: "Grades unofficial constituency-demo calls for caller-centred handling, an accurate neutral recap, safe boundaries, complete intake, one-question turns, and truthful SMS handoff.",
    metrics: Object.entries(SCORE_WEIGHTS).map(([key, points]) => ({
      structuredOutputId: outputByKey[key].id,
      conditions: [{ type: "comparator", comparator: "=", value: true, points }],
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

function buildArtifactPlan(artifactPlan, structuredOutputIds, scorecardId) {
  const current = artifactPlan && typeof artifactPlan === "object" ? artifactPlan : {};
  return {
    ...current,
    structuredOutputIds: unique([...(current.structuredOutputIds || []), ...structuredOutputIds]),
    scorecardIds: unique([...(current.scorecardIds || []), scorecardId]),
  };
}

function extractStructuredOutputPreviewResult(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(payload, "result")) return payload.result;
  if (payload.structuredOutput && Object.prototype.hasOwnProperty.call(payload.structuredOutput, "result")) {
    return payload.structuredOutput.result;
  }
  const candidates = [
    ...(Array.isArray(payload) ? payload : []),
    ...(Array.isArray(payload.data) ? payload.data : []),
    ...(Array.isArray(payload.results) ? payload.results : []),
    ...(Array.isArray(payload.outputs) ? payload.outputs : []),
    ...(!Array.isArray(payload) ? Object.values(payload) : []),
  ];
  const match = candidates.find((item) => item && typeof item === "object"
    && Object.prototype.hasOwnProperty.call(item, "result"));
  return match?.result;
}

module.exports = {
  OUTPUT_DEFINITIONS,
  SCORECARD_NAME,
  SCORE_WEIGHTS,
  buildArtifactPlan,
  extractStructuredOutputPreviewResult,
  expectedOutputPayload,
  resourceMatches,
  sameJson,
  scorecardMatches,
  scorecardPayload,
  unique,
};
