const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-signup-status-api-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATA_DIR: temporaryData,
  DATABASE_URL: "",
  SECURITY_STATE_FORCE_DATABASE: "false",
  SIGNUP_STATUS_SECRET: "local-status-api-test-secret-at-least-32-characters",
  SIGNUP_REQUIRE_MANUAL_APPROVAL: "true", SIGNUP_REQUIRE_VERIFICATION: "false",
  TURNSTILE_SECRET_KEY: "", RECAPTCHA_SECRET_KEY: "", SIGNUP_CAPTCHA_REQUIRED: "false",
  TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "",
  TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_API_KEY_SID: "", TWILIO_API_KEY_SECRET: "",
  VAPI_API_KEY: "", STRIPE_SECRET_KEY: "",
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
  TRIAL_REMINDER_DISABLE: "true", VAPI_AUTO_SYNC_ENABLED: "false",
  MISSED_CALL_ALERT_ENABLED: "false", DAILY_DIGEST_ENABLED: "false",
});

const { prisma } = require("../server/prisma");
const rows = new Map();
const pendingRows = new Map();
prisma.$transaction = async (callback) => callback(prisma);
prisma.pendingSignupVerification.create = async ({ data }) => {
  const row = { ...data, usedAt: null, supersededAt: null, claimedAt: null };
  pendingRows.set(row.tokenHash, row);
  return row;
};
const matchesPending = (row, where = {}) => {
  if (where.tokenHash && row.tokenHash !== where.tokenHash) return false;
  if (where.purpose && row.purpose !== where.purpose) return false;
  for (const key of ["usedAt", "supersededAt", "claimedAt"]) {
    if (where[key] === null && row[key] != null) return false;
  }
  if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return false;
  if (where.OR) return where.OR.some((candidate) => {
    if (candidate.expiresAt?.lte) return row.expiresAt <= candidate.expiresAt.lte;
    if (candidate.usedAt?.not === null) return row.usedAt != null;
    if (candidate.supersededAt?.not === null) return row.supersededAt != null;
    if (candidate.ownerEmailNormalized) return row.ownerEmailNormalized === candidate.ownerEmailNormalized;
    return false;
  });
  return true;
};
prisma.pendingSignupVerification.deleteMany = async ({ where }) => {
  let count = 0;
  for (const [key, row] of pendingRows) if (matchesPending(row, where)) { pendingRows.delete(key); count += 1; }
  return { count };
};
prisma.pendingSignupVerification.updateMany = async ({ where, data }) => {
  let count = 0;
  for (const [key, row] of pendingRows) if (matchesPending(row, where)) { pendingRows.set(key, { ...row, ...data }); count += 1; }
  return { count };
};
prisma.pendingSignupVerification.findUnique = async ({ where }) => pendingRows.get(where.tokenHash) || null;
prisma.pendingSignupVerification.update = async ({ where, data }) => {
  const row = { ...pendingRows.get(where.tokenHash), ...data };
  pendingRows.set(where.tokenHash, row);
  return row;
};
prisma.signupAttempt.findUnique = async ({ where }) => [...rows.values()].find((row) => (
  (where.publicId && row.publicId === where.publicId) || (where.eventKey && row.eventKey === where.eventKey)
)) || null;
prisma.signupAttempt.create = async ({ data }) => {
  if (rows.has(data.eventKey)) {
    const error = new Error("Unique constraint failed");
    error.code = "P2002";
    throw error;
  }
  const row = { ...data, id: `row-${rows.size}`, createdAt: new Date(), updatedAt: new Date() };
  rows.set(data.eventKey, row);
  return row;
};
prisma.signupAttempt.upsert = async ({ where, create, update }) => {
  const existing = rows.get(where.eventKey);
  const row = { ...(existing || create), ...(existing ? update : {}), id: existing?.id || `row-${rows.size}`, updatedAt: new Date() };
  rows.set(where.eventKey, row);
  return row;
};
prisma.signupAttempt.update = async ({ where, data }) => {
  const row = [...rows.values()].find((item) => where.eventKey ? item.eventKey === where.eventKey : item.id === where.id);
  assert.ok(row);
  const updated = { ...row, ...data, updatedAt: new Date() };
  rows.set(updated.eventKey, updated);
  return updated;
};

const { createSignupAttemptStore } = require("../server/signupAttemptStore");
const store = createSignupAttemptStore({ prisma, secret: process.env.SIGNUP_STATUS_SECRET });
const { app } = require("../server/index");
const nativeFetch = global.fetch;
let server;
let baseUrl;
let first;
let second;

before(async () => {
  // Refuse every external request, even if an unexpected credential is present.
  global.fetch = (url, options) => {
    assert.equal(new URL(url).hostname, "127.0.0.1", "Local API tests must never contact a provider.");
    return nativeFetch(url, options);
  };
  first = await store.register({
    eventKey: `signup_${"a".repeat(32)}`, businessName: "Synthetic Pilot A",
    ownerEmail: "pilot-a@example.invalid", status: "review_required", reviewRequired: true,
    payload: { private: "must-not-be-disclosed" },
  });
  second = await store.register({ eventKey: `signup_${"b".repeat(32)}`, businessName: "Synthetic Pilot B" });
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  global.fetch = nativeFetch;
  await prisma.$disconnect();
  assert.equal(path.dirname(temporaryData), os.tmpdir());
  assert.ok(path.basename(temporaryData).startsWith("myaipa-signup-status-api-"));
  fs.rmSync(temporaryData, { recursive: true, force: true });
});

function request(access = first.access, options = {}) {
  const { suffix = "", token = access.token, ...rest } = options;
  return fetch(`${baseUrl}/api/signup/status/${access.id}${suffix}`, {
    ...rest,
    headers: { "content-type": "application/json", "x-signup-status-token": token, ...(rest.headers || {}) },
  });
}

test("real status endpoint requires the header credential and prevents cross-signup access", async () => {
  for (const options of [{ token: "" }, { token: "wrong" }, { token: second.access.token }, { token: "", suffix: `?token=${first.access.token}` }]) {
    assert.equal((await request(first.access, options)).status, 401);
  }
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.signup.state, "final_checks");
  assert.equal(body.signup.assignedPhone, "");
  const serialized = JSON.stringify(body);
  for (const hidden of ["pilot-a@example.invalid", "must-not-be-disclosed", first.access.token, process.env.SIGNUP_STATUS_SECRET]) {
    assert.ok(!serialized.includes(hidden));
  }
});

test("status endpoint follows saved workflow transitions without creating provider resources", async () => {
  await store.update(first.record.eventKey, { status: "setup_error", reviewRequired: false });
  assert.equal((await (await request()).json()).signup.state, "needs_attention");
  await store.update(first.record.eventKey, { status: "setup_ready", assignedPhone: "+12895550123" });
  const ready = (await (await request()).json()).signup;
  assert.equal(ready.state, "ready");
  assert.equal(ready.assignedPhone, "+12895550123");
  assert.equal(ready.terminal, true);
});

test("pre-activation support reaches the saved signup and cannot modify another signup", async () => {
  const denied = await request(first.access, { suffix: "/support", method: "POST", token: second.access.token, body: JSON.stringify({ description: "Help with this signup please." }) });
  assert.equal(denied.status, 401);
  const invalid = await request(first.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "short" }) });
  assert.equal(invalid.status, 400);
  const accepted = await request(first.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "I need help understanding my setup." }) });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).signup.supportRequested, true);
  assert.equal(rows.get(first.record.eventKey).supportDescription, "I need help understanding my setup.");
  assert.equal(rows.get(second.record.eventKey).supportRequestedAt, undefined);
});

test("expired status credentials are rejected on both status and support endpoints", async () => {
  await store.update(second.record.eventKey, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await request(second.access)).status, 401);
  assert.equal((await request(second.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "Please help with this signup." }) })).status, 401);
});

test("support endpoint limits repeated submissions", async () => {
  // Earlier support requests count toward the same eight-per-window limit.
  let last;
  for (let i = 0; i < 9; i += 1) {
    last = await request(first.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "Please help with this signup." }) });
    await last.text();
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});

test("web signup, pending verification, and dashboard share one server-owned identity", async () => {
  const requestBody = {
    signupId: "untrusted-client-attempt-id",
    submissionId: "e7d7ae2b-6d25-4eec-a6bb-2ce5e012e0da",
    country: "ca",
    businessProfile: { businessName: "Synthetic Signup Electric", phone: "+19055550111", address: "100 Test Street, Hamilton, ON" },
    setupDetails: { ownerName: "Synthetic Owner", ownerEmail: "signup@example.invalid", ownerPhone: "+12895550111", businessType: "Electrical" },
    callForwarding: { carrier: "other", lineType: "voip" },
    pricing: { offersServiceCalls: false },
    security: { clientElapsedMs: 10000 },
  };
  const postSignup = (body = requestBody) => fetch(`${baseUrl}/api/integrations/signup-complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const missingIdentity = await postSignup({ ...requestBody, submissionId: undefined });
  assert.equal(missingIdentity.status, 400);
  assert.equal((await missingIdentity.json()).code, "SIGNUP_SUBMISSION_ID_REQUIRED");
  const signup = await postSignup();
  assert.equal(signup.status, 202, await signup.clone().text());
  const result = await signup.json();
  assert.equal(result.reviewRequired, true);
  const access = { id: result.signupStatus.id, token: result.signupStatus.token };
  const attempt = await store.authenticate(access.id, access.token);
  assert.ok(attempt);
  const pending = [...pendingRows.values()].find((row) => row.ownerEmail === "signup@example.invalid");
  assert.ok(pending);
  assert.match(pending.payload.signupId, /^signup_[a-f0-9]{32}$/);
  assert.match(pending.payload.submissionId, /^[0-9a-f-]{36}$/);
  assert.notEqual(pending.payload.signupId, "untrusted-client-attempt-id");
  const { buildMakeSignupEventKey } = require("../server/makeSignupWebhook");
  assert.equal(buildMakeSignupEventKey(pending.payload), attempt.eventKey);
  assert.equal(buildMakeSignupEventKey({ ...pending.payload, verifiedAt: new Date().toISOString(), verification: { emailVerified: true } }), attempt.eventKey);
  const dashboard = JSON.parse(fs.readFileSync(path.join(temporaryData, "signup-dashboard.json"), "utf8"));
  const records = Array.isArray(dashboard) ? dashboard : dashboard.items || dashboard.records || Object.values(dashboard);
  assert.ok(records.some((row) => row.signupAttemptId === attempt.eventKey));
  assert.equal((await (await request(access)).json()).signup.state, "final_checks");

  const repeatedSignup = await postSignup();
  assert.equal(repeatedSignup.status, 202, await repeatedSignup.clone().text());
  const matchingPendingRows = [...pendingRows.values()].filter((row) => row.ownerEmail === "signup@example.invalid");
  assert.equal(matchingPendingRows.length, 1);
  assert.equal(new Set(matchingPendingRows.map((row) => row.payload.signupId)).size, 1);
});

test("opening a verification link advances the same saved status without provisioning a review-held signup", async () => {
  const { createPendingSignupVerificationStore } = require("../server/pendingSignupVerifications");
  const pendingStore = createPendingSignupVerificationStore({ prisma });
  const payload = {
    signupId: "server-owned-verification-attempt",
    business: { name: "Synthetic Verify Electric", phone: "+19055550112" },
    owner: { name: "Synthetic Owner", email: "verify@example.invalid", phone: "+12895550112" },
  };
  const { buildMakeSignupEventKey } = require("../server/makeSignupWebhook");
  const attempt = await store.register({ eventKey: buildMakeSignupEventKey(payload), payload, status: "pending_email_verification" });
  const token = await pendingStore.create({ payload, ownerEmail: payload.owner.email, businessName: payload.business.name, reviewReasons: ["manual_approval_enabled"], ttlMs: 3600000 });
  const verified = await fetch(`${baseUrl}/api/integrations/verify-signup-contact?token=${encodeURIComponent(token)}`);
  assert.equal(verified.status, 200, await verified.clone().text());
  assert.match(await verified.text(), /Contact verified/);
  const status = (await (await request(attempt.access)).json()).signup;
  assert.equal(status.state, "final_checks");
  assert.equal(status.assignedPhone, "");
});
