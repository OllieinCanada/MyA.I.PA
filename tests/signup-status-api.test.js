const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-signup-status-api-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DISABLE_LOCAL_ENV_FILES: "1",
  MAKE_SIGNUP_WEBHOOK_URL: "",
  DATA_DIR: temporaryData,
  DATABASE_URL: "",
  SECURITY_STATE_FORCE_DATABASE: "false",
  SIGNUP_STATUS_SECRET: "local-status-api-test-secret-at-least-32-characters",
  ADMIN_SESSION_SECRET: "local-verification-confirmation-test-secret",
  PROVISIONING_SIGNING_SECRET: "synthetic-job-signing-secret-at-least-32-characters",
  SIGNUP_SETUP_WORKER_PAUSED: "true",
  // An obsolete true approval setting must not hold new applications.
  SIGNUP_REQUIRE_MANUAL_APPROVAL: "true", SIGNUP_REQUIRE_VERIFICATION: "true",
  SIGNUP_VERIFICATION_BASE_URL: "https://api.myaipa.test",
  CAPTCHA_PROVIDER: "turnstile", TURNSTILE_SECRET_KEY: "synthetic-api-captcha-secret", RECAPTCHA_SECRET_KEY: "",
  CAPTCHA_ALLOWED_HOSTNAMES: "www.myaipa.ca",
  // This file exercises several CAPTCHA rejection cases from one loopback IP.
  // Dedicated rate-limit tests cover production thresholds separately.
  SIGNUP_IP_MAX_REQUESTS: "20",
  TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "",
  TWILIO_ACCOUNT_SID: "ACsynthetic", TWILIO_AUTH_TOKEN: "synthetic-secret", TWILIO_FROM_NUMBER: "+12895550100", TWILIO_API_KEY_SID: "", TWILIO_API_KEY_SECRET: "",
  VAPI_API_KEY: "", STRIPE_SECRET_KEY: "",
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
  TRIAL_REMINDER_DISABLE: "true", VAPI_AUTO_SYNC_ENABLED: "false",
  MISSED_CALL_ALERT_ENABLED: "false", DAILY_DIGEST_ENABLED: "false",
});

const { prisma } = require("../server/prisma");
const rows = new Map();
const pendingRows = new Map();
const { memoryDb } = require('./helpers/twilio-status-memory-db');
const jobDb = memoryDb();
prisma.runtimeStore.findUnique = jobDb.prisma.runtimeStore.findUnique;
prisma.runtimeStore.findMany = jobDb.prisma.runtimeStore.findMany;
prisma.runtimeStore.upsert = jobDb.prisma.runtimeStore.upsert;
prisma.runtimeStore.deleteMany = jobDb.prisma.runtimeStore.deleteMany;
prisma.$queryRaw = async () => [];
prisma.smsSuppression.findUnique = async () => null;
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
prisma.signupAttempt.updateMany = async ({ where, data }) => {
  let count = 0;
  for (const [key, row] of rows) {
    if (row.eventKey !== where.eventKey || where.status.notIn.includes(row.status)) continue;
    rows.set(key, { ...row, ...data, updatedAt: new Date() });
    count += 1;
  }
  return { count };
};

const { createSignupAttemptStore } = require("../server/signupAttemptStore");
const store = createSignupAttemptStore({ prisma, secret: process.env.SIGNUP_STATUS_SECRET });
const { app, __test: { processVerifiedSignupJobs } } = require("../server/index");
const nativeFetch = global.fetch;
let server;
let baseUrl;
let first;
let second;

before(async () => {
  // Refuse every external request, even if an unexpected credential is present.
  global.fetch = (url, options) => {
    if (String(url).startsWith('https://api.twilio.com/') && String(url).endsWith('/Messages.json') && options?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ sid: `SM${'a'.repeat(32)}`, status: 'delivered' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    }
    if (["https://challenges.cloudflare.com/turnstile/v0/siteverify", "https://www.google.com/recaptcha/api/siteverify"].includes(String(url))) {
      const google = new URL(url).hostname === "www.google.com";
      assert.equal(options.body.get("secret"), google ? "synthetic-api-google-secret" : "synthetic-api-captcha-secret");
      const valid = google
        ? ["synthetic-api-google-proof", "g".repeat(4096)].includes(options.body.get("response"))
        : options.body.get("response") === "synthetic-api-proof";
      return Promise.resolve(new Response(JSON.stringify({ success: valid, hostname: "www.myaipa.ca", "error-codes": valid ? [] : ["invalid-input-response"] }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    }
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

test('verified duplicate POST and old links reopen the existing setup without replaying providers, billing or texts', async () => {
  const { createPendingSignupVerificationStore } = require('../server/pendingSignupVerifications');
  const { createVerificationChannelProof } = require('../server/signupVerificationChannel');
  const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
  const { normalizeSignupProvisioningPayload } = require('../server/signupProvisioning');
  const { contextStoreKey } = require('../server/signupProvisioningContext');
  const { signupBusinessKey } = require('../server/signupBusinessIdentity');
  const { signupKeyFor, verifySetupToken } = require('../server/callForwardingService');
  const oldEnv = { url: process.env.MAKE_SIGNUP_WEBHOOK_URL, signing: process.env.PROVISIONING_SIGNING_SECRET, forwarding: process.env.FORWARDING_SETUP_SECRET };
  const oldRuntime = prisma.runtimeStore.findUnique, oldSetup = prisma.callForwardingSetup.findUnique, oldQuery = prisma.$queryRaw;
  prisma.$queryRaw = async () => [];
  const file = path.join(temporaryData, 'signup-dashboard.json');
  const originalDashboard = fs.existsSync(file) ? fs.readFileSync(file,'utf8') : '{}';
  process.env.MAKE_SIGNUP_WEBHOOK_URL = 'https://hook.us1.make.com/never-send-fixture';
  process.env.PROVISIONING_SIGNING_SECRET = 'synthetic-resume-signing-secret-at-least-32';
  process.env.FORWARDING_SETUP_SECRET = 'synthetic-forwarding-signing-secret-at-least-32';
  try {
    const base = { business: { name: 'Existing Fixture Electric', phone: '+19055550144', address: '1 Test Street, Hamilton, ON' },
      owner: { email: 'existing-fixture@example.invalid', phone: '+19055550144' }, verification: { smsVerified: true } };
    const canonicalPayload = normalizeSignupProvisioningPayload({ ...base, signupId: 'canonical-fixture' }, { signingSecret: process.env.PROVISIONING_SIGNING_SECRET });
    const canonicalId = buildMakeSignupEventKey(canonicalPayload), businessKey = signupBusinessKey(base);
    const identity = { businessName: base.business.name, ownerEmail: base.owner.email, ownerPhone: base.owner.phone, businessPhone: base.business.phone };
    const canonical = await store.register({ ...identity, eventKey: canonicalId, payload: canonicalPayload });
    await store.update(canonicalId, { status:'setup_ready', stage:'ready', assignedPhone:'+12895550199', vapiAssistantId:'fixture-assistant', reviewRequired:false });
    const sourcePayload = { ...base, signupId: 'new-verified-duplicate-fixture', verification: {} };
    const sourceId = buildMakeSignupEventKey(sourcePayload);
    await store.register({ ...identity, eventKey:sourceId, payload:sourcePayload });
    const saved = { ...identity, signupAttemptId:canonicalId, status:'setup_ready', twilioPhoneNumber:'+12895550199',
      vapiAssistantId:'fixture-assistant', vapiPhoneNumberId:'fixture-phone', provisioningBusinessKey:businessKey,
      businessId:25, forwardingSetupId:'fixture-setup', identityVerified:true, smsVerified:true, subscriptionId:'existing-only', subscriptionStatus:'trialing' };
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(originalDashboard), [`attempt:${canonicalId}`]:saved,
      [`attempt:${sourceId}`]:{...identity, signupAttemptId:sourceId, status:'pending_verification'} }));
    const contextKey = contextStoreKey(canonicalPayload.provisioning.idempotencyKey);
    prisma.runtimeStore.findUnique = async ({where}) => where.key === contextKey
      ? { key:contextKey, data:{ contextHash:canonicalPayload.provisioning.contextHash, payload:canonicalPayload, lockedAt:'now' } } : oldRuntime({where});
    const fixtureSetup = { id:'fixture-setup', businessId:25, assignedMyAiPaNumber:'+12895550199',
      signupKey:signupKeyFor({signupId:canonicalId,ownerEmail:identity.ownerEmail,existingBusinessNumber:identity.businessPhone}) };
    prisma.callForwardingSetup.findUnique = async ({where}) => where.id === fixtureSetup.id || where.signupKey === fixtureSetup.signupKey ? fixtureSetup : null;
    const pending = createPendingSignupVerificationStore({prisma});
    const token = await pending.create({ payload:sourcePayload, ownerEmail:identity.ownerEmail, businessName:identity.businessName });
    const proof = createVerificationChannelProof(token,'sms',process.env.ADMIN_SESSION_SECRET);
    const query = new URLSearchParams({token,channel:'sms',channelProof:proof});
    const url = `${baseUrl}/api/integrations/verify-signup-contact?${query}`;
    const preview = await (await fetch(url)).text();
    assert.doesNotMatch(preview,/555-0199/);
    assert.match(preview,/AI forwarding number will appear here/);
    const form = new URLSearchParams([...preview.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const response = await fetch(`${baseUrl}/api/integrations/verify-signup-contact`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
    const acknowledgment = await response.text();
    assert.match(acknowledgment,/preparing your assistant/i);
    assert.match(acknowledgment,/AI forwarding number will appear here/);
    assert.equal(jobDb.rows.get('signup-setup-job:v1:'+sourceId).data.status,'pending');
    await processVerifiedSignupJobs({force:true});
    const html = await (await fetch(url)).text();
    assert.equal(response.status,200,JSON.stringify(rows.get(sourceId))); assert.match(html,/Welcome back/); assert.match(html,/555-0199/);
    assert.doesNotMatch(html,/signup-number-wait|AI forwarding number will appear here/);
    assert.match(html,/Call the number/); assert.match(html,/Copy number/);
    assert.doesNotMatch(html,/Secure billing choice|Optional secure billing|No card was collected/);
    const { JSDOM } = require('jsdom');
    const document = new JSDOM(html).window.document;
    const continueLink = document.querySelector('#continue-forwarding');
    assert.equal(continueLink.textContent,'Tap Continue to get instant call forwarding');
    const forwardingToken = decodeURIComponent(new URL(continueLink.href).hash.slice('#/f/'.length));
    assert.equal(verifySetupToken(forwardingToken).sid,fixtureSetup.id);
    assert.equal(verifySetupToken(forwardingToken).sk,fixtureSetup.signupKey);
    assert.doesNotMatch(continueLink.href,/#\/dashboard/);
    const dashboard = JSON.parse(fs.readFileSync(file,'utf8'));
    delete dashboard[`attempt:${canonicalId}`].forwardingSetupId;
    fs.writeFileSync(file,JSON.stringify(dashboard));
    assert.match(html,/#\/f\//); assert.doesNotMatch(html,/signup-verification-form/);
    const beforeRows = JSON.stringify([...rows.values()]), beforeDashboard = fs.readFileSync(file,'utf8');
    for(let n=0;n<2;n++) {
      if(n===1) fixtureSetup.assignedMyAiPaNumber = '+12895550200';
      const page=await(await fetch(url)).text(); assert.match(page,/555-0199/);
      fixtureSetup.assignedMyAiPaNumber = '+12895550199';
      if(n===0) assert.match(page,/id="continue-forwarding"/);
      else {
        assert.doesNotMatch(page,/id="continue-forwarding"|#\/dashboard|#\/f\//);
        assert.match(page,/Call support for forwarding setup/);
      }
      const progress=await(await fetch(`${baseUrl}/api/signup/verification-progress?${query}`)).json();
      assert.equal(progress.signup.state,'ready'); assert.equal(progress.signup.assignedPhone,'+12895550199');
    }
    assert.equal(JSON.stringify([...rows.values()]),beforeRows); assert.equal(fs.readFileSync(file,'utf8'),beforeDashboard);
    assert.equal(rows.get(sourceId).status,'superseded_duplicate'); assert.equal(rows.get(canonicalId).status,'setup_ready');
    assert.equal(canonical.record.eventKey,canonicalId);
    for(const status of ['provisioning','setup_error','archived']) {
      rows.set(canonicalId,{...rows.get(canonicalId),status,assignedPhone:'',stage:status==='setup_error'?'needs_attention':'provisioning'});
      const progress=await(await fetch(`${baseUrl}/api/signup/verification-progress?${query}`)).json();
      assert.equal(progress.signup.assignedPhone,''); assert.equal(progress.signup.state,status==='provisioning'?'processing':'needs_attention');
    }
  } finally {
    fs.writeFileSync(file,originalDashboard); prisma.runtimeStore.findUnique=oldRuntime; prisma.callForwardingSetup.findUnique=oldSetup; prisma.$queryRaw=oldQuery;
    for(const [key,value] of Object.entries({MAKE_SIGNUP_WEBHOOK_URL:oldEnv.url,PROVISIONING_SIGNING_SECRET:oldEnv.signing,FORWARDING_SETUP_SECRET:oldEnv.forwarding})) {
      if(value===undefined)delete process.env[key]; else process.env[key]=value;
    }
  }
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
  const invalid = await request(first.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "   " }) });
  assert.equal(invalid.status, 400);
  const accepted = await request(first.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "I need help understanding my setup." }) });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).signup.supportRequested, true);
  assert.equal(rows.get(first.record.eventKey).supportDescription, "I need help understanding my setup.");
  assert.equal(rows.get(second.record.eventKey).supportRequestedAt, undefined);
  const short = await request(first.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "test" }) });
  assert.equal(short.status, 202);
  assert.match((await short.json()).message, /saved and queued/);
  const outboxPath = path.join(temporaryData, 'telegram-outbox.json');
  const outbox = JSON.parse(fs.readFileSync(outboxPath, 'utf8'));
  const supportItems = outbox.items.filter((item) => item.text.includes('CUSTOMER SUPPORT'));
  assert.equal(supportItems.length, 2, 'Different follow-up messages must not be suppressed');
  assert.ok(supportItems.some((item) => item.text.includes('Message preview: test')));
  assert.ok(supportItems.every((item) => item.text.includes('Reference: aaaaaaaaaa')));
  assert.ok(supportItems.every((item) => !item.text.includes('must-not-be-disclosed')));
  const repeated = await request(first.access, { suffix: "/support", method: "POST", body: JSON.stringify({ description: "test" }) });
  assert.equal(repeated.status, 202);
  assert.equal(JSON.parse(fs.readFileSync(outboxPath, 'utf8')).items.filter((item) => item.text.includes('CUSTOMER SUPPORT')).length, 2);
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
    security: { clientElapsedMs: 10000, captchaProvider: "turnstile", captchaToken: "synthetic-api-proof" },
  };
  const postSignup = (body = requestBody) => fetch(`${baseUrl}/api/integrations/signup-complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const missingIdentity = await postSignup({ ...requestBody, submissionId: undefined });
  assert.equal(missingIdentity.status, 400);
  assert.equal((await missingIdentity.json()).code, "SIGNUP_SUBMISSION_ID_REQUIRED");
  const initialAttempts = rows.size;
  const initialPending = pendingRows.size;
  for (const security of [{},
    { captchaProvider: "recaptcha", recaptchaToken: "fake", pageUrl: "http://localhost:3000" },
    { captchaProvider: "turnstile", captchaToken: "fake", pageUrl: "http://127.0.0.1:3000" }]) {
    const denied = await postSignup({ ...requestBody, security });
    assert.equal(denied.status, 400, await denied.clone().text());
    assert.equal((await denied.json()).code, "SIGNUP_CAPTCHA_FAILED");
    assert.equal(rows.size, initialAttempts, "Rejected CAPTCHA must not save a signup attempt");
    assert.equal(pendingRows.size, initialPending, "Rejected CAPTCHA must not begin verification");
  }
  const signup = await postSignup();
  assert.equal(signup.status, 202, await signup.clone().text());
  const result = await signup.json();
  assert.notEqual(result.reviewRequired, true);
  assert.equal(result.verificationRequired, true);
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
  assert.equal((await (await request(access)).json()).signup.state, "verification_required");
  assert.equal(attempt.reviewRequired, false);
  assert.ok(attempt.reviewReasons.includes('manual_approval_enabled'));

  const repeatedSignup = await postSignup();
  assert.equal(repeatedSignup.status, 202, await repeatedSignup.clone().text());
  const matchingPendingRows = [...pendingRows.values()].filter((row) => row.ownerEmail === "signup@example.invalid");
  assert.equal(matchingPendingRows.length, 1);
  assert.equal(new Set(matchingPendingRows.map((row) => row.payload.signupId)).size, 1);
});

test("dual CAPTCHA is enforced by the real signup endpoint before saving a customer", async () => {
  const previous = { provider: process.env.CAPTCHA_PROVIDER, google: process.env.RECAPTCHA_SECRET_KEY };
  process.env.CAPTCHA_PROVIDER = "turnstile+recaptcha";
  process.env.RECAPTCHA_SECRET_KEY = "synthetic-api-google-secret";
  try {
    const payload = { submissionId: "f7d7ae2b-6d25-4eec-a6bb-2ce5e012e0db", country: "ca",
      businessProfile: { businessName: "Synthetic Dual Protected Electric", phone: "+19055550115", address: "200 Test Street, Hamilton, ON" },
      setupDetails: { ownerName: "Synthetic Owner", ownerEmail: "dual-signup@example.invalid", ownerPhone: "+12895550115", businessType: "Electrical" },
      security: { captchaProvider: "turnstile+recaptcha", turnstileToken: "synthetic-api-proof", recaptchaToken: "synthetic-api-google-proof", clientElapsedMs: 10000 },
    };
    const initial = { attempts: rows.size, pending: pendingRows.size };
    for (const security of [{ ...payload.security, recaptchaToken: "" },
      { ...payload.security, captchaProvider: "turnstile" }, { ...payload.security, recaptchaToken: "fake" }]) {
      const denied = await fetch(`${baseUrl}/api/integrations/signup-complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...payload, security,
      }) });
      assert.equal(denied.status, 400);
      assert.equal((await denied.json()).resetCaptcha, true);
      assert.equal(rows.size, initial.attempts);
      assert.equal(pendingRows.size, initial.pending);
    }
    // Real endpoint regression: Google's proof must not inherit Cloudflare's 2048-character ceiling.
    const accepted = await fetch(`${baseUrl}/api/integrations/signup-complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      ...payload, security: { ...payload.security, recaptchaToken: "g".repeat(4096) },
    }) });
    assert.equal(accepted.status, 202, await accepted.clone().text());
    assert.equal(pendingRows.size, initial.pending + 1);
  } finally {
    process.env.CAPTCHA_PROVIDER = previous.provider;
    process.env.RECAPTCHA_SECRET_KEY = previous.google;
  }
});

test("link previews are read-only and only explicit confirmation advances a saved signup", async () => {
  const { createPendingSignupVerificationStore } = require("../server/pendingSignupVerifications");
  const pendingStore = createPendingSignupVerificationStore({ prisma });
  const payload = {
    signupId: "server-owned-verification-attempt",
    business: { name: "Synthetic Verify Electric", phone: "+19055550112" },
    owner: { name: "Synthetic Owner", email: "verify@example.invalid", phone: "+12895550112" },
  };
  const { buildMakeSignupEventKey } = require("../server/makeSignupWebhook");
  const attempt = await store.register({ eventKey: buildMakeSignupEventKey(payload), payload, status: "pending_email_verification" });
  const token = await pendingStore.create({ payload, ownerEmail: payload.owner.email, businessName: payload.business.name, reviewReasons: ["provider_ownership_conflict"], ttlMs: 3600000 });
  const verificationUrl = `${baseUrl}/api/integrations/verify-signup-contact?token=${encodeURIComponent(token)}`;
  const beforePreview = JSON.stringify([...pendingRows.values()]);
  const beforeAttempt = JSON.stringify(rows.get(attempt.record.eventKey));
  let html;
  for (const endpoint of [verificationUrl, verificationUrl.replace("verify-signup-contact", "verify-signup-email")]) {
    for (const method of ["GET", "HEAD"]) {
      const preview = await fetch(endpoint, { method });
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("cache-control"), "no-store");
      assert.equal(preview.headers.get("referrer-policy"), "no-referrer");
      const page = await preview.text();
      if (method === "GET") {
        html = page;
        assert.match(page, /Verify and continue/);
        assert.match(page, /form method="post"/);
        assert.doesNotMatch(page, /<span class="badge">Verified/);
      }
      assert.equal(JSON.stringify([...pendingRows.values()]), beforePreview, "Previews cannot claim or modify tokens");
      assert.equal(JSON.stringify(rows.get(attempt.record.eventKey)), beforeAttempt, "Previews cannot advance signup state");
    }
  }
  for (const body of [{ token }, { token, confirmation: "VERIFY_AND_CONTINUE", confirmationProof: "forged" }]) {
    const denied = await fetch(`${baseUrl}/api/integrations/verify-signup-contact`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(denied.status, 400);
    assert.match(await denied.text(), /Confirmation required/);
    assert.equal(JSON.stringify([...pendingRows.values()]), beforePreview);
    assert.equal(JSON.stringify(rows.get(attempt.record.eventKey)), beforeAttempt);
  }
  const form = new URLSearchParams();
  for (const [, name, value] of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) form.set(name, value);
  form.set("confirmation", "VERIFY_AND_CONTINUE");
  const verified = await fetch(`${baseUrl}/api/integrations/verify-signup-contact`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString(),
  });
  assert.equal(verified.status, 200, await verified.clone().text());
  assert.match(await verified.text(), /preparing your assistant/i);
  await processVerifiedSignupJobs({force:true});
  const status = (await (await request(attempt.access)).json()).signup;
  assert.equal(status.state, "needs_attention");
  assert.equal(status.assignedPhone, "");
  const pending = [...pendingRows.values()].find((row) => row.ownerEmail === payload.owner.email);
  assert.ok(pending.verifiedAt);
  assert.equal(pending.payload.verification.emailVerified, true);
});

test("a delayed completion cannot reopen an archived signup through its real status endpoint", async () => {
  await store.update(first.record.eventKey, { status: "abandoned_archived", stage: "closed" });
  await store.update(first.record.eventKey, { status: "setup_ready", stage: "ready", assignedPhone: "+12895550123" });
  const status = (await (await request()).json()).signup;
  assert.equal(status.state, "closed");
  assert.equal(status.assignedPhone, "");
  assert.equal(status.stage, "closed");
});

test("SMS confirmation continues past routine approval flags, preserves its channel and rejects expired links", async () => {
  const { createPendingSignupVerificationStore } = require("../server/pendingSignupVerifications");
  const { createVerificationChannelProof } = require("../server/signupVerificationChannel");
  const pendingStore = createPendingSignupVerificationStore({ prisma });
  const payload = { signupId: "sms-confirmation-attempt", business: { name: "SMS Test Electric" }, owner: { email: "sms-verify@example.invalid", phone: "+12895550113" } };
  const token = await pendingStore.create({ payload, ownerEmail: payload.owner.email, businessName: payload.business.name, reviewReasons: ["manual_approval_enabled"] });
  const proof = createVerificationChannelProof(token, "sms", process.env.ADMIN_SESSION_SECRET);
  const url = `${baseUrl}/api/integrations/verify-signup-contact?token=${token}&channel=sms&channelProof=${proof}`;
  const preview = await fetch(url);
  assert.equal(preview.status, 200);
  const html = await preview.text();
  assert.match(html, /signup-verification-form/);
  assert.match(html, /Your AI number will appear above/);
  assert.match(html, /visibilitychange/);
  assert.equal(pendingRows.get(pendingStore.tokenHash(token)).claimedAt, null);
  const form = new URLSearchParams();
  for (const [, name, value] of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) form.set(name, value);
  form.set("confirmation", "VERIFY_AND_CONTINUE");
  const verified = await fetch(`${baseUrl}/api/integrations/verify-signup-contact`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  // This isolated suite has no Make configuration. Continuing must reach the
  // real provisioning-failure path, not stop at the obsolete approval flag.
  assert.equal(verified.status, 200, await verified.clone().text());
  const resultHtml = await verified.text();
  assert.doesNotMatch(resultHtml, /manual review|Waiting for a setup review/);
  await processVerifiedSignupJobs({force:true});
  const record = pendingRows.get(pendingStore.tokenHash(token));
  assert.equal(record.payload.verification.smsVerified, true);
  assert.equal(record.payload.verification.emailVerified, false);
  assert.equal(record.payload.security.reviewRequired, false);
  assert.deepEqual(record.reviewReasons, ['provisioning_unreachable']);
  record.expiresAt = new Date(Date.now() - 1000);
  const expired = await fetch(url);
  assert.equal(expired.status, 400);
  assert.doesNotMatch(await expired.text(), /form method="post"/);
  assert.ok(pendingRows.has(pendingStore.tokenHash(token)), "Read-only expiry check does not prune records");
  const retry = await fetch(`${baseUrl}/api/integrations/verify-signup-contact`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  assert.equal(retry.status, 400);
  assert.match(await retry.text(), /invalid or expired/);
});

test("reopening a verified link resumes its exact attempt without provisioning, including after recovery",async()=>{
  const {createPendingSignupVerificationStore}=require('../server/pendingSignupVerifications');
  const {createVerificationChannelProof}=require('../server/signupVerificationChannel');
  const {buildMakeSignupEventKey}=require('../server/makeSignupWebhook');
  const pendingStore=createPendingSignupVerificationStore({prisma});
  const payload={signupId:'progress-resume-synthetic',business:{name:'Progress Test'},owner:{email:'progress@example.invalid'}};
  const attempt=await store.register({eventKey:buildMakeSignupEventKey(payload),payload,status:'review_required',stage:'needs_attention',reviewRequired:true});
  const token=await pendingStore.create({payload,ownerEmail:payload.owner.email,businessName:payload.business.name});
  const claim=await pendingStore.claim(token);
  await pendingStore.retainForRecovery(claim.tokenHash,{record:claim.record,payload,reviewReasons:['MAKE_SIGNUP_REJECTED']});
  const proof=createVerificationChannelProof(token,'sms',process.env.ADMIN_SESSION_SECRET);
  const query=new URLSearchParams({token,channel:'sms',channelProof:proof});
  const url=`${baseUrl}/api/integrations/verify-signup-contact?${query}`;
  const before=JSON.stringify([...pendingRows.values()]);
  const reopen=await fetch(url),html=await reopen.text();
  assert.equal(reopen.status,400);
  assert.match(html,/We found a setup issue/);
  assert.match(html,/verification-progress/);
  assert.doesNotMatch(html,/signup-verification-form|Assigned My AI PA number/);
  assert.equal(JSON.stringify([...pendingRows.values()]),before);
  const progressUrl=`${baseUrl}/api/signup/verification-progress?${query}`;
  assert.equal((await(await fetch(progressUrl)).json()).signup.state,'needs_attention');
  assert.equal((await fetch(progressUrl.replace(proof,'wrong'))).status,401);
  await store.update(attempt.record.eventKey,{status:'setup_ready',stage:'ready',reviewRequired:false,assignedPhone:'+12895550177'});
  await pendingStore.completeHash(claim.tokenHash);
  const ready=await(await fetch(url)).text();
  assert.match(ready,/Assigned My AI PA number/);
  assert.match(ready,/tel:\+12895550177/);
  assert.doesNotMatch(ready,/signup-verification-form/);
  await store.update(attempt.record.eventKey,{status:'abandoned_archived'});
  const closed=await(await fetch(url)).text();
  assert.match(closed,/This signup is closed/);
  assert.doesNotMatch(closed,/tel:\+12895550177/);
});
