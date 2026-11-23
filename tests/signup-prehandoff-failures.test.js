const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { memoryDb } = require('./helpers/twilio-status-memory-db');
const jobs = require('../server/signupSetupJobs');
const { sanitizeMakeFailureEnvelope } = require('../server/makeSignupWebhook');

const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
const secret = 'synthetic-pre-handoff-job-secret-at-least-32';
const input = { eventKey: `signup_${'e'.repeat(32)}`, tokenHash: 'b'.repeat(64),
  businessKey: 'd'.repeat(64), channel: 'sms', now: 1000 };
function classifier() {
  const start = source.indexOf('function makeFailureFromError(');
  const end = source.indexOf('\nasync function safelyNotifySignupOperations', start);
  return vm.runInNewContext(`${source.slice(start, end)}; makeFailureFromError`, {
    sanitizeMakeFailureEnvelope, isSetupDatabaseError: jobs.isSetupDatabaseError,
  });
}
function actualSetup(dispatch) {
  const start = source.indexOf('async function processVerifiedSignupSetup(');
  const end = source.indexOf('\napp.post(', start);
  const observed = { updates: [], dashboard: [], alerts: [], retained: 0, errors: [] };
  const context = {
    Date, compactObject: x => x,
    buildVerificationState: () => ({ smsVerified: true, emailVerified: false }),
    signupReviewPolicy: () => ({ reviewRequired: false, advisoryReasons: [] }),
    registerSignupAttempt: async () => ({ record: { status: 'provisioning' } }),
    assertSignupOpen: () => {},
    updateSignupAttempt: async (_, data) => observed.updates.push(data),
    upsertSignupDashboardFromPayload: (_, data) => {
      observed.dashboard.push(data); return { ...data, signupAttemptId: input.eventKey };
    },
    safelyNotifySignupOperations: async (_, data) => { observed.alerts.push(data); return {}; },
    retainPendingSignupRecoveryPayload: async () => { observed.retained++; },
    sendMakeSignupCompleted: dispatch, reconcileCompletedMakeSignup: async () => null,
    makeFailureFromError: classifier(),
    makeFailureRecordFields: x => ({ makeFailureProvider: x.provider, makeFailedStage: x.failedStage }),
    isPreHandoffDatabaseRetry: jobs.isPreHandoffDatabaseRetry,
    console: { warn() {}, error(...args) { observed.errors.push(args); } },
  };
  const run = vm.runInNewContext(`${source.slice(start, end)}; processVerifiedSignupSetup`, context);
  const record = { verifiedAt: '2026-01-01T00:00:00Z', reviewReasons: [], payload: {
    owner: { email: 'fixture@example.invalid' }, business: { name: 'Synthetic plumbing' },
  } };
  return { observed, run: (job, ctl) => run({ record, tokenHash: input.tokenHash,
    verificationChannel: 'sms', job }, ctl) };
}
async function fixture() {
  const { prisma, rows } = memoryDb();
  await prisma.$transaction(tx => jobs.enqueueSignupSetupJob(tx, input));
  return { prisma, rows, state: () => rows.get(jobs.jobKey(input.eventKey)).data };
}

test('native database transaction failures are not labelled as Make failures', () => {
  const classify = classifier();
  for (const code of ['P2028', 'P2024', 'P2034', 'P2002']) {
    const result = classify(Object.assign(new Error('private database detail'), { code }));
    assert.equal(result.provider, 'DATABASE');
    assert.equal(result.failedStage, 'DATABASE_IDEMPOTENCY');
    assert.equal(result.providerCode, code);
    assert.doesNotMatch(JSON.stringify(result), /private database detail/);
  }
});

test('explicit provider/stage evidence is preserved rather than inferred from a provider code', () => {
  const classify = classifier();
  for (const provider of ['MAKE', 'VAPI', 'TWILIO']) {
    const result = classify({ code: 'P2028', provider, failedStage: 'VAPI_NUMBER_IMPORT', providerStatus: 429 });
    assert.equal(result.provider, provider);
    assert.equal(result.failedStage, 'VAPI_NUMBER_IMPORT');
    assert.equal(result.providerStatus, 429);
  }
  assert.equal(classify({ code: 'MAKE_SIGNUP_TIMEOUT' }).provider, 'MAKE');
});

test('actual setup propagates a pre-dispatch transaction failure into bounded worker retry', async () => {
  const f = await fixture(); let posts = 0, time = 1001;
  const error = Object.assign(new Error('synthetic expired transaction'), { code: 'P2028' });
  const prepare = async () => { throw error; };
  const setup = actualSetup(async (_, { beforeDispatch }) => {
    await prepare();
    await beforeDispatch(); posts++;
    return { ok: true };
  });
  const reports = [];
  const worker = () => jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => time,
    processJob: setup.run, onFailure: async data => reports.push(data) });
  await worker();
  assert.equal(f.state().status, 'pending');
  assert.equal(f.state().lastErrorCode, 'P2028');
  assert.equal(f.state().phase, 'queued');
  assert.equal(f.state().completedAt, null);
  assert.equal(setup.observed.retained, 0);
  assert.equal(setup.observed.alerts.length, 0);
  assert.equal(reports[0].uncertain, false);
  assert.equal(reports[0].exhausted, false);
  for (let i = 1; i < 5; i++) { time += 310000; await worker(); }
  assert.equal(f.state().status, 'failed');
  assert.equal(f.state().attempts, 5);
  assert.equal(reports.at(-1).exhausted, true);
  time += 310000; await worker();
  assert.equal(f.state().attempts, 5);
  assert.equal(posts, 0);
  assert.equal(f.state().dispatchStartedAt, undefined);
});

test('restart/overlap after a safe database failure dispatches at most once', async () => {
  const f = await fixture(); let time = 1001, posts = 0;
  const setup = actualSetup(async () => { throw Object.assign(new Error('synthetic'), { code: 'P2028' }); });
  await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => time, processJob: setup.run });
  assert.equal(f.state().status, 'pending');
  time = 7000;
  const worker = () => jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => time,
    processJob: async (job, ctl) => ctl.handoff(async before => {
      await before(); posts++; return { ok: true };
    }, async () => null) });
  await Promise.all([worker(), worker()]);
  assert.equal(posts, 1);
  assert.equal(f.state().status, 'completed');
  assert.equal(f.state().lastErrorCode, '');
});

test('a post-dispatch database error never gains permission for another provider request', async () => {
  const f = await fixture(); let time = 1001, posts = 0;
  const error = Object.assign(new Error('synthetic lost receipt write'), { code: 'P2028' });
  await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => time,
    processJob: async (job, ctl) => ctl.handoff(async before => {
      await before(); posts++; throw error;
    }, async () => null) });
  assert.equal(jobs.isPreHandoffDatabaseRetry(error), false);
  assert.equal(f.state().phase, 'handoff');
  assert.equal(f.state().status, 'pending');
  time = 7000;
  await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => time,
    processJob: async (job, ctl) => ctl.handoff(async () => { posts++; }, async () => null) });
  assert.equal(posts, 1);
  assert.equal(f.state().phase, 'handoff');
});

test('needs-attention and incomplete results are terminal failures, not completed jobs or auto-replays', async () => {
  for (const outcome of [{ state: 'needs_attention', failureCode: 'VAPI_IMPORT_FAILED' },
    { ok: false, failureCode: 'PHONE_NOT_OWNED' }, { state: 'needs_attention' }]) {
    const f = await fixture(); let runs = 0, reports = 0;
    const worker = () => jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001,
      processJob: async () => { runs++; return outcome; }, onFailure: async () => { reports++; } });
    await worker(); await worker();
    assert.equal(f.state().status, 'failed');
    assert.equal(f.state().completedAt, null);
    assert.equal(f.state().lastErrorCode, outcome.failureCode || 'SIGNUP_SETUP_NEEDS_ATTENTION');
    assert.equal(runs, 1); assert.equal(reports, 0, 'caller already reported its held outcome');
  }
});

test('actual setup retains permanent failures and their original classification without claiming completion', async () => {
  const f = await fixture();
  const setup = actualSetup(async () => { throw Object.assign(new Error('synthetic conflict'), { code: 'P2002' }); });
  await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001, processJob: setup.run });
  assert.equal(f.state().status, 'failed');
  assert.equal(f.state().lastErrorCode, 'P2002');
  assert.equal(setup.observed.retained, 1);
  const failed = setup.observed.dashboard.find(x => x.status === 'setup_error');
  assert.equal(failed.makeFailureProvider, 'DATABASE');
  assert.equal(failed.makeFailedStage, 'DATABASE_IDEMPOTENCY');
  assert.equal(setup.observed.alerts.length, 1);
});

test('retry eligibility cannot be forged or inferred from a Make response', async () => {
  assert.equal(jobs.isPreHandoffDatabaseRetry({ code: 'P2028', signupPreHandoffDatabaseRetry: true }), false);
  const f = await fixture();
  const error = Object.assign(new Error('synthetic Make rejection'), { code: 'P2028', provider: 'MAKE' });
  const setup = actualSetup(async () => { throw error; });
  await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001, processJob: setup.run });
  assert.equal(f.state().status, 'failed');
  assert.equal(jobs.isPreHandoffDatabaseRetry(error), false);
});

test('lost admission commit acknowledgement never grants a preparation retry', async () => {
  const f = await fixture(); let injected = false, posts = 0;
  const transaction = f.prisma.$transaction.bind(f.prisma);
  const error = Object.assign(new Error('synthetic acknowledgement lost'), { code: 'P2028' });
  f.prisma.$transaction = async work => {
    const result = await transaction(work);
    if (!injected && f.state().phase === 'handoff') { injected = true; throw error; }
    return result;
  };
  const setup = actualSetup(async (_, { beforeDispatch }) => { await beforeDispatch(); posts++; });
  const worker = () => jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001, processJob: setup.run });
  await worker(); await worker();
  assert.equal(injected, true);
  assert.equal(jobs.isPreHandoffDatabaseRetry(error), false);
  assert.equal(f.state().status, 'failed');
  assert.equal(f.state().phase, 'handoff');
  assert.equal(f.state().dispatchStartedAt, 1001);
  assert.equal(f.state().lastErrorCode, 'P2028');
  assert.equal(posts, 0);
});

test('database failure checking the lease before preparation remains a no-dispatch bounded retry', async () => {
  const f = await fixture(); let transactions = 0, dispatches = 0;
  const transaction = f.prisma.$transaction.bind(f.prisma);
  f.prisma.$transaction = async work => {
    if (++transactions === 2) throw Object.assign(new Error('synthetic pool timeout'), { code: 'P2024' });
    return transaction(work);
  };
  const setup = actualSetup(async () => { dispatches++; });
  await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001, processJob: setup.run });
  assert.equal(f.state().status, 'pending');
  assert.equal(f.state().lastErrorCode, 'P2024');
  assert.equal(f.state().phase, 'queued');
  assert.equal(f.state().dispatchStartedAt, undefined);
  assert.equal(dispatches, 0);
});

test('repeated error objects cannot carry stale retry proof across dispatch admission', async () => {
  const f = await fixture(); let time = 1001, posts = 0;
  const error = Object.assign(new Error('synthetic shared exception'), { code: 'P2028' });
  const setup = actualSetup(async (_, { beforeDispatch }) => {
    if (time > 1001) { await beforeDispatch(); posts++; }
    throw error;
  });
  const worker = () => jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => time, processJob: setup.run });
  await worker(); assert.equal(f.state().status, 'pending');
  time = 7000; await worker();
  assert.equal(posts, 1);
  assert.equal(jobs.isPreHandoffDatabaseRetry(error), false);
  assert.equal(f.state().status, 'failed');
});

test('every allowed transient code retries only before dispatch, while identity/auth/constraint errors hold', async () => {
  for (const code of ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034',
    'P1000', 'P2002', 'P2003', 'PROVISIONING_CONTEXT_MISMATCH', 'PROVISIONING_RECONCILIATION_REQUIRED']) {
    const f = await fixture();
    const setup = actualSetup(async () => { throw Object.assign(new Error('synthetic'), { code }); });
    await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001, processJob: setup.run });
    const transient = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034'].includes(code);
    assert.equal(f.state().status, transient ? 'pending' : 'failed', code);
    assert.equal(f.state().lastErrorCode, code);
    assert.equal(f.state().phase, 'queued');
  }
});

test('exhausted actual worker reporter saves DATABASE classification, not a fabricated Make outage', async () => {
  const start = source.indexOf('async function processVerifiedSignupJobs(');
  const end = source.indexOf('\nasync function processVerifiedSignupSetup', start);
  const error = Object.assign(new Error('private synthetic SQL detail'), { code: 'P2028' });
  const observed = { updates: [], dashboard: [], alerts: [] };
  const payload = { owner: {}, business: {} };
  const run = vm.runInNewContext(`${source.slice(start, end)}; processVerifiedSignupJobs`, {
    process: { env: { NODE_ENV: 'test' } }, getProvisioningSigningSecret: () => secret,
    prisma: { signupAttempt: { findUnique: async () => ({ status: 'provisioning', payload }) },
      pendingSignupVerification: { findUnique: async () => null } },
    drainSignupSetupJobs: async options => options.onFailure({ job: { eventKey: input.eventKey },
      code: 'P2028', uncertain: false, exhausted: true, error }),
    safelyRecordSignupBug: async () => ({ recorded: true }), listSignupDashboardRecords: () => [],
    isClosedSignup: () => false,
    updateSignupAttempt: async (_, data) => observed.updates.push(data),
    upsertSignupDashboardFromPayload: (_, data) => { observed.dashboard.push(data); return data; },
    makeFailureFromError: classifier(),
    makeFailureRecordFields: x => ({ makeFailureProvider: x.provider, makeFailedStage: x.failedStage }),
    safelyNotifySignupOperations: async (_, data) => observed.alerts.push(data),
  });
  await run();
  assert.equal(observed.updates[0].status, 'setup_error');
  assert.equal(observed.dashboard[0].makeFailureProvider, 'DATABASE');
  assert.equal(observed.dashboard[0].makeFailedStage, 'DATABASE_IDEMPOTENCY');
  assert.equal(observed.alerts[0].reasonCode, 'P2028');
  assert.doesNotMatch(JSON.stringify(observed), /private synthetic SQL detail/);
});
