const assert = require("node:assert/strict");
const test = require("node:test");

const {
  mutateBlueprint,
  verifyBlueprint,
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
      },
      { id: 25, module: "vapi:makeApiCall2", version: 2, mapper: { body: "{}" }, parameters: {} },
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
  assert.equal(repaired.metadata.scenario.sequential, true);
  assert.equal(repaired.metadata.scenario.confidential, true);
});

test("refuses to rewrite an unexpected paid module", () => {
  const current = fixture();
  current.flow.find((item) => item.id === 25).module = "unknown:destructive-module";
  assert.throws(() => mutateBlueprint(current), /refusing an unsafe automatic rewrite/i);
});
