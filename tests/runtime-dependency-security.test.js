const assert = require('node:assert/strict');
const test = require('node:test');
const { runtimeDependencySecurity, atLeast } = require('../server/runtimeDependencySecurity');

test('actual Express parser and mailer are the reviewed patched versions', () => {
  const result = runtimeDependencySecurity();
  assert.equal(result.ok, true);
  assert.equal(result.versions.express, '4.22.3');
  assert.equal(result.versions.bodyParser, '1.20.9');
  assert.equal(result.versions.nodemailer, '10.1.4');
});

test('security readiness fails closed for missing or affected dependencies', () => {
  const reader = versions => name => ({ version: versions[name.split('/')[0]] });
  assert.equal(runtimeDependencySecurity(reader({ express: '4.22.2', 'body-parser': '1.20.6', nodemailer: '10.1.4' })).ok, false);
  assert.equal(runtimeDependencySecurity(reader({ express: '4.22.2', 'body-parser': '1.20.9', nodemailer: '10.0.12' })).ok, false);
  assert.equal(runtimeDependencySecurity(() => { throw Error('unavailable'); }).ok, false);
  assert.equal(atLeast('1.20.9-beta', '1.20.9'), false);
  assert.equal(atLeast('1.20.10', '1.20.9'), true);
});

test('deployment verification requires the exact release, patched runtime and actual Render build command', async () => {
  const { verifyRelease } = require('../scripts/verify-backend-security-release');
  const commit = 'a'.repeat(40);
  const run = async overrides => {
    const values = [
      { ok: true, releaseCommit: commit, versions: { bodyParser: '1.20.9', nodemailer: '10.1.4' }, requestCompression: 'rejected-before-body-parsing', ...overrides?.security },
      { ok: true, releaseCommit: commit, ...overrides?.ready },
      { serviceDetails: { envSpecificDetails: { buildCommand: overrides?.buildCommand || 'npm ci --include=dev --legacy-peer-deps && npm run backend:prepare' } } },
    ];
    return verifyRelease({ commit, token: 'fixture-monitor', renderCredentials: { key: 'fixture-render' },
      fetchImpl: async () => ({ status: 200, json: async () => values.shift() }) });
  };
  assert.equal((await run()).ok, true);
  assert.equal((await run({ security: { versions: { bodyParser: '1.20.6', nodemailer: '10.1.4' } } })).ok, false);
  assert.equal((await run({ ready: { releaseCommit: 'b'.repeat(40) } })).ok, false);
  assert.equal((await run({ buildCommand: 'npm install' })).ok, false);
  await assert.rejects(verifyRelease({ commit: 'unknown', token: 'fixture' }), /exact deployed commit/);
});
