const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildNotificationKeys,
  callerNumberFallbackPrompt,
  executeCompositeNotifications,
  getVapiCompositeToolCode,
  getVapiCompositeToolDefinition,
} = require("../server/compositeCallNotifications");

const args = {
  businessName: "Example Electrical",
  requestType: "installation",
  name: "Test Caller",
  rawPhoneNumber: "+19055551234",
  jobDetails: "hot tub electrical setup",
  streetAddress: "123 Test Street",
  city: "Hamilton",
  preferredStartDate: "right away",
  bestCallbackTime: "afternoons or after 5 PM",
};

const env = {
  TWILIO_ACCOUNT_SID: "AC_TEST",
  TWILIO_AUTH_TOKEN: "AUTH_TEST",
  DEFAULT_FROM_NUMBER: "+12495550100",
  DEFAULT_OWNER_TO_NUMBER: "+19055550123",
  CALL_ID: "call-test-123",
  SMS_SUPPRESSION_CHECK_URL: "https://api.example.test/api/integrations/sms/suppression/check",
  SMS_SUPPRESSION_API_KEY: "suppression-test-key",
};

function makeFetch(outcomes, { suppressed = [] } = {}) {
  const calls = [];
  const checks = [];
  const fetchImpl = async (url, options) => {
    if (String(options.headers?.["Content-Type"] || "").includes("application/json")) {
      const payload = JSON.parse(String(options.body || "{}"));
      checks.push({ url, phoneNumber: payload.phoneNumber, authorization: options.headers.Authorization });
      const isSuppressed = suppressed.includes(payload.phoneNumber);
      return {
        ok: true,
        status: 200,
        json: async () => ({ allowed: !isSuppressed, suppressed: isSuppressed }),
      };
    }
    const params = new URLSearchParams(String(options.body || ""));
    calls.push({ to: params.get("To"), from: params.get("From"), body: params.get("Body") });
    const outcome = outcomes[calls.length - 1] || { ok: true, status: 201, payload: { sid: `SM${calls.length}`, status: "queued" } };
    return { ok: outcome.ok, status: outcome.status, json: async () => outcome.payload };
  };
  return { calls, checks, fetchImpl };
}

function execute(fetchImpl, overrides = {}) {
  return executeCompositeNotifications({
    args: { ...args, ...(overrides.args || {}) },
    env: { ...env, ...(overrides.env || {}) },
    fetchImpl,
    btoaImpl: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    URLSearchParamsImpl: URLSearchParams,
  });
}

test("composite tool sends owner first and customer second", async () => {
  const mock = makeFetch([
    { ok: true, status: 201, payload: { sid: "SM_OWNER", status: "queued" } },
    { ok: true, status: 201, payload: { sid: "SM_CUSTOMER", status: "queued" } },
  ]);
  const result = await execute(mock.fetchImpl);
  assert.deepEqual(result.executionOrder, ["owner", "customer"]);
  assert.deepEqual(mock.calls.map((call) => call.to), [env.DEFAULT_OWNER_TO_NUMBER, args.rawPhoneNumber]);
  assert.equal(result.owner.sent, true);
  assert.equal(result.customer.sent, true);
  assert.equal(result.complete, true);
  assert.match(mock.calls[0].body, /Service request \(installation\)/);
  assert.match(mock.calls[1].body, /Thanks for calling Example Electrical/);
});

test("owner failure does not prevent the customer confirmation", async () => {
  const mock = makeFetch([
    { ok: false, status: 400, payload: { code: 21610 } },
    { ok: true, status: 201, payload: { sid: "SM_CUSTOMER", status: "queued" } },
  ]);
  const result = await execute(mock.fetchImpl);
  assert.equal(mock.calls.length, 2);
  assert.equal(result.owner.sent, false);
  assert.equal(result.owner.errorCode, "21610");
  assert.equal(result.customer.sent, true);
  assert.equal(result.partialSuccess, true);
  assert.equal(result.requiresReconciliation, true);
});

test("owner SMS can be disabled while customer confirmation remains successful", async () => {
  const mock = makeFetch([
    { ok: true, status: 201, payload: { sid: "SM_CUSTOMER", status: "queued" } },
  ]);
  const result = await execute(mock.fetchImpl, { env: { OWNER_SMS_ENABLED: "false" } });
  assert.deepEqual(result.executionOrder, ["customer"]);
  assert.deepEqual(mock.calls.map((call) => call.to), [args.rawPhoneNumber]);
  assert.equal(result.owner.attempted, false);
  assert.equal(result.owner.skipped, true);
  assert.equal(result.owner.status, "disabled_by_policy");
  assert.equal(result.customer.sent, true);
  assert.equal(result.ownerSmsEnabled, false);
  assert.equal(result.complete, true);
  assert.equal(result.requiresReconciliation, false);
});

test("customer failure preserves the successful owner result", async () => {
  const mock = makeFetch([
    { ok: true, status: 201, payload: { sid: "SM_OWNER", status: "queued" } },
    { ok: false, status: 400, payload: { code: 30007 } },
  ]);
  const result = await execute(mock.fetchImpl);
  assert.equal(result.owner.sent, true);
  assert.equal(result.customer.sent, false);
  assert.equal(result.customer.errorCode, "30007");
  assert.equal(result.complete, false);
});

test("a suppressed recipient is skipped before the provider request", async () => {
  const mock = makeFetch([], { suppressed: [args.rawPhoneNumber] });
  const result = await execute(mock.fetchImpl);
  assert.deepEqual(mock.calls.map((call) => call.to), [env.DEFAULT_OWNER_TO_NUMBER]);
  assert.deepEqual(mock.checks.map((check) => check.phoneNumber), [env.DEFAULT_OWNER_TO_NUMBER, args.rawPhoneNumber]);
  assert.equal(result.owner.sent, true);
  assert.equal(result.customer.sent, false);
  assert.equal(result.customer.skipped, true);
  assert.equal(result.customer.status, "suppressed");
  assert.equal(result.customer.errorCode, "recipient_opted_out");
  assert.equal(result.complete, false);
});

test("notification delivery fails closed when the consent service is unavailable", async () => {
  const mock = makeFetch([]);
  const result = await execute(mock.fetchImpl, { env: { SMS_SUPPRESSION_API_KEY: "" } });
  assert.equal(mock.calls.length, 0);
  assert.equal(result.owner.status, "suppression_check_unavailable");
  assert.equal(result.customer.status, "suppression_check_unavailable");
  assert.equal(result.complete, false);
});

test("protected environment numbers override any model-supplied routing", async () => {
  const mock = makeFetch([]);
  await execute(mock.fetchImpl, {
    args: { fromNumber: "+19055550000", toNumber: "+19055559999", rawPhoneNumber: "+19055557777" },
    env: { CALLER_NUMBER: "+19055556666" },
  });
  assert.deepEqual(mock.calls.map((call) => call.from), [env.DEFAULT_FROM_NUMBER, env.DEFAULT_FROM_NUMBER]);
  assert.deepEqual(mock.calls.map((call) => call.to), [env.DEFAULT_OWNER_TO_NUMBER, "+19055556666"]);
  assert.match(mock.calls[0].body, /\+19055556666/);
});

test("missing caller ID pauses before sending and requests one confirmed fallback number", async () => {
  const mock = makeFetch([]);
  const result = await execute(mock.fetchImpl, {
    args: { rawPhoneNumber: "", callbackNumber: "" },
    env: { CALLER_NUMBER: "" },
  });
  assert.equal(mock.calls.length, 0);
  assert.equal(result.needsCustomerNumber, true);
  assert.equal(result.owner.skipped, true);
  assert.equal(result.customer.skipped, true);
  assert.equal(result.complete, false);
});

test("a confirmed spoken fallback number is used when caller ID is unavailable", async () => {
  const mock = makeFetch([]);
  const result = await execute(mock.fetchImpl, {
    args: { rawPhoneNumber: "+19055558888" },
    env: { CALLER_NUMBER: "" },
  });
  assert.deepEqual(mock.calls.map((call) => call.to), [env.DEFAULT_OWNER_TO_NUMBER, "+19055558888"]);
  assert.equal(result.needsCustomerNumber, false);
  assert.equal(result.complete, true);
});

test("caller-number prompt acknowledges the calling number without exposing digits", () => {
  const prompt = callerNumberFallbackPrompt("send_call_summaries_test");
  assert.match(prompt, /I'll use the number you're calling from/);
  assert.match(prompt, /Do not claim you can see or recite the digits/);
  assert.match(prompt, /silent tool will verify caller-ID availability/);
  assert.match(prompt, /needsCustomerNumber is true/);
  assert.match(prompt, /MANDATORY TOOL GATE/);
  assert.match(prompt, /Do not speak a closing sentence/);
  assert.match(prompt, /call endCall before send_call_summaries_test returns/);
  assert.match(prompt, /earlier SMS tool names are retired and unavailable/);
  assert.match(prompt, /MYAIPA NATURAL POST-SEND CLOSING/);
  assert.match(prompt, /Is there anything else I can help you with today/);
  assert.match(prompt, /Stop and wait for the caller's answer/);
  assert.match(prompt, /Let the entire final sentence finish before calling endCall/);
  assert.match(prompt, /Never say "Goodbye" as a standalone closing/);
  assert.doesNotMatch(prompt, /Then call endCall immediately/);
});

test("caller-number prompt describes customer-only delivery when owner SMS is disabled", () => {
  const prompt = callerNumberFallbackPrompt("send_call_summaries_test", { ownerSmsEnabled: false });
  assert.match(prompt, /caller confirmation only/);
  assert.match(prompt, /Owner SMS is temporarily disabled by policy/);
  assert.doesNotMatch(prompt, /sends both the owner summary and the caller confirmation/);
});

test("recipient notification keys are stable and distinct", () => {
  assert.deepEqual(buildNotificationKeys("call-1"), buildNotificationKeys("call-1"));
  assert.notEqual(buildNotificationKeys("call-1").owner, buildNotificationKeys("call-1").customer);
  assert.notEqual(buildNotificationKeys("call-1").owner, buildNotificationKeys("call-2").owner);
});

test("generated Vapi code tool is self-contained and uses one structured call", () => {
  const definition = getVapiCompositeToolDefinition();
  const code = getVapiCompositeToolCode();
  assert.equal(definition.type, "code");
  assert.equal(definition.function.name, "send_call_summaries_dynamic");
  assert.deepEqual(definition.function.parameters.required, ["businessName", "requestType", "name"]);
  assert.doesNotMatch(JSON.stringify(definition.function.parameters), /fromNumber|toNumber/);
  assert.match(code, /executeCompositeNotifications/);
  assert.match(code, /DEFAULT_OWNER_TO_NUMBER/);
  assert.match(code, /checkSmsPermission/);
  assert.match(code, /suppression_check_unavailable/);
  assert.match(code, /return await executeCompositeNotifications/);
});

test("generated code executes inside the Vapi code-tool runtime shape", async () => {
  const calls = [];
  const fakeFetch = async (_url, options) => {
    if (String(options.headers?.["Content-Type"] || "").includes("application/json")) {
      return { ok: true, status: 200, json: async () => ({ allowed: true, suppressed: false }) };
    }
    const params = new URLSearchParams(String(options.body || ""));
    calls.push(params.get("To"));
    return { ok: true, status: 201, json: async () => ({ sid: `SM${calls.length}`, status: "queued" }) };
  };
  const runner = new Function(
    "args",
    "env",
    "fetch",
    "btoa",
    "URLSearchParams",
    `return (async () => {\n${getVapiCompositeToolCode()}\n})()`
  );
  const result = await runner(
    args,
    env,
    fakeFetch,
    (value) => Buffer.from(String(value), "utf8").toString("base64"),
    URLSearchParams
  );
  assert.deepEqual(calls, [env.DEFAULT_OWNER_TO_NUMBER, args.rawPhoneNumber]);
  assert.equal(result.complete, true);
});
