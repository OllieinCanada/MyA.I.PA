const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifySmsPreference,
  getTwilioSignature,
  normalizeSmsPhone,
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
