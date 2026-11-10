const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { regionalAreaCodes, allowedAreaCodes } = require('../server/numberAreaPolicy');
const { normalizeSignupProvisioningPayload, verifySignupProvisioningAuthorization } = require('../server/signupProvisioning');
const secret = 'fixture-number-policy-signing-secret';
const input = { businessName: 'Fixture Electric', ownerEmail: 'fixture@example.test', ownerPhone: '+19055550198',
  businessPhone: '+19055550199', businessAddress: '23 Robb Street, Hamilton, ON L8L 1A1' };

test('Ontario overlays are ordered locally; unrelated areas and provinces remain strict', () => {
  assert.deepEqual(regionalAreaCodes('289', 'ON'), ['289', '905', '365', '742']);
  assert.deepEqual(regionalAreaCodes('365', 'ON'), ['365', '289', '905', '742']);
  assert.deepEqual(regionalAreaCodes('807', 'ON'), ['807']);
  assert.deepEqual(regionalAreaCodes('289', 'QC'), ['289']);
  assert.deepEqual(allowedAreaCodes('289', 'ON'), ['289']);
  for (const codes of [['365', '289'], ['289', '807'], ['289', '289'], [], '365', ['289', 365]]) {
    assert.throws(() => allowedAreaCodes('289', 'ON', codes), { code: 'PROVISIONING_AREA_CODE_POLICY_INVALID' });
  }
});

test('only explicitly opted-in new contexts gain signed alternatives; old signatures are preserved', () => {
  const old = normalizeSignupProvisioningPayload(input, { signingSecret: secret });
  assert.equal(old.provisioning.allowedAreaCodes, undefined);
  assert.equal(verifySignupProvisioningAuthorization(old, secret), true);
  const unchanged = normalizeSignupProvisioningPayload(old, { signingSecret: secret, allowRegionalFallback: true });
  assert.equal(unchanged.provisioning.allowedAreaCodes, undefined);
  assert.equal(unchanged.provisioning.contextHash, old.provisioning.contextHash);
  const next = normalizeSignupProvisioningPayload(input, { signingSecret: secret, allowRegionalFallback: true });
  assert.deepEqual(next.provisioning.allowedAreaCodes, ['289', '905', '365', '742']);
  assert.equal(verifySignupProvisioningAuthorization(next, secret), true);
  const tampered = structuredClone(next); tampered.provisioning.allowedAreaCodes.push('807');
  assert.equal(verifySignupProvisioningAuthorization(tampered, secret), false);
  const forged = normalizeSignupProvisioningPayload({ ...input, provisioning: { allowedAreaCodes: ['289', '807'] } }, { signingSecret: secret });
  assert.equal(forged.provisioning.allowedAreaCodes, undefined);
});

function purchaseFixture({ available = '365', failPurchase = false, owned = [], failSearch = false } = {}) {
  const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
  const start = source.indexOf('async function purchaseTwilioPhoneNumber(');
  const end = source.indexOf('\nasync function ', start + 1);
  const calls = [];
  const context = { URL, URLSearchParams, require: createRequire(require.resolve('../server/index')),
    TWILIO_ACCOUNT_SID: 'fixture', TWILIO_AUTH_TOKEN: 'fixture', TWILIO_API_BASE_URL: 'https://fixture.invalid',
    getTwilioAuthHeader: () => 'fixture', normalizeTwilioProvisioningAreaCode: x => x,
    normalizeTwilioProvisioningVoiceUrl: x => x, parseJsonObject: JSON.parse,
    inspectCanadianNumber: require('../server/canadianPhoneNumber').inspectCanadianNumber,
    validateProvisionedCanadianNumber: x => x.phone_number,
    createProviderHttpError: ({ fallbackCode }) => Object.assign(Error('fixture provider failure'), { code: fallbackCode }) };
  vm.createContext(context); vm.runInContext(source.slice(start, end) + ';this.subject=purchaseTwilioPhoneNumber;', context);
  const fetchImpl = async (url, options = {}) => {
    url = new URL(url); const method = options.method || 'GET';
    calls.push({ method, area: url.searchParams.get('AreaCode'), body: options.body });
    if (method === 'POST') {
      if (failPurchase) throw Object.assign(Error('lost acknowledgement'), { code: 'UND_ERR_SOCKET' });
      return new Response(JSON.stringify({ sid: 'PNfixture', phone_number: '+13655550123' }), { status: 201 });
    }
    if (url.pathname.includes('AvailablePhoneNumbers')) {
      if (failSearch) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ available_phone_numbers: url.searchParams.get('AreaCode') === available
        ? [{ phone_number: '+1' + available + '5550123' }] : [] }));
    }
    return new Response(JSON.stringify({ incoming_phone_numbers: owned }));
  };
  return { calls, run: alternatives => context.subject({ areaCode: '289', region: 'ON',
    allowedAreaCodes: alternatives, friendlyName: 'myaipa-twilio-number-' + 'a'.repeat(20),
    voiceUrl: 'https://fixture.invalid/voice' }, { fetchImpl }) };
}

test('actual purchase function searches ordered approved overlays and makes exactly one purchase; held reserve is ignored', async () => {
  const fixture = purchaseFixture({ owned: [{ friendly_name: 'myaipa-reserve-held-1', phone_number: '+13655550999',
    voice_url: 'https://fixture.invalid/voice', capabilities: { voice: true, sms: true } }] });
  const result = await fixture.run(['289', '905', '365', '742']);
  assert.equal(result.twilioPhoneNumber, '+13655550123');
  assert.deepEqual(fixture.calls.filter(x => x.area).map(x => x.area), ['289', '905', '365']);
  assert.equal(fixture.calls.filter(x => x.method === 'POST').length, 1);
});

test('old strict request never expands, and all-empty inventory never purchases', async () => {
  const strict = purchaseFixture();
  await assert.rejects(strict.run(), { code: 'LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE' });
  assert.deepEqual(strict.calls.filter(x => x.area).map(x => x.area), ['289']);
  const empty = purchaseFixture({ available: '' });
  await assert.rejects(empty.run(['289', '905', '365', '742']), { code: 'LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE' });
  assert.equal(empty.calls.filter(x => x.method === 'POST').length, 0);
});

test('uncertain purchase or search failure never triggers another purchase or broad search', async () => {
  const uncertain = purchaseFixture({ failPurchase: true });
  await assert.rejects(uncertain.run(['289', '905', '365', '742']), { code: 'UND_ERR_SOCKET' });
  assert.equal(uncertain.calls.filter(x => x.method === 'POST').length, 1);
  const unavailable = purchaseFixture({ failSearch: true });
  await assert.rejects(unavailable.run(['289', '905', '365', '742']), { code: 'TWILIO_NUMBER_SEARCH_FAILED' });
  assert.equal(unavailable.calls.length, 2);
  assert.equal(unavailable.calls.filter(x => x.method === 'POST').length, 0);
});
