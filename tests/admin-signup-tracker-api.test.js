const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerTrackerRoutes, businessInfo, infoRevision, trackProgress } = require('../server/adminSignupTracker');
const id = 'signup_' + 'a'.repeat(32), other = 'signup_' + 'b'.repeat(32);
let rows, audits, server, base, failAudit = false;
const originalFetch = global.fetch;
before(async () => {
  rows = [{ signupAttemptId: id, businessName: 'Synthetic Electrical', status: 'setup_started', identityVerified: true,
    ownerEmail: 'private@example.test', ownerPhone: '+12895550101', businessId: 44, subscriptionId: 'billing-do-not-change' },
  { signupAttemptId: other, businessName: 'Closed fixture', status: 'archived' }];
  rows[0].onboardingTracker = trackProgress({}, rows[0], Date.now() - 700000); audits = [];
  const app = express(); app.use(express.json());
  registerTrackerRoutes({ app, requireAdmin: (req, res, next) => req.headers['x-test-admin'] === 'yes' ? next() : res.status(401).json({ error: 'unauthorized' }),
    isAllowedOrigin: origin => origin === 'https://admin.example.test', list: () => rows,
    save: record => { const prior = rows.find(r => r.signupAttemptId === record.signupAttemptId); record.onboardingTracker = trackProgress(prior, record); rows = rows.map(r => r.signupAttemptId === record.signupAttemptId ? record : r); return record; },
    audit: async event => { if (failAudit) throw Error('synthetic audit unavailable'); audits.push(event); }, actorHash: () => 'test-actor' });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
  global.fetch = (url, options) => { assert.equal(new URL(url).origin, base, 'No real providers or notifications'); return originalFetch(url, options); };
});
after(async () => { global.fetch = originalFetch; await new Promise(resolve => server.close(resolve)); });
const headers = extra => ({ 'x-test-admin': 'yes', 'Content-Type': 'application/json', Origin: 'https://admin.example.test', 'X-MyAIPA-Admin-Editor': '1', ...extra });
const patch = (body, extra, target = id) => fetch(`${base}/api/admin/signups/${target}/business-info`, { method: 'PATCH', headers: headers(extra), body: JSON.stringify(body) });
test('tracker reads require admin and are non-mutating, private and non-cacheable', async () => {
  assert.equal((await fetch(base + '/api/admin/signup-tracker')).status, 401);
  const snapshot = JSON.stringify(rows);
  const r = await fetch(base + '/api/admin/signup-tracker', { headers: headers() }), data = await r.json();
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(data.rows.length, 2); assert.equal(data.summary.stalled, 1);
  assert.equal(JSON.stringify(rows), snapshot); assert.doesNotMatch(JSON.stringify(data), /private@example|5550101|billing-do-not-change/);
});
test('business edits require authentication plus trusted origin and anti-CSRF header', async () => {
  const body = { expectedRevision: infoRevision(rows[0]), details: businessInfo(rows[0]) };
  assert.equal((await patch(body, { 'x-test-admin': 'no' })).status, 401);
  for (const extra of [{ Origin: '' }, { Origin: 'https://evil.example.test' }, { 'X-MyAIPA-Admin-Editor': '' }, { 'Content-Type': 'text/plain' }]) assert.equal((await patch(body, extra)).status, 403);
});
test('server rejects protected changes and malformed/closed targets without writing', async () => {
  const before = JSON.stringify(rows), body = { expectedRevision: infoRevision(rows[0]), details: businessInfo(rows[0]) };
  assert.equal((await patch({ ...body, details: { ...body.details, businessName: 'hijack' } })).status, 400);
  assert.equal((await patch(body, {}, 'wrong')).status, 400);
  assert.equal((await patch(body, {}, other)).status, 409);
  assert.equal(JSON.stringify(rows), before);
});
test('canonical info is saved with concurrency checks, replay safety and a value-free audit trail', async () => {
  const previous = { ...rows[0] }, previousRevision = infoRevision(previous), details = { ...businessInfo(previous), serviceArea: 'Hamilton', serviceSummary: 'Panel upgrades' };
  const r = await patch({ expectedRevision: previousRevision, details }), data = await r.json();
  assert.equal(r.status, 200); assert.equal(data.publishedToReceptionist, false);
  assert.equal(rows[0].serviceArea, 'Hamilton'); assert.equal(rows[0].businessName, previous.businessName); assert.equal(rows[0].subscriptionId, previous.subscriptionId);
  assert.deepEqual(rows[0].onboardingTracker, previous.onboardingTracker);
  assert.equal((await patch({ expectedRevision: previousRevision, details })).status, 200);
  assert.equal((await patch({ expectedRevision: previousRevision, details: { ...details, serviceArea: 'Toronto' } })).status, 409);
  assert.equal(rows[0].serviceArea, 'Hamilton'); assert.match(JSON.stringify(audits), /edit_signup_business_info/);
  assert.doesNotMatch(JSON.stringify(audits), /Panel upgrades|Hamilton|private@example|5550101|billing-do-not-change/);
});
test('audit exceptions cannot swallow the response or turn a confirmed save into an unhandled rejection', async () => {
  failAudit = true;
  try {
    const record = rows[0], details = { ...businessInfo(record), serviceArea: 'Grimsby' };
    const r = await patch({ expectedRevision: infoRevision(record), details }), data = await r.json();
    assert.equal(r.status, 200); assert.equal(data.auditRecorded, false); assert.equal(rows[0].serviceArea, 'Grimsby');
    const denied = await patch({ expectedRevision: infoRevision(rows[0]), details: { ...details, ownerPhone: 'forbidden' } });
    assert.equal(denied.status, 400); assert.equal((await denied.json()).code, 'SIGNUP_INFO_FIELD_FORBIDDEN');
  } finally { failAudit = false; }
});
