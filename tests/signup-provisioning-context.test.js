const assert = require("node:assert/strict");
const test = require("node:test");

const {
  completeSignupProvisioningContext,
  loadSignupProvisioningContext,
  registerSignupProvisioningContext,
  registerSignupProvisioningContextForAttempt,
  registeredSignupEventKey,
  loadSignupProvisioningContextForAttempt,
} = require("../server/signupProvisioningContext");
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
const { normalizeSignupProvisioningPayload } = require('../server/signupProvisioning');

function fakePrisma() {
  const rows = new Map();
  const rawQueries = [];
  const runtimeStore = {
    async findUnique({ where }) { return rows.has(where.key) ? { key: where.key, data: rows.get(where.key) } : null; },
    async upsert({ where, update, create }) {
      const data = rows.has(where.key) ? update.data : create.data;
      rows.set(where.key, data);
      return { key: where.key, data };
    },
  };
  return {
    rawQueries,
    runtimeStore,
    async $transaction(callback) {
      return callback({
        runtimeStore,
        async $queryRaw(strings) {
          rawQueries.push(strings.join("?"));
          return [{ lock_result: "" }];
        },
      });
    },
  };
}

function payload(fill, hash) {
  return {
    business: { name: fill },
    provisioning: { idempotencyKey: "a".repeat(64), contextHash: hash.repeat(64) },
  };
}

test("the newest retry can replace an unlocked signup context", async () => {
  const prisma = fakePrisma();
  await registerSignupProvisioningContext({ prisma, payload: payload("first", "1") });
  const latest = await registerSignupProvisioningContext({ prisma, payload: payload("latest", "2") });
  assert.equal(latest.business.name, "latest");
  assert.equal((await loadSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "2".repeat(64),
  })).business.name, "latest");
  assert.ok(prisma.rawQueries.length >= 3);
  assert.ok(prisma.rawQueries.every((query) => /pg_advisory_xact_lock[\s\S]*::text AS lock_result/i.test(query)));
});

test("a paid-stage lock forces later retries to reuse the canonical context", async () => {
  const prisma = fakePrisma();
  const first = payload("first", "1");
  await registerSignupProvisioningContext({ prisma, payload: first });
  await loadSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "1".repeat(64),
  });
  const retry = await registerSignupProvisioningContext({ prisma, payload: payload("retry", "2") });
  assert.equal(retry.business.name, "first");
  assert.equal(retry.provisioning.contextHash, "1".repeat(64));
});

test("unregistered and mismatched contexts fail closed", async () => {
  const prisma = fakePrisma();
  await assert.rejects(loadSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "1".repeat(64),
  }), (error) => error.code === "PROVISIONING_CONTEXT_NOT_REGISTERED" && error.statusCode === 401);
});

test("completion is stored against the exact locked context", async () => {
  const prisma = fakePrisma();
  await registerSignupProvisioningContext({ prisma, payload: payload("first", "1") });
  const result = await completeSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "1".repeat(64),
    result: { phoneNumberId: "phone-1" },
  });
  assert.equal(result.phoneNumberId, "phone-1");
});

function verifiedLegacyPayload() {
  return { event: 'signup.completed', business: { name: 'Fixture Electrical', phone: '+12895550123' },
    owner: { name: 'Fixture', email: 'fixture@example.invalid', phone: '+19055550123' },
    verification: { smsVerified: true, emailVerified: false }, aiAssistant: { serviceArea: 'Niagara region' } };
}
const normalize = input => normalizeSignupProvisioningPayload(input, { signingSecret: 'isolated-test-secret-never-a-live-key' });

test('legacy payload without an explicit ID retains its original attempt through normalization', async () => {
  const raw = verifiedLegacyPayload(), eventKey = buildMakeSignupEventKey(raw), normalized = normalize(raw);
  // This is the production failure: enrichment changes the payload-derived hash.
  assert.notEqual(buildMakeSignupEventKey(normalized), eventKey);
  const prisma = fakePrisma();
  const bound = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalized, eventKey });
  assert.equal(bound.eventKey, eventKey);
  assert.deepEqual(bound.payload, normalized);
  assert.equal(bound.payload.signupEventKey, undefined); // no client-controlled identity field
  const loaded = await loadSignupProvisioningContextForAttempt({ prisma,
    idempotencyKey: normalized.provisioning.idempotencyKey, contextHash: normalized.provisioning.contextHash });
  assert.equal(loaded.eventKey, eventKey);
  assert.deepEqual(loaded.payload, normalized);
});

test('unstarted legacy context can acquire a binding without changing signed provider authorization', async () => {
  const prisma = fakePrisma(), raw = verifiedLegacyPayload(), normalized = normalize(raw);
  await registerSignupProvisioningContext({ prisma, payload: normalized });
  const bound = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalized, eventKey: buildMakeSignupEventKey(raw) });
  assert.equal(bound.eventKey, buildMakeSignupEventKey(raw));
  assert.equal(bound.payload.provisioning.authorizationToken, normalized.provisioning.authorizationToken);
});

test('same-context repeat deliveries retain the first binding rather than inventing another attempt', async () => {
  const prisma = fakePrisma(), raw = verifiedLegacyPayload(), normalized = normalize(raw);
  const first = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalized, eventKey: buildMakeSignupEventKey(raw) });
  const second = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalized, eventKey: `signup_${'c'.repeat(32)}` });
  assert.equal(second.eventKey, first.eventKey);
});

test('paid-stage locks preserve both the original context and binding across changed requests', async () => {
  const prisma = fakePrisma(), raw = verifiedLegacyPayload(), normalized = normalize(raw);
  const first = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalized, eventKey: buildMakeSignupEventKey(raw) });
  await loadSignupProvisioningContext({ prisma, idempotencyKey: normalized.provisioning.idempotencyKey, contextHash: normalized.provisioning.contextHash });
  const changed = normalize({ ...raw, aiAssistant: { serviceArea: 'Hamilton' } });
  const next = await registerSignupProvisioningContextForAttempt({ prisma, payload: changed, eventKey: buildMakeSignupEventKey({ ...raw, changed: true }) });
  assert.equal(next.eventKey, first.eventKey);
  assert.deepEqual(next.payload, first.payload);
});

test('historical locked context without a binding is not silently reassigned', async () => {
  const prisma = fakePrisma(), raw = verifiedLegacyPayload(), normalized = normalize(raw);
  await registerSignupProvisioningContext({ prisma, payload: normalized });
  await loadSignupProvisioningContext({ prisma, idempotencyKey: normalized.provisioning.idempotencyKey, contextHash: normalized.provisioning.contextHash });
  const result = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalized, eventKey: buildMakeSignupEventKey(raw) });
  assert.equal(result.eventKey, buildMakeSignupEventKey(normalized));
  assert.notEqual(result.eventKey, buildMakeSignupEventKey(raw));
});

test('completed contexts replay their saved binding and result without registration replacing them', async () => {
  const prisma = fakePrisma(), raw = verifiedLegacyPayload(), normalized = normalize(raw), eventKey = buildMakeSignupEventKey(raw);
  await registerSignupProvisioningContextForAttempt({ prisma, payload: normalized, eventKey });
  await completeSignupProvisioningContext({ prisma, idempotencyKey: normalized.provisioning.idempotencyKey,
    contextHash: normalized.provisioning.contextHash, result: { phoneNumberId: 'inert-receipt' } });
  const next = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalize({ ...raw, changed: true }), eventKey: `signup_${'d'.repeat(32)}` });
  assert.equal(next.eventKey, eventKey);
});

test('different email, phone or business name cannot share a context binding', async () => {
  const prisma = fakePrisma(), raw = verifiedLegacyPayload();
  const first = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalize(raw), eventKey: buildMakeSignupEventKey(raw) });
  for (const changed of [{ ...raw, owner: { ...raw.owner, email: 'other@example.invalid' } },
    { ...raw, owner: { ...raw.owner, phone: '+19055550999' } }, { ...raw, business: { ...raw.business, name: 'Other Electrical' } }]) {
    const result = await registerSignupProvisioningContextForAttempt({ prisma, payload: normalize(changed), eventKey: buildMakeSignupEventKey(changed) });
    assert.notEqual(result.eventKey, first.eventKey);
    assert.notEqual(result.payload.provisioning.idempotencyKey, first.payload.provisioning.idempotencyKey);
  }
});

test('invalid/missing server bindings are rejected before accessing storage', async () => {
  for (const eventKey of [undefined, '', 'attacker', 'signup_' + 'z'.repeat(32)]) {
    await assert.rejects(registerSignupProvisioningContextForAttempt({ payload: normalize(verifiedLegacyPayload()), eventKey }),
      { code: 'PROVISIONING_ATTEMPT_BINDING_INVALID' });
  }
  assert.throws(() => registeredSignupEventKey({ signupEventKey: 'bad', payload: verifiedLegacyPayload() }),
    { code: 'PROVISIONING_ATTEMPT_BINDING_INVALID' });
});
