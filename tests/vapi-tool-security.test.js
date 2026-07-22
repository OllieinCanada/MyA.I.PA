const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTrustedVapiLeadInput,
  claimVapiToolExecution,
  getVapiToolExecutionIdentity,
  isVapiNotificationTool,
} = require("../server/vapiToolSecurity");

test("notification tool matching includes isolated tools and rejects unrelated tools", () => {
  assert.equal(isVapiNotificationTool("send_owner_sms_dynamic"), true);
  assert.equal(isVapiNotificationTool("send_call_summaries_6809_2e0254ad_v2"), true);
  assert.equal(isVapiNotificationTool("search_faq"), false);
});

test("server-routed business id overrides an untrusted model argument", () => {
  const input = buildTrustedVapiLeadInput({
    businessId: 999,
    name: "Caller",
    rawPhoneNumber: "+19055550101",
    jobDetails: "Panel repair",
  }, 7);
  assert.equal(input.businessId, 7);
  assert.equal(Object.hasOwn(input, "ownerNumber"), false);
});

test("tool execution identity is stable and requires a Vapi tool call id", () => {
  const first = getVapiToolExecutionIdentity({
    toolCall: { id: "tool-call-1", name: "send_owner_sms_dynamic" },
    businessId: 7,
    call: { id: "call-1" },
  });
  const second = getVapiToolExecutionIdentity({
    toolCall: { id: "tool-call-1", name: "send_owner_sms_dynamic" },
    businessId: 7,
    call: { id: "call-1" },
  });
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.idempotencyKey.length, 64);
  assert.throws(
    () => getVapiToolExecutionIdentity({ toolCall: { name: "send_owner_sms_dynamic" }, businessId: 7 }),
    /toolCall\.id is required/i
  );
});

test("database claim returns the existing execution on a unique-key race", async () => {
  const existing = { id: "execution-1", status: "COMPLETED", result: { ok: true } };
  const prisma = {
    vapiToolExecution: {
      create: async () => { const error = new Error("duplicate"); error.code = "P2002"; throw error; },
      findUnique: async () => existing,
    },
  };
  const claim = await claimVapiToolExecution({
    prisma,
    toolCall: { id: "tool-call-1", name: "send_owner_sms_dynamic" },
    businessId: 7,
    call: { id: "call-1" },
  });
  assert.equal(claim.claimed, false);
  assert.equal(claim.execution, existing);
});
