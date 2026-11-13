const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  normalizeSignupProvisioningPayload, verifySignupProvisioningAuthorization,
  buildProvisioningResourceName, buildProvisioningAccountKey,
} = require('../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
const { signupBusinessKey, assertSignupOpen, isClosedSignup } = require('../server/signupBusinessIdentity');
const contextStore = require('../server/signupProvisioningContext');
const stateStore = require('../server/provisioningState');
const { selectSignupDashboardRecordForProvisioning } = require('../server/signupDashboardIdentity');

// Execute the actual callback and authorization loader, not a duplicate model
// of their logic. All storage is in-memory and every provider dependency is
// inert. No server is started, .env loaded, credential read, or network used.
const source = fs.readFileSync(require.resolve('../server/index'), 'utf8').replace(/\r\n/g, '\n');
function functionSource(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\nasync function ', start + 1);
  assert.ok(end > start, name);
  return source.slice(start, end);
}
const routeStart = source.indexOf('app.post(\n  "/api/integrations/vapi/import-twilio-number",');
assert.ok(routeStart > 0);
const routeSource = source.slice(routeStart, source.indexOf('\napp.post(', routeStart + 1));
const secret = 'offline-only-provisioning-binding-test-secret';
const number = '+13653874357'; // Existing number; never dialed or sent to.
const assistantId = 'fixture-existing-assistant';
const phoneId = 'fixture-existing-phone';

async function fixture({ routeCode = routeSource } = {}) {
  const raw = { event: 'signup.completed', business: { name: 'Fixture Electrical', phone: '+12895550111' },
    owner: { name: 'Fixture Owner', email: 'fixture@example.invalid', phone: '+19055550111' },
    verification: { smsVerified: true, emailVerified: false }, aiAssistant: { serviceArea: 'Niagara' } };
  const payload = normalizeSignupProvisioningPayload(raw, { signingSecret: secret });
  const eventKey = buildMakeSignupEventKey(raw), phantomId = buildMakeSignupEventKey(payload);
  assert.notEqual(eventKey, phantomId, 'Fixture must reproduce the normalization drift');
  const rows = new Map();
  let tail = Promise.resolve();
  const runtimeStore = {
    async findUnique({ where }) { return rows.has(where.key) ? { data: structuredClone(rows.get(where.key)) } : null; },
    async upsert({ where, update, create }) {
      const data = structuredClone(rows.has(where.key) ? update.data : create.data);
      rows.set(where.key, data); return { data };
    },
  };
  const attempt = { eventKey, ...raw, status: 'setup_error' };
  const prisma = { runtimeStore, signupAttempt: { findUnique: async ({ where }) => where.eventKey === eventKey ? attempt : null },
    $transaction(callback) {
      const result = tail.then(() => callback({ runtimeStore, $queryRaw: async () => [] }));
      tail = result.catch(() => {}); return result;
    } };
  await contextStore.registerSignupProvisioningContextForAttempt({ prisma, payload, eventKey });
  const receipts = {
    'twilio-number': { twilioPhoneNumber: number, sid: 'PNfixture-existing' },
    'vapi-assistant': { assistantId },
    'vapi-import': { id: phoneId, number, assistantId, status: 'active' },
  };
  for (const [kind, result] of Object.entries(receipts)) {
    rows.set(stateStore.provisioningStateKey(kind, payload.provisioning.idempotencyKey), {
      kind, contextHash: payload.provisioning.contextHash, status: 'completed', attempts: 1, result,
    });
  }
  const canonical = { signupAttemptId: eventKey, businessName: raw.business.name,
    ownerEmail: raw.owner.email, ownerPhone: raw.owner.phone, status: 'setup_error',
    smsVerified: true, emailVerified: false };
  const phantom = { ...canonical, signupAttemptId: phantomId, status: 'setup_started',
    twilioPhoneNumber: number, vapiAssistantId: assistantId, vapiPhoneNumberId: phoneId };
  const other = { ...canonical, signupAttemptId: 'signup_' + 'f'.repeat(32), businessName: 'Other Business', status: 'archived' };
  const records = new Map([canonical, phantom, other].map(x => [x.signupAttemptId, structuredClone(x)]));
  const updates = [], counters = { imports: 0, reconciliations: 0, deliveryChecks: 0, reads: 0 };
  const context = {
    prisma, ...contextStore, ...stateStore,
    getProvisioningAuthorizationInput: req => req.provisioningAuthorization,
    verifySignupProvisioningAuthorization, getProvisioningSigningSecret: () => secret,
    signupBusinessKey, assertSignupOpen, isClosedSignup, buildProvisioningResourceName, buildMakeSignupEventKey,
    normalizePhoneForMatch: x => x, normalizeVapiImportPhone: x => x,
    listSignupDashboardRecords: () => [...records.values()],
    assertSignupLegacyResourcesSafe: async (_payload, id) => assert.equal(id, eventKey),
    signupHasProvisioningOrBillingResources: x => Boolean(x.twilioPhoneNumber),
    verifySavedProvisioningResources: async () => { counters.reads++; return true; },
    isValidEmailAddress: x => x.includes('@'), isTrustedSignupProvisioningCanary: () => false,
    upsertSignupDashboardRecord: fields => {
      updates.push(structuredClone(fields));
      const value = { ...records.get(fields.signupAttemptId), ...fields };
      records.set(fields.signupAttemptId, value); return value;
    },
    safelyProvisionIsolatedSmsForSignup: async () => ({ healthy: true, toolId: 'fixture-tool' }),
    selectSignupDashboardRecordForProvisioning,
    testSignupAgentBeforeDelivery: async input => {
      counters.deliveryChecks++;
      assert.equal(input.signup.signupAttemptId, eventKey);
      assert.equal(input.signup.businessName, raw.business.name);
      assert.equal(input.signup.twilioPhoneNumber, number);
      assert.equal(input.normalizedPayload.provisioning.contextHash, payload.provisioning.contextHash);
      return { readiness: { passed: true }, simulated: true };
    },
    reconcileVapiPhoneNumberImport: async () => { counters.reconciliations++; return null; },
    importTwilioPhoneNumberToVapi: async () => { counters.imports++; throw Error('Provider mutation forbidden'); },
    safelyNotifyRuntimeFailure: () => {},
    signupRecoveryError: (message, code) => Object.assign(Error(message), { code }),
    requireProvisioningKey: () => {}, requireProvisioningAuthorization: () => {}, asyncRoute: fn => fn,
    app: { post(_path, ...handlers) { context.handler = handlers.at(-1); } },
  };
  vm.createContext(context);
  vm.runInContext(functionSource('loadTrustedProvisioningContext') + '\n'
    + functionSource('requireCompletedProvisioningStage') + '\n' + routeCode, context);
  async function run(body = {}) {
    let status, response;
    const req = { body: { twilioPhoneNumber: number, assistantId, signupAttemptId: phantomId, ...body },
      provisioningAuthorization: { ...payload.provisioning } };
    const res = { status(value) { status = value; return this; }, json(value) { response = value; } };
    await context.handler(req, res);
    return { status, response, req };
  }
  return { raw, payload, eventKey, phantomId, rows, records, context, run, updates, counters, attempt,
    contextKey: contextStore.contextStoreKey(payload.provisioning.idempotencyKey),
    stageKey: kind => stateStore.provisioningStateKey(kind, payload.provisioning.idempotencyKey) };
}

test('the pre-fix callback reproduces the orphaned original signup in the same offline fixture', async () => {
  const oldRoute = routeSource.replace('const signupAttemptId = req.signupProvisioningAttemptId;',
    'const signupAttemptId = buildMakeSignupEventKey(trustedPayload);');
  assert.notEqual(oldRoute, routeSource);
  const f = await fixture({ routeCode: oldRoute });
  f.context.testSignupAgentBeforeDelivery = async () => ({ readiness: { passed: true }, simulated: true });
  await f.run();
  assert.equal(f.records.get(f.eventKey).twilioPhoneNumber, undefined);
  assert.ok(f.updates.every(x => x.signupAttemptId === f.phantomId));
  assert.equal(f.counters.imports, 0);
});

test('existing purchase continues under the original binding, not the normalized or client-supplied ID', async () => {
  const f = await fixture(), beforePhantom = structuredClone(f.records.get(f.phantomId));
  const beforeOther = structuredClone(f.records.get('signup_' + 'f'.repeat(32)));
  const result = await f.run();
  assert.equal(result.status, 200); assert.equal(result.response.twilioPhoneNumber, number);
  assert.equal(result.response.phoneNumberId, phoneId); assert.equal(result.response.assistantId, assistantId);
  assert.equal(result.req.signupProvisioningAttemptId, f.eventKey);
  assert.ok(f.updates.length >= 2); assert.ok(f.updates.every(x => x.signupAttemptId === f.eventKey));
  assert.equal(f.records.size, 3, 'No additional dashboard record');
  assert.deepEqual(f.records.get(f.phantomId), beforePhantom, 'Old projection remains evidence, not silently deleted');
  assert.deepEqual(f.records.get('signup_' + 'f'.repeat(32)), beforeOther);
  assert.equal(f.records.get(f.eventKey).emailVerified, false, 'SMS verification must not become email verification');
  assert.equal(f.records.get(f.eventKey).twilioPhoneNumber, number);
  assert.equal(f.counters.imports, 0); assert.equal(f.counters.reconciliations, 0);
  assert.ok(f.counters.reads >= 3); assert.equal(f.counters.deliveryChecks, 1);
  assert.equal(f.rows.get(f.contextKey).signupEventKey, f.eventKey);
  assert.ok(f.rows.get(f.contextKey).completedAt);
});

test('repeated and simultaneous callbacks reuse the same three saved provider receipts', async () => {
  const f = await fixture();
  await Promise.all([f.run(), f.run()]); await f.run();
  assert.equal(f.counters.imports, 0); assert.equal(f.counters.reconciliations, 0);
  assert.equal(f.records.size, 3); assert.ok(f.updates.every(x => x.signupAttemptId === f.eventKey));
  assert.equal(f.rows.get(f.contextKey).signupEventKey, f.eventKey);
});

test('an unverified saved import cannot trigger replacement or mark the context complete', async () => {
  const f = await fixture();
  f.context.verifySavedProvisioningResources = async () => { throw Object.assign(Error('GET timeout'), { code: 'ETIMEDOUT' }); };
  await assert.rejects(f.run(), { code: 'ETIMEDOUT' });
  assert.equal(f.counters.imports, 0); assert.equal(f.counters.deliveryChecks, 0);
  assert.equal(f.rows.get(f.contextKey).completedAt, undefined); assert.equal(f.updates.length, 0);
});

test('missing prerequisite or different existing number stops before any import or readiness operation', async () => {
  for (const mode of ['missing', 'wrong-number']) {
    const f = await fixture();
    if (mode === 'missing') f.rows.delete(f.stageKey('twilio-number'));
    await assert.rejects(f.run(mode === 'wrong-number' ? { twilioPhoneNumber: '+13655550199' } : {}),
      { code: mode === 'missing' ? 'PROVISIONING_STAGE_DEPENDENCY_MISSING' : 'PROVISIONING_STAGE_RESULT_MISMATCH' });
    assert.equal(f.counters.imports, 0); assert.equal(f.counters.deliveryChecks, 0); assert.equal(f.updates.length, 0);
  }
});

test('closed source signup cannot be bypassed by a still-open normalized projection', async () => {
  const f = await fixture(); f.attempt.status = 'archived';
  await assert.rejects(f.run(), { code: 'SIGNUP_CLOSED' });
  assert.equal(f.counters.imports, 0); assert.equal(f.updates.length, 0);
});

test('tampered saved binding is rejected even when the caller supplies the correct original ID', async () => {
  const f = await fixture(); f.rows.get(f.contextKey).signupEventKey = 'not-an-attempt';
  await assert.rejects(f.run({ signupAttemptId: f.eventKey }), { code: 'PROVISIONING_ATTEMPT_BINDING_INVALID' });
  assert.equal(f.counters.imports, 0); assert.equal(f.updates.length, 0);
});

test('delivery gate failure is not presented as completed setup', async () => {
  const f = await fixture();
  f.context.testSignupAgentBeforeDelivery = async () => { throw Object.assign(Error('Gate stopped'), { code: 'AGENT_TEST_SETUP_INCOMPLETE' }); };
  await assert.rejects(f.run(), { code: 'AGENT_TEST_SETUP_INCOMPLETE' });
  assert.equal(f.rows.get(f.contextKey).completedAt, undefined);
  assert.equal(f.records.get(f.eventKey).status, 'setup_started');
  assert.ok(f.updates.every(x => x.signupAttemptId === f.eventKey)); assert.equal(f.counters.imports, 0);
});

test('readback uses the business-scoped context and refuses mixed or foreign receipt contexts', async () => {
  for (const mode of ['exact', 'wrong-binding', 'wrong-receipt', 'missing-context']) {
    const f = await fixture(), accountKey = f.payload.provisioning.idempotencyKey, reads = [];
    if (mode === 'wrong-binding') f.rows.get(f.contextKey).signupEventKey = f.phantomId;
    if (mode === 'wrong-receipt') f.rows.get(f.stageKey('vapi-import')).contextHash = 'c'.repeat(64);
    if (mode === 'missing-context') f.rows.delete(f.contextKey);
    Object.assign(f.context, { buildProvisioningAccountKey, contextStoreKey: contextStore.contextStoreKey,
      registeredSignupEventKey: contextStore.registeredSignupEventKey,
      assertPendingSignupRecoveryIdentity: () => ({ ownerEmail: f.raw.owner.email, ownerPhone: f.raw.owner.phone,
        businessName: f.raw.business.name, eventKey: f.eventKey }),
      readProvisioningStep: async input => { reads.push(input.idempotencyKey); return stateStore.readProvisioningStep(input); },
      fetchTwilioIncomingPhoneNumbers: async () => [], fetchVapiCollection: async () => [],
      findBusinessForSignup: async () => null, normalizeVapiImportPhone: x => x,
      getVapiPhoneNumber: x => x?.number, getVapiAssistantId: x => x?.assistantId, getVapiNestedString: () => '',
      assessAgentRouteBinding: () => ({}), TRIAL_USAGE_GATE_WEBHOOK_URL: 'https://fixture.invalid/trial',
      buildProvisioningReadbackAssessment: () => ({ complete: true, simulated: true }),
    });
    vm.runInContext(functionSource('reconcileAcknowledgedSignupProvisioning') + ';this.reconcile=reconcileAcknowledgedSignupProvisioning;', f.context);
    const subject = () => f.context.reconcile({ signup: f.records.get(f.eventKey), payload: f.raw });
    if (mode === 'exact') {
      assert.equal((await subject()).complete, true); assert.equal(reads.length, 3);
      assert.ok(reads.every(key => key === accountKey));
      assert.notEqual(accountKey, buildProvisioningAccountKey(f.raw.owner.email, f.raw.owner.phone));
    } else await assert.rejects(subject(), { code: 'SIGNUP_RECOVERY_CONTEXT_MISMATCH' });
    assert.equal(f.counters.imports, 0);
  }
});
