const assert = require("node:assert/strict");
const test = require("node:test");
const { mutateBlueprint } = require("../scripts/repair-make-signup-provisioning");
const { buildFailureBody, buildSafeFailureCodeMapping, inspectFailureBodyTemplate, repairFailureBodiesOnly } = require("../scripts/make-provisioning-failure-format");
const { classifyMakeSignupResponse } = require("../server/makeSignupWebhook");

function fixture() {
  const http = (id) => ({
    id, module: "http:ActionSendData", version: 3,
    parameters: { handleErrors: true },
    mapper: { url: "https://example.invalid/fixture", method: "post", qs: [], headers: [], bodyType: "multipart_form_data", formDataFields: [] },
    metadata: { expect: [{ name: "url" }], designer: { x: id, y: 0 } },
  });
  const purchase = http(9);
  purchase.mapper.qs = [{ name: "voiceUrl", value: "https://hook.us2.make.com/synthetic-voice-hook" }];
  return { name: "Synthetic signup", metadata: { scenario: {} }, flow: [
    { id: 16, module: "gateway:CustomWebHook", parameters: {}, mapper: {} },
    { id: 21, module: "json:ParseJSON", parameters: {}, mapper: { json: "{{16.value}}" } },
    purchase, http(25), http(28),
    { id: 30, module: "gateway:WebhookRespond", parameters: {}, mapper: { body: "{}", status: "200" } },
  ] };
}

test("actual repair generator keeps IML string literals unescaped inside all three failure templates", () => {
  const blueprint = mutateBlueprint(fixture());
  for (const id of [9, 25, 28]) {
    const body = blueprint.flow.find((module) => module.id === id).onerror[0].mapper.body;
    assert.ok(body.includes(`{{if(contains(${id}.error.message; "UND_ERR_SOCKET"); "UND_ERR_SOCKET";`), `module ${id}: IML must be evaluated before the rendered JSON is parsed`);
  }
});

// A deterministic interpreter for this fixed generated grammar only. This is not
// Make-engine coverage; it verifies all allowlisted branches and resulting JSON.
function renderGeneratedBody(body, moduleId, message) {
  const mapping = buildSafeFailureCodeMapping(moduleId);
  assert.ok(body.includes(mapping));
  function evaluate(expression, depth = 0) {
    assert.ok(depth <= 15);
    if (expression === '"PROVIDER_REQUEST_FAILED"') return "PROVIDER_REQUEST_FAILED";
    const match = /^if\(contains\((9|25|28)\.error\.message; "([^"\\]+)"\); "([A-Z0-9_]+)"; ([\s\S]+)\)$/.exec(expression);
    assert.ok(match, "Only the fixed contains/if grammar is allowed");
    assert.equal(Number(match[1]), moduleId);
    return message.includes(match[2]) ? match[3] : evaluate(match[4], depth + 1);
  }
  const code = evaluate(mapping.slice(2, -2));
  const rendered = body.replace(mapping, code);
  return { rendered, parsed: JSON.parse(rendered) };
}

const cases = [
  ["UND_ERR_SOCKET", "UND_ERR_SOCKET"],
  ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"],
  ["ECONNRESET", "ECONNRESET"],
  ["PROVISIONING_RECONCILIATION_REQUIRED", "PROVISIONING_RECONCILIATION_REQUIRED"],
  ["SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED", "SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED"],
  ["SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED", "SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED"],
  ["SIGNUP_BUSINESS_MIGRATION_REQUIRED", "SIGNUP_BUSINESS_MIGRATION_REQUIRED"],
  ["SIGNUP_CLOSED", "SIGNUP_CLOSED"],
  ["LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE", "LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE"],
  ["PROVISIONING_INVENTORY_CONTEXT_MISMATCH", "PROVISIONING_INVENTORY_CONTEXT_MISMATCH"],
  ["PROVISIONING_ALREADY_IN_PROGRESS", "PROVISIONING_ALREADY_IN_PROGRESS"],
  ["PROVISIONING_RESULT_STALE", "PROVISIONING_RESULT_STALE"],
  ["registered signup context", "PROVISIONING_CONTEXT_NOT_REGISTERED"],
  ["Invalid provisioning key", "PROVISIONING_AUTH_INVALID"],
  ["Invalid signed provisioning request", "PROVISIONING_AUTHORIZATION_INVALID"],
];

for (const [id, provider, failedStage] of [[9, "TWILIO", "TWILIO_NUMBER_PURCHASE"], [25, "VAPI", "VAPI_ASSISTANT_CREATE"], [28, "VAPI", "VAPI_NUMBER_IMPORT"]]) {
  for (const [needle, expectedCode] of cases) {
    test(`module ${id}: ${expectedCode} remains a readable, redacted refusal`, () => {
      const body = buildFailureBody(id);
      const { rendered, parsed } = renderGeneratedBody(body, id, `${needle}; fixture@example.invalid; +12895550113; Authorization: synthetic-private-token; "}\n`);
      assert.equal(parsed.providerCode, expectedCode);
      assert.equal(parsed.provider, provider);
      assert.equal(parsed.failedStage, failedStage);
      assert.equal(parsed.success, false);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.retryable, false);
      assert.doesNotMatch(rendered, /fixture@example|12895550113|synthetic-private-token|Authorization/);
      assert.equal(parsed.assistantId, undefined);
      assert.equal(parsed.twilioPhoneNumber, undefined);
      const classified = classifyMakeSignupResponse(rendered, parsed);
      assert.equal(classified.kind, "rejected");
      assert.equal(classified.complete, false);
      assert.equal(classified.providerCode, expectedCode);
      assert.equal(classified.failedStage, failedStage);
      assert.equal(classified.retryable, false);
    });
  }

  test(`module ${id}: unknown errors remain generic and mapping precedence stays unchanged`, () => {
    const body = buildFailureBody(id);
    const unknown = renderGeneratedBody(body, id, 'unknown; fake-sensitive-string; "}}\\\n').parsed;
    assert.equal(unknown.providerCode, "PROVIDER_REQUEST_FAILED");
    assert.equal(unknown.retryable, false);
    assert.equal(renderGeneratedBody(body, id, "SIGNUP_CLOSED UND_ERR_SOCKET").parsed.providerCode, "UND_ERR_SOCKET");
  });
}

test("the malformed synthetic response is unrecognized, never a successful completion", () => {
  const malformed = String.raw`{"ok":false,"success":false,"providerCode":"PROVIDER_REQUEST_FAILED\","retryable":false}`;
  assert.throws(() => JSON.parse(malformed));
  const classified = classifyMakeSignupResponse(malformed, null);
  assert.equal(classified.kind, "unrecognized");
  assert.equal(classified.complete, false);
});

test("template validation refuses escaped IML, altered evidence and appended data", () => {
  for (const id of [9, 25, 28]) {
    const body = buildFailureBody(id);
    assert.equal(inspectFailureBodyTemplate(body, id).success, false);
    const altered = [
      body.replace(buildSafeFailureCodeMapping(id), JSON.stringify(buildSafeFailureCodeMapping(id)).slice(1, -1)),
      body.replace('"success":false', '"success":true'),
      body.replace('"retryable":false', '"retryable":true'),
      body.replace(`${id}.error.message`, `${id}.error.body`),
      body + "untrusted suffix",
    ];
    for (const candidate of altered) assert.equal(inspectFailureBodyTemplate(candidate, id), null);
  }
  for (const id of ["9", 0, 31, NaN, null, "9.error.body"]) assert.throws(() => buildFailureBody(id), /^Error: MAKE_FAILURE_MODULE_UNSUPPORTED$/);
});

function legacyBlueprint() {
  const blueprint = mutateBlueprint(fixture());
  for (const id of [9, 25, 28]) {
    const envelope = inspectFailureBodyTemplate(buildFailureBody(id), id);
    envelope.providerCode = buildSafeFailureCodeMapping(id);
    blueprint.flow.find((module) => module.id === id).onerror[0].mapper.body = JSON.stringify(envelope);
  }
  return blueprint;
}

test("narrow repair changes only three response bodies, preserving requests, IDs, settings and history", () => {
  const original = legacyBlueprint();
  original.metadata.unrelated = { history: [{ note: "synthetic-history" }] };
  const before = structuredClone(original);
  const repaired = repairFailureBodiesOnly(original);
  assert.deepEqual(original, before);
  const normalized = structuredClone(repaired);
  for (const id of [9, 25, 28]) {
    const oldBody = before.flow.find((module) => module.id === id).onerror[0].mapper.body;
    const module = normalized.flow.find((item) => item.id === id);
    assert.notEqual(module.onerror[0].mapper.body, oldBody);
    assert.equal(module.onerror[0].mapper.body, buildFailureBody(id));
    module.onerror[0].mapper.body = oldBody;
  }
  assert.deepEqual(normalized, before);
  assert.deepEqual(repairFailureBodiesOnly(repaired), repaired, "reapplying is a no-op");
});

test("narrow repair refuses changed workflows atomically without leaking unexpected body data", () => {
  const mutations = [
    (b) => b.flow.pop(),
    (b) => b.flow.push(structuredClone(b.flow[2])),
    (b) => b.flow.reverse(),
    (b) => { b.flow[2].module = "untrusted:request"; },
    (b) => { b.flow[2].version = 4; },
    (b) => { b.flow[2].mapper.url = "https://example.invalid/not-the-signup"; },
    (b) => { b.flow[2].parameters.handleErrors = false; },
    (b) => { b.flow[2].onerror.push(structuredClone(b.flow[2].onerror[0])); },
    (b) => { b.flow[2].onerror[0].module = "http:ActionSendData"; },
    (b) => { b.flow[2].onerror[0].mapper.status = "201"; },
    (b) => { b.flow[2].onerror[0].mapper.headers = []; },
    (b) => { b.flow[2].routes = []; },
    (b) => { b.flow[3].onerror[0].mapper.body = "synthetic-private-token@example.invalid"; },
    (b) => { b.flow[3].onerror[0].mapper.body = JSON.stringify({ ...JSON.parse(b.flow[3].onerror[0].mapper.body), success: true }); },
    (b) => { b.flow[3].onerror[0].mapper.body = JSON.stringify({ ...JSON.parse(b.flow[3].onerror[0].mapper.body), rawError: "synthetic-private-token@example.invalid" }); },
    (b) => { b.flow[3].onerror[0].mapper.body = b.flow[3].onerror[0].mapper.body.replace('{"ok":false', '{"ok":true,"ok":false'); },
    (b) => { b.flow[3].onerror[0].mapper.body = b.flow[3].onerror[0].mapper.body + " "; },
  ];
  for (const mutate of mutations) {
    const candidate = legacyBlueprint(); mutate(candidate);
    const before = structuredClone(candidate);
    assert.throws(() => repairFailureBodiesOnly(candidate), (error) => /^MAKE_FAILURE_(?:FLOW_CHANGED|HANDLER_CHANGED|BODY_UNRECOGNIZED)$/.test(error.message));
    assert.deepEqual(candidate, before);
  }
});

test("the existing blueprint verifier rejects the legacy escaped template instead of marking it repaired", () => {
  const { verifyBlueprint } = require("../scripts/repair-make-signup-provisioning");
  assert.equal(verifyBlueprint(legacyBlueprint()).errorHandlers, false);
  assert.equal(verifyBlueprint(repairFailureBodiesOnly(legacyBlueprint())).errorHandlers, true);
});
