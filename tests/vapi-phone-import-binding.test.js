const assert = require("node:assert/strict");
const { test } = require("node:test");
const { verifyVapiPhoneAssistantBinding } = require("../server/vapiPhoneImportVerification");

function summarize(record, fallbackPhoneNumber) {
  return {
    id: String(record?.id || "").trim(),
    number: String(record?.number || fallbackPhoneNumber || "").trim(),
    assistantId: String(record?.assistantId || "").trim(),
  };
}

test("Vapi phone verification repairs a missing assistant and trusts only live readback", async () => {
  const calls = [];
  const responses = [
    { id: "phone-new", number: "+12895550123" },
    { id: "phone-new", number: "+12895550123" },
    { id: "phone-new", number: "+12895550123", assistantId: "assistant-123" },
  ];
  const requestResource = async (path, options = {}) => {
    calls.push({ path, method: options.method || "GET", body: options.body || null });
    return responses.shift();
  };

  const result = await verifyVapiPhoneAssistantBinding({
    phoneRecordId: "phone-new",
    phoneNumber: "+12895550123",
    assistantId: "assistant-123",
    name: "Example Electric Number",
  }, {
    requestResource,
    getAssistantId: (record) => record.assistantId,
    summarize,
    sanitizeName: (value) => value,
  });

  assert.equal(result.assistantId, "assistant-123");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(calls.find((call) => call.method === "PATCH").body.assistantId, "assistant-123");
  assert.equal(responses.length, 0);
});

test("Vapi phone verification fails closed when readback stays unbound", async () => {
  const responses = [
    { id: "phone-new", number: "+12895550123" },
    { id: "phone-new", number: "+12895550123" },
    { id: "phone-new", number: "+12895550123" },
  ];

  await assert.rejects(
    verifyVapiPhoneAssistantBinding({
      phoneRecordId: "phone-new",
      phoneNumber: "+12895550123",
      assistantId: "assistant-123",
    }, {
      requestResource: async () => responses.shift(),
      getAssistantId: (record) => record.assistantId,
      summarize,
    }),
    (error) => error?.code === "VAPI_PHONE_IMPORT_BINDING_UNVERIFIED"
  );
});

test("Vapi phone verification never overwrites a different assistant", async () => {
  let patched = false;
  await assert.rejects(
    verifyVapiPhoneAssistantBinding({
      phoneRecordId: "phone-new",
      phoneNumber: "+12895550123",
      assistantId: "assistant-123",
    }, {
      requestResource: async (_path, options = {}) => {
        if (options.method === "PATCH") patched = true;
        return { id: "phone-new", number: "+12895550123", assistantId: "assistant-other" };
      },
      getAssistantId: (record) => record.assistantId,
      summarize,
    }),
    (error) => error?.code === "VAPI_PHONE_ASSISTANT_CONFLICT" && error?.statusCode === 409
  );
  assert.equal(patched, false);
});
