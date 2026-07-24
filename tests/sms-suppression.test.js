const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifySmsPreference,
  forwardSmsToUpstream,
  getTwilioSignature,
  normalizeSmsPhone,
  normalizeSmsUpstreamUrl,
  recordSmsPreference,
} = require("../server/smsSuppression");

test("standard STOP and START family keywords are classified without matching ordinary messages", () => {
  for (const keyword of ["STOP", "stop!", "STOP ALL", "unsubscribe", "cancel", "end", "quit"]) {
    assert.equal(classifySmsPreference(keyword).action, "SUPPRESS", keyword);
  }
  for (const keyword of ["START", "unstop", "yes"]) {
    assert.equal(classifySmsPreference(keyword).action, "RESUME", keyword);
  }
  assert.equal(classifySmsPreference("Please call me tomorrow").action, "NONE");
  assert.equal(classifySmsPreference("HELP").action, "HELP");
});

test("phone normalization produces canonical North American E.164 values", () => {
  assert.equal(normalizeSmsPhone("(905) 788-5488"), "+19057885488");
  assert.throws(() => normalizeSmsPhone("123"), /valid E\.164/i);
});

test("signed webhook input uses the documented URL plus sorted form fields", () => {
  const signature = getTwilioSignature(
    "https://api.example.test/api/webhooks/sms",
    { To: "+12495550100", Body: "STOP", From: "+19055550123" },
    "auth-token"
  );
  assert.equal(signature, "MluN2KcB/CRzsUDvT602Okq6zi0=");
  assert.equal(signature, getTwilioSignature(
    "https://api.example.test/api/webhooks/sms",
    { From: "+19055550123", Body: "STOP", To: "+12495550100" },
    "auth-token"
  ));
});

test("ordinary inbound SMS forwarding only permits the Vapi HTTPS upstream", () => {
  assert.equal(
    normalizeSmsUpstreamUrl("https://api.vapi.ai/twilio/inbound/test"),
    "https://api.vapi.ai/twilio/inbound/test"
  );
  assert.throws(
    () => normalizeSmsUpstreamUrl("https://example.invalid/collect"),
    /not allowed/i
  );
  assert.throws(
    () => normalizeSmsUpstreamUrl("http://api.vapi.ai/insecure"),
    /not allowed/i
  );
});

test("ordinary inbound SMS is re-signed and forwarded to the stored Vapi route", async () => {
  const calls = [];
  const upstreamUrl = "https://api.vapi.ai/twilio/inbound/test";
  const params = {
    From: "+19055550123",
    To: "+12495550100",
    Body: "Can you call me tomorrow?",
    MessageSid: "SM_ORDINARY",
  };
  const result = await forwardSmsToUpstream({
    phoneNumber: params.To,
    params,
    authToken: "twilio-auth-token",
    prismaClient: {
      smsInboundRoute: {
        findUnique: async ({ where }) => {
          assert.equal(where.phoneNumber, params.To);
          return { upstreamUrl, upstreamMethod: "POST" };
        },
      },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/xml" }),
        text: async () => "<Response></Response>",
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, upstreamUrl);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(
    calls[0].options.headers["X-Twilio-Signature"],
    getTwilioSignature(upstreamUrl, params, "twilio-auth-token")
  );
  assert.equal(new URLSearchParams(calls[0].options.body).get("Body"), params.Body);
  assert.equal(result.body, "<Response></Response>");
  assert.equal(result.upstreamHost, "api.vapi.ai");
});

test("preference records are global per phone number and can be resumed", async () => {
  const writes = [];
  const prismaClient = {
    smsSuppression: {
      upsert: async (operation) => {
        writes.push(operation);
        const data = writes.length === 1 ? operation.create : operation.update;
        return { ...data, updatedAt: new Date("2026-07-24T05:00:00.000Z") };
      },
    },
  };
  const stopped = await recordSmsPreference({
    phoneNumber: "905-788-5488",
    keyword: "STOP",
    messageSid: "SM_STOP",
    prismaClient,
  });
  const resumed = await recordSmsPreference({
    phoneNumber: "+19057885488",
    keyword: "START",
    messageSid: "SM_START",
    prismaClient,
  });
  assert.equal(writes[0].where.phoneNumber, "+19057885488");
  assert.equal(writes[0].create.suppressed, true);
  assert.equal(writes[1].where.phoneNumber, "+19057885488");
  assert.equal(writes[1].update.suppressed, false);
  assert.equal(stopped.suppressed, true);
  assert.equal(resumed.suppressed, false);
});
