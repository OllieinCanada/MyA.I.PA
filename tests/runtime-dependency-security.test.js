const assert = require('node:assert/strict');
const test = require('node:test');
const { runtimeDependencySecurity, atLeast, nodeRuntimePatched } = require('../server/runtimeDependencySecurity');

test('actual Express parser and mailer are the reviewed patched versions', () => {
  const result = runtimeDependencySecurity();
  assert.equal(result.ok, true);
  assert.equal(result.versions.express, '4.22.3');
  assert.equal(result.versions.bodyParser, '1.20.9');
  assert.equal(result.versions.nodemailer, '10.1.4');
  assert.equal(result.versions.node, process.versions.node);
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
      { ok: true, releaseCommit: commit, versions: { node: '24.22.3', bodyParser: '1.20.9', nodemailer: '10.1.4' }, requestCompression: 'rejected-before-body-parsing', ...overrides?.security },
      { ok: true, releaseCommit: commit, ...overrides?.ready },
      { serviceDetails: { envSpecificDetails: { buildCommand: overrides?.buildCommand || 'npm ci --include=dev --legacy-peer-deps && npm run backend:prepare' } } },
    ];
    return verifyRelease({ commit, token: 'fixture-monitor', renderCredentials: { key: 'fixture-render' },
      fetchImpl: async () => ({ status: 200, json: async () => values.shift() }) });
  };
  assert.equal((await run()).ok, true);
  assert.equal((await run({ security: { versions: { node: '24.22.1', bodyParser: '1.20.9', nodemailer: '10.1.4' } } })).ok, false);
  assert.equal((await run({ security: { versions: { bodyParser: '1.20.9', nodemailer: '10.1.4' } } })).ok, false);
  assert.equal((await run({ security: { versions: { bodyParser: '1.20.6', nodemailer: '10.1.4' } } })).ok, false);
  assert.equal((await run({ ready: { releaseCommit: 'b'.repeat(40) } })).ok, false);
  assert.equal((await run({ buildCommand: 'npm install' })).ok, false);
  await assert.rejects(verifyRelease({ commit: 'unknown', token: 'fixture' }), /exact deployed commit/);
});

test('Node runtime policy rejects EOL, unpatched, unreviewed and prerelease versions', () => {
  for (const version of ['20.20.0', '22.23.5', '24.22.1', '24.22.2', '25.0.0', '26.13.1', '24.22.3-rc.1', '', undefined]) {
    // Explicitly exercise a missing attestation rather than the default local version.
    assert.equal(nodeRuntimePatched(version ?? ''), false, String(version));
  }
  for (const version of ['24.22.3', '24.22.4', '24.23.0']) assert.equal(nodeRuntimePatched(version), true);
});

test('security readiness cannot claim safe dependencies compensate for an unsafe Node runtime', () => {
  const read = name => ({ version: ({ express: '4.22.3', 'body-parser': '1.20.9', nodemailer: '10.1.4' })[name.split('/')[0]] });
  assert.equal(runtimeDependencySecurity(read, '24.22.3').ok, true);
  assert.equal(runtimeDependencySecurity(read, '24.22.2').ok, false);
});
