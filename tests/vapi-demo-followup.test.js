const test = require("node:test");
const assert = require("node:assert/strict");
const { executeVapiDemoFollowup, isVapiDemoFollowupTool } = require("../server/vapiDemoFollowup");

test("recognizes only the guarded demo follow-up tool", () => {
  assert.equal(isVapiDemoFollowupTool("send_myaipa_demo_followup"), true);
  assert.equal(isVapiDemoFollowupTool("send_signup_sms"), false);
});

test("blocks demo SMS without an explicit caller request", async () => {
  const result = await executeVapiDemoFollowup({
    parameters: { rawPhoneNumber: "9057885488", callerRequest: "sounds good" },
    prisma: {}, sendSms: async () => { throw new Error("must not send"); },
  });
  assert.deepEqual(result, { ok: false, skipped: true, reason: "explicit_caller_request_required" });
});

test("locks demo SMS after signup completed in the same call", async () => {
  const result = await executeVapiDemoFollowup({
    parameters: { rawPhoneNumber: "9057885488", callerRequest: "text me the details" },
    callExternalId: "call-1",
    prisma: { vapiToolExecution: { findFirst: async () => ({ id: 1 }) } },
    sendSms: async () => { throw new Error("must not send"); },
  });
  assert.equal(result.reason, "signup_mode_locked");
});

test("sends a server-controlled demo text to a canonical number", async () => {
  let captured;
  const result = await executeVapiDemoFollowup({
    parameters: { rawPhoneNumber: "(905) 788-5488", callerRequest: "please text me the demo link", name: "Ollie" },
    callExternalId: "call-2",
    prisma: { vapiToolExecution: { findFirst: async () => null } },
    sendSms: async (input) => { captured = input; return { sid: "SM1" }; },
  });
  assert.equal(result.ok, true);
  assert.equal(captured.to, "+19057885488");
  assert.match(captured.message, /Ollie/);
  assert.match(captured.message, /myaipa\.ca/);
});
