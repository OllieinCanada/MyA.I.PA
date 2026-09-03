const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OUTPUT_DEFINITIONS,
  SCORECARD_NAME,
  SCORE_WEIGHTS,
  buildArtifactPlan,
  expectedOutputPayload,
  extractStructuredOutputPreviewResult,
  resourceMatches,
  scorecardMatches,
  scorecardPayload,
} = require("../server/deanComplaintQuality");

test("complaint record is privacy-conscious and tracks the requested operational fields", () => {
  const record = OUTPUT_DEFINITIONS.find((item) => item.key === "record");
  const properties = record.schema.properties;
  for (const key of [
    "callType",
    "callerName",
    "community",
    "federalTopic",
    "concernSummary",
    "statedImpact",
    "requestedOutcome",
    "preferredContactTime",
    "initialTone",
    "finalTone",
    "urgency",
    "smsPermission",
    "smsDeliveryOutcome",
    "officialOfficeReferralNeeded",
    "sensitiveInformationOffered",
    "missingDetails",
  ]) assert.ok(properties[key], `missing ${key}`);
  assert.doesNotMatch(JSON.stringify(record), /passportNumber|socialInsuranceNumber|homeAddress|partyAffiliation/i);
  assert.match(properties.sensitiveInformationOffered.description, /Never extract the sensitive value/i);
});

test("scorecard uses only boolean outputs and totals one hundred points", () => {
  const outputs = Object.fromEntries(OUTPUT_DEFINITIONS.map((item) => [item.key, { id: `output-${item.key}`, schema: item.schema }]));
  const scorecard = scorecardPayload(outputs, "assistant-dean");
  assert.equal(Object.values(SCORE_WEIGHTS).reduce((total, points) => total + points, 0), 100);
  assert.equal(scorecard.metrics.reduce((total, metric) => total + metric.conditions[0].points, 0), 100);
  for (const key of Object.keys(SCORE_WEIGHTS)) assert.equal(outputs[key].schema.type, "boolean");
  assert.equal(scorecard.metrics.some((metric) => metric.structuredOutputId === outputs.record.id), false);
});

test("Vapi resource names stay within the provider limit", () => {
  for (const definition of OUTPUT_DEFINITIONS) assert.ok(definition.name.length <= 40, definition.name);
  assert.ok(SCORECARD_NAME.length <= 40, SCORECARD_NAME);
});

test("artifact attachment preserves existing recording and analysis settings", () => {
  const original = {
    recordingEnabled: true,
    transcriptPlan: { enabled: true },
    structuredOutputIds: ["existing-output"],
    scorecardIds: ["existing-scorecard"],
  };
  const result = buildArtifactPlan(original, ["new-output", "new-output"], "new-scorecard");
  assert.equal(result.recordingEnabled, true);
  assert.deepEqual(result.transcriptPlan, { enabled: true });
  assert.deepEqual(result.structuredOutputIds, ["existing-output", "new-output"]);
  assert.deepEqual(result.scorecardIds, ["existing-scorecard", "new-scorecard"]);
});

test("resource and scorecard matching detects configuration drift", () => {
  const definition = OUTPUT_DEFINITIONS[0];
  const payload = expectedOutputPayload(definition, "assistant-dean");
  const resource = { id: "resource-1", ...payload };
  assert.equal(resourceMatches(resource, payload), true);
  assert.equal(resourceMatches({ ...resource, description: "changed" }, payload), false);

  const outputs = Object.fromEntries(OUTPUT_DEFINITIONS.map((item) => [item.key, { id: `output-${item.key}` }]));
  const desiredScorecard = scorecardPayload(outputs, "assistant-dean");
  assert.equal(scorecardMatches({ id: "scorecard-1", ...desiredScorecard }, desiredScorecard), true);
  const drifted = JSON.parse(JSON.stringify(desiredScorecard));
  drifted.metrics[0].conditions[0].points += 1;
  assert.equal(scorecardMatches({ id: "scorecard-1", ...drifted }, desiredScorecard), false);
});

test("structured-output preview parser accepts Vapi's id-keyed response", () => {
  assert.equal(extractStructuredOutputPreviewResult({
    "output-id": { name: "Quality check", result: true },
  }), true);
  assert.deepEqual(extractStructuredOutputPreviewResult({
    "output-id": { name: "Complaint record", result: { urgency: "routine" } },
  }), { urgency: "routine" });
});
