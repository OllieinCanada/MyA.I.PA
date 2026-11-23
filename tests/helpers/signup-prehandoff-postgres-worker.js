// Disposable PostgreSQL only. No application startup, credentials or provider SDKs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PrismaClient } = require('@prisma/client');
const jobs = require('../../server/signupSetupJobs');
const { sanitizeMakeFailureEnvelope } = require('../../server/makeSignupWebhook');
const secret = 'synthetic-postgres-pre-handoff-secret-at-least-32';
function validateTarget(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/myaipa_recovery_drill_[a-z0-9_]+$/);
  assert.ok(Number(url.port) > 0);
  return url.toString();
}
function expectedServerHost(env = process.env) {
  if (env.CI === 'true' && env.GITHUB_ACTIONS === 'true') {
    assert.match(env.SIGNUP_DRILL_SERVICE_CONTAINER_ID || '', /^[a-f0-9]{12,64}$/);
    assert.equal(require('node:net').isIP(env.SIGNUP_DRILL_EXPECTED_SERVER_HOST || ''), 4);
    return env.SIGNUP_DRILL_EXPECTED_SERVER_HOST;
  }
  assert.ok(!env.SIGNUP_DRILL_SERVICE_CONTAINER_ID && !env.SIGNUP_DRILL_EXPECTED_SERVER_HOST,
    'Container address overrides are only accepted in the disposable GitHub service job');
  return '127.0.0.1';
}
function client(url) {
  return new PrismaClient({ datasources: { db: { url: validateTarget(url) } },
    __internal: { configOverride: c => ({ ...c, relativeEnvPaths: {} }) } });
}
const source = fs.readFileSync(require.resolve('../../server/index'), 'utf8');
function classifier() {
  const start = source.indexOf('function makeFailureFromError(');
  const end = source.indexOf('\nasync function safelyNotifySignupOperations', start);
  assert.ok(start > 0 && end > start);
  return vm.runInNewContext(`${source.slice(start, end)}; makeFailureFromError`, {
    sanitizeMakeFailureEnvelope, isSetupDatabaseError: jobs.isSetupDatabaseError,
  });
}
function actualSetup(dispatch, reconcile = async () => null) {
  const start = source.indexOf('async function processVerifiedSignupSetup(');
  const end = source.indexOf('\napp.post(', start);
  assert.ok(start > 0 && end > start);
  const observed = { dashboard: [], retained: 0, alerts: 0 };
  const context = { Date, compactObject: x => x,
    buildVerificationState: () => ({ smsVerified: true, emailVerified: false }),
    signupReviewPolicy: () => ({ reviewRequired: false, advisoryReasons: [] }),
    registerSignupAttempt: async () => ({ record: { status: 'provisioning' } }),
    assertSignupOpen: () => {}, updateSignupAttempt: async () => {},
    upsertSignupDashboardFromPayload: (_, data) => { observed.dashboard.push(data); return data; },
    safelyNotifySignupOperations: async () => { observed.alerts++; return {}; },
    retainPendingSignupRecoveryPayload: async () => { observed.retained++; },
    sendMakeSignupCompleted: dispatch, reconcileCompletedMakeSignup: reconcile,
    makeFailureFromError: classifier(),
    makeFailureRecordFields: x => ({ makeFailureProvider: x.provider, makeFailedStage: x.failedStage }),
    isPreHandoffDatabaseRetry: jobs.isPreHandoffDatabaseRetry,
    console: { warn() {}, error() {} },
  };
  const run = vm.runInNewContext(`${source.slice(start, end)}; processVerifiedSignupSetup`, context);
  return { observed, run: (job, ctl) => run({ job, tokenHash: job.tokenHash, verificationChannel: 'sms',
    record: { verifiedAt: '2026-01-01T00:00:00Z', reviewReasons: [], payload: {
      owner: { email: 'synthetic@example.invalid' }, business: { name: 'Synthetic PostgreSQL fixture' },
    } } }, ctl) };
}
async function recordDispatch(prisma, key) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
    const old = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
    assert.equal(old, undefined, 'A second simulated provider dispatch is forbidden');
    await tx.runtimeStore.create({ data: { key, data: { simulatedDispatches: 1 } } });
  });
}
async function expireTransaction(prisma, marker) {
  // Native Prisma P2028, not an error manufactured by the fixture.
  await prisma.$transaction(async tx => {
    await tx.runtimeStore.create({ data: { key: marker, data: { mustRollback: true } } });
    await new Promise(resolve => setTimeout(resolve, 160));
    await tx.runtimeStore.findUnique({ where: { key: marker } });
  }, { timeout: 60, maxWait: 5000 });
}
async function main() {
  const { eventKey, dispatchKey, now } = JSON.parse(process.env.SIGNUP_PG_WORKER_FIXTURE || '{}');
  assert.match(eventKey, /^signup_[a-f0-9]{32}$/);
  assert.equal(dispatchKey, 'pre-handoff-drill:v1:' + eventKey + ':dispatch');
  assert.ok(Number.isSafeInteger(now));
  const prisma = client(process.env.SIGNUP_RECOVERY_DRILL_DATABASE_URL);
  const originalFetch = global.fetch;
  global.fetch = () => { throw Error('External transport forbidden in PostgreSQL worker'); };
  try {
    const setup = actualSetup(async (_, { beforeDispatch }) => {
      await beforeDispatch(); await recordDispatch(prisma, dispatchKey);
      return { existingSignup: true };
    });
    await jobs.drainSignupSetupJobs({ prisma, secret, now: () => now, processJob: setup.run });
    process.send?.({ passed: true });
  } finally { global.fetch = originalFetch; await prisma.$disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Isolated PostgreSQL worker failed'); process.exitCode = 1; });
module.exports = { client, validateTarget, expectedServerHost, actualSetup, classifier, recordDispatch, expireTransaction, secret };
