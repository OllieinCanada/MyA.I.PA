const assert = require("node:assert/strict");
const test = require("node:test");

const {
  mutateBlueprint,
  verifyBlueprint,
  inspectFailureTemplate,
  buildSafeFailureCodeMapping,
  repairFailureReporting,
} = require("../scripts/repair-make-signup-provisioning");

function fixture() {
  const httpMapper = {
    url: "https://api.myaipa.ca/original",
    method: "post",
    qs: [],
    headers: [{ name: "x-make-webhook-token", value: "stored-connection-value" }],
    bodyType: "multipart_form_data",
    formDataFields: [],
    parseResponse: "true",
  };
  return {
    name: "Signup",
    metadata: { scenario: {} },
    flow: [
      { id: 16, module: "gateway:CustomWebHook", mapper: {}, parameters: {} },
      { id: 21, module: "json:ParseJSON", mapper: { json: "{{16.value}}" }, parameters: {} },
      {
        id: 9,
        module: "http:ActionSendData",
        version: 3,
        mapper: {
          ...httpMapper,
          qs: [
            { name: "areaCode", value: "249" },
            { name: "voiceUrl", value: "https://hook.us2.make.com/private-voice-hook" },
            { name: "voiceMethod", value: "POST" },
          ],
        },
        parameters: { handleErrors: "false" },
        metadata: {
          expect: [{ name: "url" }, { name: "method" }],
          designer: { x: 100, y: 200 },
        },
      },
      {
        id: 25,
        module: "vapi:makeApiCall2",
        version: 2,
        mapper: { body: "{}" },
        parameters: {},
        metadata: {
          expect: [{ name: "relativeURL" }, { name: "body" }],
          designer: { x: 300, y: 400 },
        },
      },
      { id: 28, module: "http:ActionSendData", version: 3, mapper: httpMapper, parameters: {} },
      { id: 30, module: "gateway:WebhookRespond", mapper: { body: "{}", status: "200" }, parameters: {} },
    ],
  };
}

test("rewrites the three paid provisioning stages and fail-closed response mappings", () => {
  const current = fixture();
  const repaired = mutateBlueprint(current);
  assert.ok(Object.values(verifyBlueprint(repaired)).every(Boolean));
  assert.equal(current.flow.find((item) => item.id === 9).mapper.qs[0].value, "249");
  assert.equal(repaired.flow.find((item) => item.id === 25).module, "http:ActionSendData");
  assert.deepEqual(repaired.flow.find((item) => item.id === 25).metadata.expect, [
    { name: "url" },
    { name: "method" },
  ]);
  assert.deepEqual(repaired.flow.find((item) => item.id === 25).metadata.designer, { x: 300, y: 400 });
  assert.deepEqual(repaired.flow.find((item) => item.id === 30).mapper.headers, [
    { key: "Content-Type", value: "application/json" },
  ]);
  assert.equal(repaired.metadata.scenario.sequential, false);
  assert.equal(repaired.metadata.scenario.confidential, true);
  const handlerIds = new Set();
  const parserFailure = JSON.parse(repaired.flow.find((item) => item.id === 21).onerror[0].mapper.body);
  assert.equal(parserFailure.code, "MAKE_SIGNUP_PAYLOAD_INVALID");
  assert.equal(parserFailure.failedStage, "MAKE_WEBHOOK");
  for (const id of [9, 25, 28]) {
    const module = repaired.flow.find((item) => item.id === id);
    assert.equal(module.parameters.handleErrors, true);
    assert.equal(module.onerror.length, 1);
    const handler = module.onerror[0];
    assert.equal(handler.module, "gateway:WebhookRespond");
    const failure = inspectFailureTemplate(handler.mapper.body);
    assert.equal(failure.ok, false);
    assert.equal(failure.success, false);
    assert.equal(failure.code, "MAKE_PROVISIONING_STAGE_FAILED");
    assert.ok(["TWILIO_NUMBER_PURCHASE", "VAPI_ASSISTANT_CREATE", "VAPI_NUMBER_IMPORT"].includes(failure.failedStage));
    assert.equal(failure.retryable, false);
    assert.equal(failure.provider, id === 9 ? "TWILIO" : "VAPI");
    assert.match(handler.mapper.body, /UND_ERR_SOCKET/);
    assert.match(handler.mapper.body, /SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED/);
    assert.match(handler.mapper.body, /SIGNUP_BUSINESS_MIGRATION_REQUIRED/);
    assert.doesNotMatch(handler.mapper.body, /parseJSON|\.error\.body|\.error\.headers/);
    assert.ok(["number_purchase", "assistant_creation", "number_binding"].includes(failure.stage));
    assert.ok(!handlerIds.has(handler.id));
    handlerIds.add(handler.id);
  }
});

test('failure templates preserve unescaped IML syntax and render valid fail-closed JSON for every allowed result', () => {
  const repaired = mutateBlueprint(fixture());
  for (const id of [9, 25, 28]) {
    const template = repaired.flow.find(m => m.id === id).onerror[0].mapper.body;
    const expression = buildSafeFailureCodeMapping(id);
    assert.ok(template.includes(expression), 'Make must receive the original expression, not JSON-escaped IML');
    assert.doesNotMatch(expression, /\\"/);
    const literals = [...expression.matchAll(/"([A-Z][A-Z_]+)"/g)].map(m => m[1]);
    assert.ok(literals.length > 10);
    // Models the template substitution boundary, not a live Make execution.
    for (const code of new Set(literals)) {
      const rendered = JSON.parse(template.replace(expression, code));
      assert.equal(rendered.providerCode, code);
      assert.equal(rendered.success, false);
      assert.equal(rendered.retryable, false);
    }
    const oldBroken = JSON.stringify({ success: false, providerCode: expression });
    assert.equal(inspectFailureTemplate(oldBroken), null);
  }
});

test("refuses to rewrite an unexpected paid module", () => {
  const current = fixture();
  current.flow.find((item) => item.id === 25).module = "unknown:destructive-module";
  assert.throws(() => mutateBlueprint(current), /refusing an unsafe automatic rewrite/i);
});

test('reporting-only repair changes only three response bodies and is idempotent', () => {
  const broken = mutateBlueprint(fixture());
  for (const id of [9, 25, 28]) {
    const handler = broken.flow.find(m => m.id === id).onerror[0];
    const envelope = inspectFailureTemplate(handler.mapper.body);
    envelope.providerCode = buildSafeFailureCodeMapping(id);
    handler.mapper.body = JSON.stringify(envelope);
  }
  const repaired = repairFailureReporting(broken);
  assert.ok(Object.values(verifyBlueprint(repaired)).every(Boolean));
  assert.deepEqual(repairFailureReporting(repaired), repaired);
  const restored = structuredClone(repaired);
  for (const id of [9, 25, 28]) {
    restored.flow.find(m => m.id === id).onerror[0].mapper.body = broken.flow.find(m => m.id === id).onerror[0].mapper.body;
  }
  assert.deepEqual(restored, broken, 'All non-response settings must be byte-for-byte unchanged');
  broken.flow.find(m => m.id === 9).onerror[0].mapper.body = '{"success":true}';
  assert.throws(() => repairFailureReporting(broken), /Unknown failure envelope/);
});
