const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normalizeSignupProvisioningPayload } = require('../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
const { registerSignupProvisioningContextForAttempt, loadSignupProvisioningContextForAttempt, contextStoreKey } = require('../server/signupProvisioningContext');
const { runProvisioningStep, provisioningStateKey } = require('../server/provisioningState');

test('real PostgreSQL binds concurrent legacy requests without duplicate or uncertain replay',
  { skip: process.env.RUN_SIGNUP_CONTEXT_POSTGRES !== '1', timeout: 60000 }, async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.ok(/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname)
      || process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci');
    const { PrismaClient } = require('@prisma/client'), prisma = new PrismaClient(), keys = [];
    try {
      const raw = { event: 'signup.completed', business: { name: `Isolated ${crypto.randomUUID()}` },
        owner: { email: 'synthetic@example.invalid', phone: '+19055550123' }, verification: { smsVerified: true } };
      const payload = normalizeSignupProvisioningPayload(raw, { signingSecret: 'isolated-test-only-context-signing-secret' });
      const eventKey = buildMakeSignupEventKey(raw), idempotencyKey = payload.provisioning.idempotencyKey, contextHash = payload.provisioning.contextHash;
      keys.push(contextStoreKey(idempotencyKey), provisioningStateKey('twilio-number', idempotencyKey));
      const results = await Promise.all(Array.from({ length: 8 }, () => registerSignupProvisioningContextForAttempt({ prisma, payload, eventKey })));
      assert.ok(results.every(r => r.eventKey === eventKey));
      assert.notEqual(eventKey, buildMakeSignupEventKey(payload));
      assert.equal((await loadSignupProvisioningContextForAttempt({ prisma, idempotencyKey, contextHash })).eventKey, eventKey);
      const retry = await registerSignupProvisioningContextForAttempt({ prisma, payload, eventKey: `signup_${'a'.repeat(32)}` });
      assert.equal(retry.eventKey, eventKey);
      let submissions = 0;
      const input = { prisma, kind: 'twilio-number', idempotencyKey, contextHash,
        execute: async () => { submissions++; throw Object.assign(Error('inert transport lost acknowledgment'), { code: 'UND_ERR_SOCKET' }); } };
      await Promise.allSettled([runProvisioningStep(input), runProvisioningStep(input)]);
      await assert.rejects(runProvisioningStep(input), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' });
      assert.equal(submissions, 1);
      assert.equal((await prisma.runtimeStore.findUnique({ where: { key: contextStoreKey(idempotencyKey) } })).data.signupEventKey, eventKey);
    } finally {
      // Only synthetic keys created above, in an explicitly isolated database.
      if (keys.length) await prisma.runtimeStore.deleteMany({ where: { key: { in: keys } } });
      await prisma.$disconnect();
    }
  });
