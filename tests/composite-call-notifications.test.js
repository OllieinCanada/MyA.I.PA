const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCustomerBody,
  buildNotificationKeys,
  buildOwnerBody,
  callerNumberFallbackPrompt,
  executeCompositeNotifications,
  getVapiCompositeToolCode,
  getVapiCompositeToolDefinition,
} = require("../server/compositeCallNotifications");

test("routing verification messages are explicit and promise no callback", () => {
  const routingTest = { businessName: "First Class Rentals Niagara", requestType: "routing_test" };
  assert.match(buildOwnerBody(routingTest), /MY AI PA TEST/);
  assert.match(buildCustomerBody(routingTest), /MY AI PA TEST/);
  assert.match(buildOwnerBody(routingTest), /No response or callback is required/);
  assert.match(buildCustomerBody(routingTest), /No response or callback is required/);
});

test("private constituent demo messages cannot imply official delivery or a callback", () => {
  const input = {
    businessName: "My AI PA private demonstration",
    requestType: "constituent_demo",
    name: "Test Caller",
    rawPhoneNumber: "+19055551234",
    city: "Grimsby",
    jobDetails: "passport application delay",
    preferredStartDate: "request a status follow-up",
    bestCallbackTime: "weekday afternoons",
    message: "The application has been delayed beyond the published estimate.",
  };
  const ownerBody = buildOwnerBody(input);
  const customerBody = buildCustomerBody(input);
  assert.match(ownerBody, /MY AI PA PRIVATE DEMO/);
  assert.match(ownerBody, /Unofficial test only/);
  assert.match(ownerBody, /not sent to Dean Allison or his office/i);
  assert.match(customerBody, /not sent to or received by Dean Allison or his office/i);
  assert.match(customerBody, /no response from that office is expected/i);
  assert.doesNotMatch(customerBody, /will call you back/i);
});

test("urgent tenant messages are visibly prioritized without promising dispatch or timing", () => {
  const input = {
    businessName: "First Class Rentals Niagara",
    requestType: "tenant_urgent",
    name: "Alex Martin",
    rawPhoneNumber: "+19055551234",
    jobDetails: "Furnace stopped working; no heat; no smoke, gas smell, or CO alarm reported",
    streetAddress: "23 Wiley Street, upstairs unit",
    city: "St. Catharines",
    bestCallbackTime: "As soon as available",
  };
  const ownerBody = buildOwnerBody(input);
  const customerBody = buildCustomerBody(input);
  assert.match(ownerBody, /^URGENT TENANT MESSAGE:/);
  assert.match(ownerBody, /response time and emergency dispatch are not guaranteed/i);
  assert.match(customerBody, /urgent tenant message/i);
  assert.match(customerBody, /not guaranteed/i);
  assert.match(customerBody, /call 911/i);
  assert.doesNotMatch(customerBody, /will call you back|right away|technician is on the way/i);
});

for (const requestType of ["tenant_maintenance", "tenant_complaint"]) {
  test(`${requestType} confirmation avoids a callback-time promise`, () => {
    const body = buildCustomerBody({ businessName: "First Class Rentals Niagara", requestType });
    assert.match(body, /received for review/i);
    assert.match(body, /response time is not guaranteed/i);
    assert.doesNotMatch(body, /will call you back|as soon as possible/i);
  });
}

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
    calls.push({
      to: params.get("To"),
      from: params.get("From"),
      body: params.get("Body"),
      statusCallback: params.get("StatusCallback"),
      authorization: options.headers?.Authorization,
    });
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
  assert.match(mock.calls[0].body, /^NEW LEAD/m);
  assert.match(mock.calls[0].body, /Preferred start: right away/);
  assert.match(mock.calls[0].body, /Best callback: afternoons or after 5 PM/);
  assert.match(mock.calls[0].body, /Urgency: Not provided/);
  assert.match(mock.calls[1].body, /Thanks for calling Example Electrical/);
  assert.match(mock.calls[1].body, /preferred callback time is afternoons or after 5 PM/i);
  assert.match(mock.calls[1].body, /preferred start timing is right away/i);
});

test("composite tool prefers API-key REST auth and requests delivery callbacks", async () => {
  const mock = makeFetch([]);
  await execute(mock.fetchImpl, {
    env: {
      TWILIO_API_KEY_SID: "SK_TEST",
      TWILIO_API_KEY_SECRET: "API_SECRET",
      TWILIO_STATUS_CALLBACK_URL: "https://api.example.test/api/twilio/message-status",
    },
  });
  const expected = `Basic ${Buffer.from("SK_TEST:API_SECRET").toString("base64")}`;
  assert.equal(mock.calls.length, 2);
  assert.ok(mock.calls.every((call) => call.authorization === expected));
  assert.ok(mock.calls.every((call) => call.statusCallback === "https://api.example.test/api/twilio/message-status"));
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

test("an owner transport outage is isolated and the customer confirmation still runs", async () => {
  let providerAttempt = 0;
  const calls = [];
  const fetchImpl = async (_url, options) => {
    if (String(options.headers?.["Content-Type"] || "").includes("application/json")) {
      return { ok: true, status: 200, json: async () => ({ allowed: true, suppressed: false }) };
    }
    const params = new URLSearchParams(String(options.body || ""));
    calls.push(params.get("To"));
    providerAttempt += 1;
    if (providerAttempt === 1) throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    return { ok: true, status: 201, json: async () => ({ sid: "SM_CUSTOMER", status: "queued" }) };
  };

  const result = await execute(fetchImpl);
  assert.deepEqual(calls, [env.DEFAULT_OWNER_TO_NUMBER, args.rawPhoneNumber]);
  assert.equal(result.owner.sent, false);
  assert.equal(result.owner.status, "transport_error");
  assert.equal(result.owner.errorCode, "ECONNRESET");
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

test("notification delivery fails closed when the consent service cannot be reached", async () => {
  let attempts = 0;
  const result = await execute(async () => {
    attempts += 1;
    throw new Error("consent service timed out");
  });
  assert.equal(attempts, 2);
  assert.equal(result.owner.attempted, false);
  assert.equal(result.owner.status, "suppression_check_unavailable");
  assert.equal(result.owner.errorCode, "suppression_check_unreachable");
  assert.equal(result.customer.attempted, false);
  assert.equal(result.customer.status, "suppression_check_unavailable");
  assert.equal(result.complete, false);
  assert.equal(result.requiresReconciliation, true);
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
  assert.match(prompt, /I've sent your information to the team\. Someone will contact you to discuss the request and arrange the next step\./);
  assert.match(prompt, /Do not add a promise about an appointment/);
  assert.match(prompt, /Let the entire final sentence finish before calling endCall/);
  assert.match(prompt, /before calling endCall/);
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
  assert.match(code, /TWILIO_API_KEY_SID/);
  assert.match(code, /return await executeCompositeNotifications/);
  assert.ok(definition.environmentVariableNames.includes("TWILIO_API_KEY_SID"));
  assert.ok(definition.environmentVariableNames.includes("TWILIO_API_KEY_SECRET"));
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
