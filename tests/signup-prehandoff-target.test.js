const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTarget, expectedServerHost } = require('./helpers/signup-prehandoff-postgres-worker');

test('SQL drill refuses remote, non-drill, wrong-protocol and implicit-port connection targets', () => {
  for (const url of ['postgresql://fixture:fake@database.example.invalid:5432/myaipa_recovery_drill_fixture',
    'postgresql://fixture:fake@127.0.0.1:5432/production',
    'postgresql://fixture:fake@127.0.0.1/myaipa_recovery_drill_fixture',
    'https://127.0.0.1:5432/myaipa_recovery_drill_fixture']) assert.throws(() => validateTarget(url));
  assert.equal(new URL(validateTarget('postgresql://fixture:fake@127.0.0.1:55432/myaipa_recovery_drill_fixture')).hostname, '127.0.0.1');
});
test('local SQL identity remains exact loopback and refuses container overrides', () => {
  assert.equal(expectedServerHost({}), '127.0.0.1');
  for (const flags of [{}, { CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    assert.throws(() => expectedServerHost({ ...flags, SIGNUP_DRILL_EXPECTED_SERVER_HOST: '172.18.0.2',
      SIGNUP_DRILL_SERVICE_CONTAINER_ID: 'a'.repeat(64) }));
  }
});
test('CI server identity requires complete exact service-container metadata', () => {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', SIGNUP_DRILL_SERVICE_CONTAINER_ID: 'a'.repeat(64),
    SIGNUP_DRILL_EXPECTED_SERVER_HOST: '172.18.0.2' };
  assert.equal(expectedServerHost(env), '172.18.0.2');
  for (const key of ['SIGNUP_DRILL_SERVICE_CONTAINER_ID', 'SIGNUP_DRILL_EXPECTED_SERVER_HOST']) {
    const partial = { ...env }; delete partial[key]; assert.throws(() => expectedServerHost(partial));
  }
});
test('CI refuses invalid, concatenated or hostname-only service identities', () => {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', SIGNUP_DRILL_SERVICE_CONTAINER_ID: 'a'.repeat(64) };
  for (const host of ['database.example.invalid', '172.18.0.2 172.18.0.3', '', '172.18.0.2/16', '::1']) {
    assert.throws(() => expectedServerHost({ ...env, SIGNUP_DRILL_EXPECTED_SERVER_HOST: host }));
  }
  assert.throws(() => expectedServerHost({ ...env, SIGNUP_DRILL_SERVICE_CONTAINER_ID: 'unknown', SIGNUP_DRILL_EXPECTED_SERVER_HOST: '172.18.0.2' }));
});
