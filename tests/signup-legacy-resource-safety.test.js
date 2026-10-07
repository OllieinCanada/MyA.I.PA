const test = require('node:test');
const assert = require('node:assert/strict');
const { signupBusinessKey } = require('../server/signupBusinessIdentity');
const { assertLegacyBusinessResourcesSafe, inspectArchivedSignupResources } = require('../server/signupLegacyResourceSafety');
const { signupAttentionItems } = require('../server/operationalAttention');
const record = { businessName: 'Doopers electrical', ownerEmail: 'owner@example.ca', ownerPhone: '+19055550123', signupAttemptId: 'old', status: 'abandoned_archived', twilioPhoneNumber: '+12895550123', vapiAssistantId: 'old-assistant' };
const readers = () => ({ readTwilioNumbers: async () => [], readVapi: async () => null, readSubscription: async () => null, readCheckout: async () => null, readCustomerSubscriptions: async () => [] });
const check = (r, inspectArchived) => assertLegacyBusinessResourcesSafe({ records: [r], businessKey: signupBusinessKey(record), attemptId: 'new', hasResources: () => true, inspectArchived });

test('archived historical IDs do not block after providers prove absence; history is preserved', async () => {
  const before = JSON.stringify(record);
  await check(record, r => inspectArchivedSignupResources(r, readers()));
  assert.equal(JSON.stringify(record), before);
});
test('an archived but still-owned number blocks duplicate provisioning', async () => {
  await assert.rejects(check(record, r => inspectArchivedSignupResources(r, { ...readers(), readTwilioNumbers: async () => [{ phone_number: record.twilioPhoneNumber }] })), { code: 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED' });
});
test('an archived but still-existing assistant or imported phone blocks', async () => {
  for (const r of [record, { ...record, vapiAssistantId: '', vapiPhoneNumberId: 'old-phone' }]) {
    await assert.rejects(check(r, x => inspectArchivedSignupResources(x, { ...readers(), readVapi: async () => ({ id: 'existing' }) })), { code: 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED' });
  }
});
test('a modern archived receipt is checked too, not blindly ignored', async () => {
  await assert.rejects(check({ ...record, provisioningBusinessKey: signupBusinessKey(record) }, async () => ({ state: 'live' })), { code: 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED' });
});
test('archived live billing blocks even when phone and assistant are absent', async () => {
  for (const r of [{ ...record, subscriptionId: 'sub' }, { ...record, customerId: 'customer' }, { ...record, checkoutSessionId: 'checkout' }]) {
    const io = { ...readers(), readSubscription: async () => ({ status: 'trialing' }), readCustomerSubscriptions: async () => [{ status: 'past_due' }], readCheckout: async () => ({ status: 'open' }) };
    await assert.rejects(check(r, x => inspectArchivedSignupResources(x, io)), { code: 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED' });
  }
});
test('completed checkout still checks its associated subscription', async () => {
  await assert.rejects(check({ ...record, checkoutSessionId: 'checkout' }, r => inspectArchivedSignupResources(r, { ...readers(), readCheckout: async () => ({ status: 'complete', subscription: 'sub' }), readSubscription: async () => ({ status: 'active' }) })), { code: 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED' });
});
test('canceled subscriptions and expired checkout receipts are historical, not live billing', async () => {
  await check({ ...record, subscriptionId: 'sub', customerId: 'customer', checkoutSessionId: 'checkout' }, r => inspectArchivedSignupResources(r, { ...readers(), readSubscription: async () => ({ status: 'canceled' }), readCheckout: async () => ({ status: 'expired' }), readCustomerSubscriptions: async () => [{ status: 'incomplete_expired' }] }));
});
test('provider outage, missing billing references and malformed evidence fail closed', async () => {
  for (const inspect of [async () => { throw new Error('401'); }, async () => ({ state: 'unknown' }), async () => null, r => inspectArchivedSignupResources({ ...r, subscriptionStatus: 'trialing' }, readers())]) {
    await assert.rejects(check(record, inspect), { code: 'SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED', statusCode: 503 });
  }
});
test('active legacy setup still requires migration; modern active setup uses existing idempotency', async () => {
  await assert.rejects(check({ ...record, status: 'setup_ready' }, async () => { throw Error('must not inspect'); }), { code: 'SIGNUP_BUSINESS_MIGRATION_REQUIRED' });
  await check({ ...record, status: 'setup_ready', provisioningBusinessKey: signupBusinessKey(record) }, async () => { throw Error('must not inspect'); });
});
test('another business sharing an owner cannot block this identity', async () => {
  await check({ ...record, businessName: 'Another business' }, async () => { throw Error('must not inspect'); });
});
test('the exact resource reason survives into the operational alert', () => {
  const items = signupAttentionItems([{ ...record, status: 'setup_error', archivedAt: null, makeError: 'MAKE_SIGNUP_REJECTED', makeResponseKind: 'rejected', makeProviderCode: 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED' }], new Date());
  assert.equal(items[0].incident.reasonCode, 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED');
  assert.match(items[0].incident.reason, /archived.*still exists/i);
});
