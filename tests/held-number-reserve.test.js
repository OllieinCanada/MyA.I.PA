const test = require('node:test');
const assert = require('node:assert/strict');
const { purchaseHeldReserve, assertHeld, CONFIRM } = require('../scripts/purchase-held-number-reserve');
function fixture(options = {}) {
  let journal = null, purchases = 0; const numbers = [];
  const api = {
    accountFingerprint: async () => 'fixture-account', price: async () => ({ currency: 'USD', monthly: options.price || 1.15 }),
    owned: async () => ({ complete: !options.incomplete, numbers }),
    available: async () => options.empty ? [] : [{ phone_number: '+1365555' + String(1000 + purchases).padStart(4, '0'), capabilities: { voice: true, SMS: true } }],
    buy: async ({ phoneNumber, friendlyName }) => {
      assert.equal(journal.slots.filter(s => s.status === 'dispatching').length, 1, 'write-ahead record required');
      purchases++; if (options.uncertain) throw Error('fixture lost acknowledgement');
      const row = { sid: 'PN' + String(purchases).padStart(32, '0'), phone_number: phoneNumber,
        friendly_name: friendlyName, capabilities: { voice: true, sms: true }, voice_url: options.routed ? 'https://fixture.invalid' : '' };
      numbers.push(row); return row;
    },
    number: async sid => numbers.find(n => n.sid === sid), assistantAttached: async () => !!options.assistant && purchases > 0,
  };
  return { api, run: () => purchaseHeldReserve({ api, approved: CONFIRM, load: async () => structuredClone(journal), save: async j => { journal = structuredClone(j); } }),
    count: () => purchases, journal: () => journal };
}
test('approved batch buys exactly five, keeps them unassigned and re-verifies without another purchase', async () => {
  const f = fixture(); const r = await f.run(); assert.equal(r.held, 5); assert.equal(r.assigned, 0);
  assert.equal(r.monthlyUSD, 5.75); assert.equal(f.count(), 5); assert.equal(f.journal().assignmentAuthorized, false);
  await f.run(); assert.equal(f.count(), 5);
});
test('unapproved price, incomplete inventory and empty stock never purchase', async () => {
  for (const options of [{ price: 1.16 }, { incomplete: true }, { empty: true }]) {
    const f = fixture(options); await assert.rejects(f.run()); assert.equal(f.count(), 0);
  }
});
test('lost purchase acknowledgement stops batch and persists a non-retryable hold', async () => {
  const f = fixture({ uncertain: true }); await assert.rejects(f.run(), /STOPPED_INSPECT/); assert.equal(f.count(), 1);
  await assert.rejects(f.run(), /PRIOR_PURCHASE_UNCERTAIN/); assert.equal(f.count(), 1);
});
test('unexpected routing or assistant attachment stops before a second purchase', async () => {
  for (const options of [{ routed: true }, { assistant: true }]) {
    const f = fixture(options); await assert.rejects(f.run(), /STOPPED_INSPECT/); assert.equal(f.count(), 1);
  }
});
test('exact approval is required before any provider operation', async () => {
  await assert.rejects(purchaseHeldReserve({ approved: 'yes' }), /EXACT_APPROVAL/);
});

test('all routing paths, including SIP trunks and application/service bindings, are rejected', () => {
  const clean = { phone_number: '+13655550123', capabilities: { voice: true, sms: true } };
  assert.doesNotThrow(() => assertHeld(clean));
  for (const key of ['voice_url', 'sms_url', 'voice_fallback_url', 'sms_fallback_url', 'status_callback',
    'voice_application_sid', 'sms_application_sid', 'messaging_service_sid', 'trunk_sid']) {
    assert.throws(() => assertHeld({ ...clean, [key]: 'fixture-binding' }), /NOT_VERIFIED_UNROUTED/);
  }
});
