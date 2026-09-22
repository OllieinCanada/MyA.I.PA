const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSignupCompletionContent,
  deliverSignupCompletion,
  formatAssignedPhone,
} = require("../server/signupCompletion");

test("setup-complete content uses one canonical number in every representation", () => {
  const content = buildSignupCompletionContent({
    ownerName: "Ollie",
    businessName: "Example Electrical",
    assignedPhone: "+13433216155",
    dashboardUrl: "https://www.myaipa.ca/#/dashboard",
    forwardingSetupUrl: "https://www.myaipa.ca/#/forwarding-setup?token=signed",
  });
  assert.equal(content.phone, "+13433216155");
  assert.equal(content.displayPhone, "+1 (343) 321-6155");
  assert.match(content.sms, /\+1 \(343\) 321-6155/);
  assert.match(content.text, /protect the calls you miss/i);
  assert.match(content.sms, /Takes about 30 seconds/i);
  assert.match(content.sms, /forwarding-setup\?token=signed/i);
  assert.match(content.text, /https:\/\/www\.myaipa\.ca\/#\/dashboard/);
  assert.equal(formatAssignedPhone("343-321-6155"), "+1 (343) 321-6155");
});

test("setup-complete delivery reports both successful channels", async () => {
  const sent = [];
  const result = await deliverSignupCompletion({
    ownerPhone: "+19055550123",
    ownerEmail: "owner@example.com",
    businessName: "Example Electrical",
    assignedPhone: "+13433216155",
    sendSms: async (message) => sent.push(["sms", message]),
    sendEmail: async (message) => sent.push(["email", message]),
  });
  assert.equal(result.status, "sent");
  assert.deepEqual(result.channels, ["email", "sms"]);
  assert.equal(sent.length, 2);
});

test("setup-complete delivery is replay-safe after a prior success", async () => {
  let calls = 0;
  const result = await deliverSignupCompletion({
    priorStatus: "sent",
    ownerPhone: "+19055550123",
    assignedPhone: "+13433216155",
    sendSms: async () => { calls += 1; },
  });
  assert.equal(result.status, "sent");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_delivered");
  assert.equal(calls, 0);
});

test("setup-complete delivery treats unavailable optional email as skipped when SMS succeeds", async () => {
  const result = await deliverSignupCompletion({
    ownerPhone: "+19055550123",
    ownerEmail: "owner@example.com",
    assignedPhone: "+13433216155",
    sendSms: async () => {},
    sendEmail: async () => ({ skipped: true, reason: "smtp_not_configured" }),
  });
  assert.equal(result.status, "sent");
  assert.deepEqual(result.channels, ["sms"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skippedChannels, [{ channel: "email", reason: "smtp_not_configured" }]);
});

test("setup-complete delivery reconciles an existing SMS success without sending it twice", async () => {
  let calls = 0;
  const result = await deliverSignupCompletion({
    priorStatus: "partial",
    priorChannels: ["sms"],
    priorErrors: [{ channel: "email", code: "SMTP_NOT_CONFIGURED" }],
    ownerPhone: "+19055550123",
    assignedPhone: "+13433216155",
    sendSms: async () => { calls += 1; },
  });
  assert.equal(result.status, "sent");
  assert.equal(result.reason, "optional_email_unavailable");
  assert.deepEqual(result.channels, ["sms"]);
  assert.equal(calls, 0);
});

test("setup-complete delivery records a channel failure without hiding successful delivery", async () => {
  const error = Object.assign(new Error("SMTP rejected"), { providerCode: "SMTP_RECIPIENT_REJECTED" });
  const result = await deliverSignupCompletion({
    ownerPhone: "+19055550123",
    ownerEmail: "owner@example.com",
    assignedPhone: "+13433216155",
    sendSms: async () => {},
    sendEmail: async () => { throw error; },
  });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.channels, ["sms"]);
  assert.deepEqual(result.errors, [{ channel: "email", code: "SMTP_RECIPIENT_REJECTED" }]);
});
