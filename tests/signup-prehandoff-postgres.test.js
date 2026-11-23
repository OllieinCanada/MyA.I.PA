const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { fork } = require('node:child_process');
const jobs = require('../server/signupSetupJobs');
const { client, expectedServerHost, actualSetup, classifier, recordDispatch, expireTransaction, secret } = require('./helpers/signup-prehandoff-postgres-worker');
const enabled = process.env.RUN_SIGNUP_PREHANDOFF_POSTGRES === '1';

async function fixture(t) {
  const url = process.env.SIGNUP_RECOVERY_DRILL_DATABASE_URL;
  const prisma = client(url), keys = [], children = new Set();
  t.after(async () => {
    await Promise.all([...children].map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve); child.kill();
    })));
    try { await prisma.runtimeStore.deleteMany({ where: { key: { in: keys } } });
      assert.equal(await prisma.runtimeStore.count({ where: { key: { in: keys } } }), 0);
    } finally { await prisma.$disconnect(); }
  });
  const [identity] = await prisma.$queryRaw`SELECT current_database() AS database,
    host(inet_server_addr()) AS host, inet_server_port() AS port,
    current_setting('server_version') AS version`;
  const expected = new URL(url);
  assert.equal(identity.database, expected.pathname.slice(1));
  assert.equal(identity.host, expectedServerHost()); assert.equal(identity.port, Number(expected.port));
  assert.match(identity.version, /^18\./);
  t.diagnostic('Verified real loopback PostgreSQL ' + identity.version + ' and exact disposable database identity');
  const eventKey = 'signup_' + crypto.randomBytes(16).toString('hex');
  const key = jobs.jobKey(eventKey), prefix = 'pre-handoff-drill:v1:' + eventKey + ':';
  const dispatchKey = prefix + 'dispatch', marker = prefix + 'rollback';
  keys.push(key, dispatchKey, marker);
  await prisma.$transaction(tx => jobs.enqueueSignupSetupJob(tx, { eventKey, tokenHash: 'b'.repeat(64),
    businessKey: 'c'.repeat(64), channel: 'sms', now: 1000 }));
  const state = async () => (await prisma.runtimeStore.findUnique({ where: { key } })).data;
  const count = async () => (await prisma.runtimeStore.findUnique({ where: { key: dispatchKey } }))?.data?.simulatedDispatches || 0;
  const restartWorker = now => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'helpers/signup-prehandoff-postgres-worker.js'), [], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_PATH: process.env.NODE_PATH || '',
        NODE_ENV: 'test', DISABLE_LOCAL_ENV_FILES: '1', SIGNUP_RECOVERY_DRILL_DATABASE_URL: url,
        SIGNUP_PG_WORKER_FIXTURE: JSON.stringify({ eventKey, dispatchKey, now }) },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
    });
    children.add(child); let message, stderr = '';
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-300); });
    const timer = setTimeout(() => { child.kill(); reject(Error('Synthetic SQL worker deadline')); }, 20000);
    child.on('message', m => { message = m; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); children.delete(child);
      if (code === 0 && message?.passed) resolve(); else reject(Error('Synthetic SQL worker exit: ' + code + ' ' + stderr)); });
  });
  return { prisma, state, count, eventKey, key, marker, dispatchKey, restartWorker };
}

test('real PostgreSQL: native pre-handoff P2028 rolls back, stays queued, and two restarted workers dispatch once',
  { skip: !enabled, timeout: 40000 }, async t => {
    const f = await fixture(t), failures = [];
    const setup = actualSetup(async () => expireTransaction(f.prisma, f.marker));
    await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001,
      processJob: setup.run, onFailure: async x => failures.push(x) });
    assert.equal(failures.length, 1); assert.equal(failures[0].error.code, 'P2028');
    assert.equal(jobs.isPreHandoffDatabaseRetry(failures[0].error), true);
    assert.equal(classifier()(failures[0].error).provider, 'DATABASE');
    assert.equal(await f.prisma.runtimeStore.findUnique({ where: { key: f.marker } }), null);
    const state = await f.state(); assert.equal(state.status, 'pending'); assert.equal(state.phase, 'queued');
    assert.equal(state.completedAt, null); assert.equal(state.dispatchStartedAt, undefined);
    assert.equal(state.lastErrorCode, 'P2028'); assert.equal(await f.count(), 0);
    assert.equal(setup.observed.alerts, 0);
    await Promise.all([f.restartWorker(7000), f.restartWorker(7000)]);
    assert.equal(await f.count(), 1); assert.equal((await f.state()).status, 'completed');
    await f.restartWorker(9000); assert.equal(await f.count(), 1);
  });

test('real PostgreSQL: five native preparation expiries exhaust the retry budget without a handoff or false completion',
  { skip: !enabled, timeout: 15000 }, async t => {
    const f = await fixture(t), failures = []; let now = 1001;
    const setup = actualSetup(async () => expireTransaction(f.prisma, f.marker));
    const run = () => jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => now,
      processJob: setup.run, onFailure: async x => failures.push(x) });
    for (let i = 0; i < 5; i++) { await run(); now += 310000; }
    await run(); const state = await f.state();
    assert.equal(failures.length, 5); assert.ok(failures.every(x => x.error.code === 'P2028'));
    assert.equal(failures.at(-1).exhausted, true); assert.equal(state.status, 'failed');
    assert.equal(state.attempts, 5); assert.equal(state.completedAt, null);
    assert.equal(state.lastErrorCode, 'P2028'); assert.equal(await f.count(), 0);
    assert.equal(await f.prisma.runtimeStore.findUnique({ where: { key: f.marker } }), null);
  });

test('real PostgreSQL: a post-dispatch expiry is held and cannot gain permission to repeat the provider action',
  { skip: !enabled, timeout: 15000 }, async t => {
    const f = await fixture(t); let observedError;
    const setup = actualSetup(async (_, { beforeDispatch }) => {
      await beforeDispatch(); await recordDispatch(f.prisma, f.dispatchKey);
      try { await expireTransaction(f.prisma, f.marker); } catch (e) { observedError = e; throw e; }
    });
    await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001, processJob: setup.run });
    assert.equal(observedError.code, 'P2028'); assert.equal(jobs.isPreHandoffDatabaseRetry(observedError), false);
    const state = await f.state(); assert.equal(state.status, 'failed'); assert.equal(state.phase, 'handoff');
    assert.equal(state.completedAt, null); assert.equal(state.lastErrorCode, 'P2028');
    assert.equal(setup.observed.dashboard.at(-1).makeFailureProvider, 'DATABASE');
    await Promise.all([f.restartWorker(7000), f.restartWorker(7000)]); assert.equal(await f.count(), 1);
  });

test('real PostgreSQL: committed admission with lost acknowledgement remains fenced across processes',
  { skip: !enabled, timeout: 15000 }, async t => {
    const f = await fixture(t); const transaction = f.prisma.$transaction.bind(f.prisma); let injected = false;
    f.prisma.$transaction = async (work, options) => {
      const value = await transaction(work, options);
      if (!injected && (await f.state()).phase === 'handoff') {
        injected = true; throw Object.assign(Error('Synthetic lost commit acknowledgement'), { code: 'P2028' });
      }
      return value;
    };
    const setup = actualSetup(async (_, { beforeDispatch }) => {
      await beforeDispatch(); await recordDispatch(f.prisma, f.dispatchKey); return { existingSignup: true };
    });
    await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001, processJob: setup.run });
    assert.equal(injected, true); assert.equal((await f.state()).status, 'failed');
    assert.equal((await f.state()).phase, 'handoff'); assert.equal((await f.state()).completedAt, null);
    assert.equal(await f.count(), 0); await f.restartWorker(7000); assert.equal(await f.count(), 0);
  });

test('real PostgreSQL: explicit incomplete outcomes are not completed or automatically repeated',
  { skip: !enabled, timeout: 15000 }, async t => {
    for (const result of [{ state: 'needs_attention', failureCode: 'SIGNUP_REVIEW_REQUIRED' },
      { ok: false, failureCode: 'MAKE_SIGNUP_INCOMPLETE' }]) {
      const f = await fixture(t); let runs = 0;
      await jobs.drainSignupSetupJobs({ prisma: f.prisma, secret, now: () => 1001,
        processJob: async () => { runs++; return result; } });
      assert.equal((await f.state()).status, 'failed'); assert.equal((await f.state()).completedAt, null);
      assert.equal((await f.state()).lastErrorCode, result.failureCode);
      await f.restartWorker(7000); assert.equal(await f.count(), 0); assert.equal(runs, 1);
    }
  });
