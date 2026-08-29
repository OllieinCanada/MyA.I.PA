const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_TELEGRAM_TEXT_LENGTH,
  buildIncidentTelegramAlert,
  buildIncidentRemediationUpdate,
  humanizeIncidentReason,
  redactIncidentText,
  sendIncidentTelegramAlert,
  sendIncidentRemediationUpdate,
  validAdminUrl,
} = require("../server/incidentAlerts");

test("known incident reason codes produce plain-language explanations", () => {
  assert.match(humanizeIncidentReason("MAKE_SIGNUP_TIMEOUT"), /signup automation did not answer/i);
  assert.match(humanizeIncidentReason("20003"), /Twilio rejected the configured credentials/i);
  assert.match(humanizeIncidentReason("PHONE_NUMBER_PENDING"), /Canadian forwarding number has not been verified/i);
  assert.match(humanizeIncidentReason("VAPI_BUSINESS_ROUTE_CONFLICT"), /blocked the cross-business handoff/i);
});

test("unknown incident reason codes never present an unconfirmed cause as fact", () => {
  const message = humanizeIncidentReason("NEW_PROVIDER_MYSTERY", "Upstream returned an unfamiliar response");
  assert.match(message, /^Cause not confirmed yet\./);
  assert.match(message, /Reported detail:/);
  assert.match(humanizeIncidentReason("", ""), /^Cause not confirmed yet\./);
});

test("incident text redacts contact data, credentials, query strings, and provider IDs", () => {
  const sid = `AC${"a".repeat(32)}`;
  const jwt = `eyJ${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`;
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const raw = [
    "Owner: ollie@example.com / +1 (905) 555-0123",
    "Address: 123 Main Street, Hamilton L8L 1L1",
    "Authorization: Bearer secret-token-value-12345",
    "api_key=example-provider-credential",
    `sid=${sid}`,
    `jwt=${jwt}`,
    `request=${uuid}`,
    "url=https://api.example.com/provision?token=secret&email=ollie@example.com",
    "relative=/admin?token=secret",
  ].join("\n");
  const redacted = redactIncidentText(raw, { multiline: true, maxLength: 2_000 });

  for (const secret of ["ollie@example.com", "905", "123 Main Street", "L8L 1L1", "secret-token-value", "example-provider-credential", sid, jwt, uuid, "token=secret"]) {
    assert.equal(redacted.includes(secret), false, `should remove ${secret}`);
  }
  assert.match(redacted, /\[email removed\]/);
  assert.match(redacted, /\[phone removed\]/);
  assert.match(redacted, /\[provider id removed\]/);
  assert.match(redacted, /\[identifier removed\]/);
  assert.match(redacted, /\[street address removed\]/);
  assert.match(redacted, /\[query removed\]/);
});

test("credential values remain redacted when they immediately follow an address", () => {
  for (const raw of [
    "Customer at 123 Main Street token=private-secret hit an exception",
    "Customer at 123 Main Street password=hunter-two hit an exception",
    "Customer at 123 Main Street api_key=example-private-credential hit an exception",
  ]) {
    const redacted = redactIncidentText(raw, { maxLength: 500 });
    assert.doesNotMatch(redacted, /private-secret|hunter-two|example-private-credential/);
    assert.match(redacted, /\[removed\]/);
  }
});

test("quoted JSON credentials are removed before an incident is stored or sent", () => {
  const redacted = redactIncidentText(JSON.stringify({
    password: "private-secret",
    token: "token-secret",
    access_token: "access-secret",
    client_secret: "client-secret",
    accessToken: "camel-access-secret",
    refreshToken: "camel-refresh-secret",
    clientSecret: "camel-client-secret",
    apiSecret: "camel-api-secret",
    privateKey: "camel-private-secret",
    authToken: "camel-auth-secret",
    databaseUrl: "postgresql://db-user:db-password@db.internal/app",
    cookie: "session-secret",
    status: "failed",
  }), { maxLength: 1_000 });
  assert.doesNotMatch(redacted, /private-secret|token-secret|access-secret|client-secret|camel-access-secret|camel-refresh-secret|camel-client-secret|camel-api-secret|camel-private-secret|camel-auth-secret|db-user|db-password|session-secret/);
  assert.match(redacted, /status/);
});

test("provider environment credentials and connection-string passwords are redacted", () => {
  const redacted = redactIncidentText([
    "TWILIO_AUTH_TOKEN=private-twilio-token",
    "VAPI_API_KEY=private-vapi-key",
    "STRIPE_SECRET_KEY=private-stripe-key",
    "DATABASE_URL=postgresql://user:password@host/db",
    "Redis failed at redis://cache-user:cache-password@cache.internal:6379/0",
  ].join("\n"), { multiline: true, maxLength: 2_000 });
  assert.doesNotMatch(redacted, /private-twilio-token|private-vapi-key|private-stripe-key|user:password|cache-user|cache-password/);
  assert.match(redacted, /TWILIO_AUTH_TOKEN=\[removed\]/);
  assert.match(redacted, /VAPI_API_KEY=\[removed\]/);
  assert.match(redacted, /DATABASE_URL=\[removed\]/);
  assert.match(redacted, /redis:\/\/\[credentials removed\]@cache\.internal/);
});

test("incident alert includes every operational section and a redacted snapshot", () => {
  const text = buildIncidentTelegramAlert({
    severity: "critical",
    title: "Signup could not finish",
    whatFailed: "Canadian phone provisioning",
    reasonCode: "MAKE_SIGNUP_RESPONSE_INCOMPLETE",
    reason: "Accepted without assistant identifiers",
    impact: "No customer number or assistant was activated.",
    snapshot: {
      business: "Example Electric",
      ownerEmail: "private@example.com",
      ownerPhone: "+19055550123",
      makeStatus: 200,
      providerSid: `PN${"1".repeat(32)}`,
      setup: { phoneCreated: false, assistantCreated: false },
    },
    lastCheckpoint: "Signup record saved before provisioning.",
    nextAction: "Review the held signup before retrying Make.",
    remediation: {
      confidence: "high",
      hypothesis: "The automation returned an incomplete success envelope.",
      proposedSolution: "Reconcile Twilio and Vapi before any guarded retry.",
      safetyBoundary: "Do not purchase or create a second provider resource.",
    },
    incidentId: "incident-42",
    detectedAt: "2026-08-25T21:03:13.616Z",
  });

  for (const heading of ["WHAT FAILED", "REASON", "IMPACT", "SNAPSHOT", "LAST GOOD CHECKPOINT", "WORKING HYPOTHESIS", "MY AI PA RESPONSE", "SAFETY LIMIT", "DO THIS NEXT", "YOU ARE SIGNING IN TO"]) {
    assert.match(text, new RegExp(`(?:^|\\n)${heading}(?:\\n|$)`));
  }
  assert.match(text, /MAKE_SIGNUP_RESPONSE_INCOMPLETE|responded without all verified phone and assistant identifiers/i);
  assert.match(text, /Business: Example Electric/);
  assert.equal(text.includes("private@example.com"), false);
  assert.equal(text.includes("9055550123"), false);
  assert.equal(text.includes(`PN${"1".repeat(32)}`), false);
  assert.ok(text.length <= MAX_TELEGRAM_TEXT_LENGTH);
});

test("incident alert remains under the Telegram limit without dropping required sections", () => {
  const longValue = "provider detail ".repeat(1_000);
  const text = buildIncidentTelegramAlert({
    title: longValue,
    whatFailed: longValue,
    reasonCode: "UNKNOWN_CASE",
    reason: longValue,
    impact: longValue,
    snapshot: longValue,
    lastCheckpoint: longValue,
    nextAction: longValue,
  });

  assert.ok(text.length <= MAX_TELEGRAM_TEXT_LENGTH);
  for (const heading of ["WHAT FAILED", "REASON", "IMPACT", "SNAPSHOT", "LAST GOOD CHECKPOINT", "WORKING HYPOTHESIS", "MY AI PA RESPONSE", "SAFETY LIMIT", "DO THIS NEXT", "YOU ARE SIGNING IN TO"]) {
    assert.ok(text.includes(heading));
  }
});

test("remediation update clearly distinguishes verified recovery from a user action", () => {
  const resolved = buildIncidentRemediationUpdate({
    status: "resolved",
    incidentId: "abcdef1234567890abcdef12",
    actionTaken: "Ran a read-only readiness check.",
    verification: "API and database are healthy.",
    nextAction: "No action is required.",
  });
  assert.match(resolved, /MY AI PA — VERIFIED FIXED/);
  assert.match(resolved, /WHAT MY AI PA DID/);
  assert.match(resolved, /VERIFICATION/);
  assert.match(resolved, /WHAT HAPPENS NEXT/);

  const blocked = buildIncidentRemediationUpdate({
    status: "needs_user",
    incidentId: "abcdef1234567890abcdef12",
    actionTaken: "Stopped before changing billing.",
    verification: "No charge was attempted.",
    nextAction: "Add provider funds, then rerun health.",
  });
  assert.match(blocked, /MY AI PA — NEEDS YOU/);
  assert.match(blocked, /WHAT YOU NEED TO DO NEXT/);
  assert.ok(blocked.length <= MAX_TELEGRAM_TEXT_LENGTH);
});

test("sendIncidentRemediationUpdate posts the terminal lifecycle message", async () => {
  const requests = [];
  const result = await sendIncidentRemediationUpdate({
    status: "resolved",
    incidentId: "abcdef1234567890abcdef12",
    actionTaken: "Retried saved Telegram alerts.",
    verification: "Telegram accepted the queue and zero messages remain.",
    nextAction: "No action is required.",
    adminUrl: "https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12",
  }, {
    token: "bot-token",
    chatId: "chat-42",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 91 } }) };
    },
  });
  assert.equal(result.sent, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].text, /VERIFIED FIXED/);
  assert.doesNotMatch(requests[0].text, /WHAT FAILED/);
});

test("sendIncidentTelegramAlert posts the brief with an exact-admin button", async () => {
  const requests = [];
  const adminUrl = "https://www.myaipa.ca/#/admin?tab=attention&target=incident-42";
  const result = await sendIncidentTelegramAlert({
    severity: "high",
    whatFailed: "Owner text delivery",
    reasonCode: "30007",
    impact: "The owner did not receive the lead handoff.",
    snapshot: { deliveryStatus: "failed" },
    lastCheckpoint: "Lead was saved.",
    nextAction: "Open the handoff and review the carrier result.",
    adminUrl,
  }, {
    token: "bot-token",
    chatId: "chat-42",
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 88 } }),
      };
    },
  });

  assert.deepEqual(result, { sent: true, skipped: false, messageId: 88 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.telegram.org/botbot-token/sendMessage");
  assert.equal(requests[0].body.chat_id, "chat-42");
  assert.equal(requests[0].body.reply_markup.inline_keyboard[0][0].url, adminUrl);
  assert.equal(requests[0].body.reply_markup.inline_keyboard[0][0].text, "Open exact issue");
  assert.ok(requests[0].body.text.length <= MAX_TELEGRAM_TEXT_LENGTH);
});

test("sendIncidentTelegramAlert skips safely without Telegram credentials", async () => {
  let attempted = false;
  const result = await sendIncidentTelegramAlert({}, {
    token: "",
    chatId: "",
    fetchImpl: async () => {
      attempted = true;
    },
  });
  assert.deepEqual(result, { sent: false, skipped: true, reason: "telegram_not_configured" });
  assert.equal(attempted, false);
});

test("admin alert links reject unsafe or credential-bearing URLs", () => {
  assert.equal(validAdminUrl("javascript:alert(1)"), "");
  assert.equal(validAdminUrl("https://user:password@example.com/admin"), "");
  assert.equal(validAdminUrl("https://www.myaipa.ca/#/admin?tab=attention"), "https://www.myaipa.ca/#/admin?tab=attention");
});

test("sendIncidentTelegramAlert surfaces a rejected Telegram request", async () => {
  await assert.rejects(
    sendIncidentTelegramAlert({ whatFailed: "Provisioning" }, {
      token: "bot-token",
      chatId: "chat-42",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ ok: false, description: "Too Many Requests" }),
      }),
    }),
    /Too Many Requests/
  );
});

test("sendIncidentTelegramAlert rejects HTTP 200 responses without Telegram ok true", async () => {
  await assert.rejects(
    sendIncidentTelegramAlert({ whatFailed: "Provisioning" }, {
      token: "bot-token",
      chatId: "chat-42",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    }),
    /Telegram incident alert failed \(200\)/
  );
});
