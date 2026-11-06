'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { validateDrillTarget, workerEnvironment, syntheticInput } = require('../scripts/sms-dispatch-postgres-safety');
const { CASES } = require('../scripts/run-sms-dispatch-postgres-drill');
const target = 'postgresql://sms_drill:synthetic-ci-only@127.0.0.1:5432/myaipa_sms_dispatch_drill_ci?connection_limit=2';
const env = { RUN_SMS_DISPATCH_POSTGRES_DRILL: '1', SMS_DISPATCH_DRILL_DATABASE_URL: target };
test('drill accepts only its explicit disposable loopback target', () => assert.equal(validateDrillTarget(env), target));
test('drill never falls back to a production DATABASE_URL', () => assert.throws(() => validateDrillTarget({ RUN_SMS_DISPATCH_POSTGRES_DRILL: '1', DATABASE_URL: target }), /target_invalid/));
for (const [name, value] of Object.entries({ external: target.replace('127.0.0.1', 'db.example.test'),
  localhostAlias: target.replace('127.0.0.1', 'localhost'), wrongDatabase: target.replace('myaipa_sms_dispatch_drill_ci', 'production'),
  wrongUser: target.replace('sms_drill:', 'postgres:'), wrongPassword: target.replace('synthetic-ci-only', 'another'),
  wrongPort: target.replace(':5432/', ':6543/'), fragment: target+'#unexpected', extraOption: target+'&schema=other',
  duplicateOption: target+'&connection_limit=2', wrongScheme: target.replace('postgresql:', 'postgres:') })) {
  test('drill rejects '+name, () => assert.throws(() => validateDrillTarget({ ...env, SMS_DISPATCH_DRILL_DATABASE_URL: value }), /not_disposable_loopback/));
}
test('drill cannot silently skip when its execution flag is absent', () => assert.throws(() => validateDrillTarget({ SMS_DISPATCH_DRILL_DATABASE_URL: target }), /not_enabled/));
test('child workers do not inherit provider, admin, database or GitHub credentials', () => {
  const child = workerEnvironment({ PATH: 'test-path', VAPI_API_KEY: 'not-forwarded', TWILIO_AUTH_TOKEN: 'not-forwarded',
    ADMIN_PASSWORD: 'not-forwarded', DATABASE_URL: 'not-forwarded', GITHUB_TOKEN: 'not-forwarded', NODE_OPTIONS: 'not-forwarded' }, target);
  assert.deepEqual(Object.keys(child).sort(), ['DISABLE_LOCAL_ENV_FILES', 'PATH', 'RUN_SMS_DISPATCH_POSTGRES_DRILL', 'SMS_DISPATCH_DRILL_DATABASE_URL'].sort());
  assert.equal(child.DISABLE_LOCAL_ENV_FILES, '1');
});
test('synthetic transport identity and endpoints are fixed, not caller configurable', () => {
  const f = syntheticInput('sms-drill-11111111-1111-1111-1111-111111111111');
  assert.equal(f.env.TWILIO_ACCOUNT_SID, 'AC_INERT'); assert.equal(f.env.TWILIO_AUTH_TOKEN, 'INERT');
  assert.equal(f.env.SMS_NOTIFICATION_DISPATCH_URL, 'https://stub.invalid/dispatch');
  assert.equal(f.env.CALLER_NUMBER, '+19055550102'); assert.equal(f.args.workDetailsConfirmed, true);
  assert.throws(() => syntheticInput('real-call-id'), /case_invalid/);
});
test('real drill inventory includes process loss, uncertain outcomes and lock contention', () => {
  assert.equal(CASES.length, 10); assert.equal(new Set(CASES).size, 10);
  for (const item of ['concurrent_processes_and_completed_replay', 'crash_after_committed_claim',
    'crash_after_fake_submission', 'lost_completion_acknowledgement', 'real_advisory_lock_contention']) assert.ok(CASES.includes(item));
});
test('CI test job has read-only permissions, a disposable DB and no provider secrets or deployment command', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/sms-dispatch-postgres.yml'), 'utf8');
  assert.match(workflow, /contents: read/); assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /image: postgres:16/); assert.match(workflow, /npm run test:sms-dispatch:postgres/);
  assert.match(workflow, /if-no-files-found: error/); assert.doesNotMatch(workflow, /secrets\.|pull_request_target|--apply|render deploy|deploy:pages|pr_land/);
});
