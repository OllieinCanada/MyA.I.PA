const test = require('node:test');
const assert = require('node:assert/strict');
const { collectFunding, makeUsage } = require('../scripts/audit-provider-funding');
const { summarizeSeries, matchedUtilization } = require('../scripts/read-render-headroom');

test('headroom matches resource, timestamps and units instead of inventing capacity', () => {
  const series = (resource, unit, values) => ({ labels: [{ field: 'resource', value: resource }], unit, values });
  const timestamp = '2026-10-25T19:00:00Z';
  const usage = { series: summarizeSeries([series('database', 'bytes', [{ timestamp, value: 25 }]), series('other', 'bytes', [{ timestamp, value: 999 }])], 'database') };
  const limit = { series: summarizeSeries([series('database', 'bytes', [{ timestamp, value: 100 }])], 'database') };
  assert.equal(usage.series.length, 1);
  assert.equal(matchedUtilization(usage, limit).peakPercent, 25);
  assert.equal(matchedUtilization(usage, { series: [{ ...limit.series[0], unit: 'cores' }] }), null);
  assert.equal(matchedUtilization(usage, { series: [{ ...limit.series[0], points: [{ timestamp: '2026-10-25T18:00:00Z', value: 100 }] }] }), null);
  assert.equal(matchedUtilization(usage, { series: [] }), null);
});

test('empty, unknown and malformed metrics never become zero usage', () => {
  const series = summarizeSeries([{ labels: [{ field: 'resource', value: 'db' }], unit: 'bytes', values: [{ timestamp: 'invalid', value: 1 }, { timestamp: '2026-10-25T19:00:00Z', value: '100' }] }], 'db')[0];
  assert.equal(series.samples, 0);
  assert.equal(series.maximum, null);
  assert.equal(series.latest, null);
  assert.throws(() => summarizeSeries({}, 'db'), /Unrecognized/);
});
test('rolling Make usage never invents a billing-cycle balance', () => {
  const value = makeUsage([{ date: 'fixture', centicredits: 600 }]);
  assert.equal(value.rollingCredits, 6);
  assert.equal(value.billingCycleRemainingCredits, null);
  assert.equal(makeUsage([{ centicredits: 'invalid' }]), null);
});
test('read-only funding failures remain unknown, never payment or live-canary approval', async () => {
  const requests = [];
  const report = await collectFunding({ env: { TWILIO_ACCOUNT_SID: 'fixture', TWILIO_AUTH_TOKEN: 'never-print-secret' },
    credentials: { host: 'https://api.render.com/v1', key: 'never-print-secret' }, fetchImpl: async (url, options) => {
      requests.push(url); assert.equal(options.method, 'GET'); return { status: 401, json: async () => ({ message: 'never-print-secret' }) };
    } });
  assert.equal(report.liveCanaryFundingVerified, false);
  assert.equal(report.providers.vapi.httpStatus, 401);
  assert.equal(report.providers.twilio.paymentMethodStatus, 'unverified_dashboard_required');
  assert.doesNotMatch(JSON.stringify(report), /never-print-secret/);
  assert.equal(report.billingChanges, 0);
  assert.equal(requests.length, 8);
});
