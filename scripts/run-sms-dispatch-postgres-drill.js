'use strict';
// Real PostgreSQL + separately killed/restarted Node workers; synthetic transport only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { fork, spawnSync } = require('node:child_process');
const { validateDrillTarget, workerEnvironment, syntheticInput } = require('./sms-dispatch-postgres-safety');
const ROOT = path.resolve(__dirname, '..');
const caseId = () => 'sms-drill-'+crypto.randomUUID();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const keyFor = (id, leg) => 'call-notification-dispatch:v1:'+digest(JSON.stringify([id, '+19055550100', leg]));
const CASES = ['concurrent_processes_and_completed_replay', 'crash_after_committed_claim',
  'crash_after_fake_submission', 'lost_completion_acknowledgement', 'completion_outage_no_resend',
  'unknown_provider_result_no_resend', 'changed_context_no_new_permission', 'new_call_is_independent',
  'unauthorized_request_never_submits', 'real_advisory_lock_contention'];

async function main() {
  const url = validateDrillTarget(process.env);
  const expected = process.env.SMS_DISPATCH_DRILL_EXPECTED_HEAD;
  assert.match(expected || '', /^[a-f0-9]{40}$/);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', shell: false });
  assert.equal(head.status, 0); assert.equal(head.stdout.trim(), expected, 'drill head mismatch');
  const reportDir = path.join(ROOT, 'diagnostics/sms-dispatch-postgres', 'run-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(reportDir, { recursive: true });
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), commit: expected,
    realPostgreSQL: true, realWorkerProcesses: true, productionTouched: false, realSms: 0, realCalls: 0,
    fakeTransport: 'Disposable PostgreSQL ledger only; no provider request or provider credential',
    passed: false, cases: [], sourceFiles: ['server/smsNotificationDispatch.js', 'server/compositeCallNotifications.js',
      'scripts/sms-dispatch-postgres-safety.js', 'scripts/sms-dispatch-postgres-worker.js', 'scripts/run-sms-dispatch-postgres-drill.js']
      .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(ROOT, name))) })) };
  const children = new Set();
  const { Client } = require('pg');
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  let connected = false;
  function worker(id, mode = 'normal', changed = false) {
    syntheticInput(id, changed);
    const child = fork(path.join(__dirname, 'sms-dispatch-postgres-worker.js'), [], { cwd: ROOT,
      env: workerEnvironment(process.env, url), execArgv: ['--max-old-space-size=128'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    children.add(child);
    const messages = [], waiters = [];
    let exited = false, exitInfo;
    child.stdout.resume(); child.stderr.resume(); // No raw Prisma/connection diagnostics enter the report.
    function notify() {
      for (const item of [...waiters]) {
        const match = messages.find(m => m.type === item.type);
        const failure = messages.find(m => m.type === 'error');
        if (match || failure || exited) {
          clearTimeout(item.timer); waiters.splice(waiters.indexOf(item), 1);
          if (match) item.resolve(match);
          else item.reject(Error(failure?.code || 'sms_drill_worker_exited_before_'+item.type));
        }
      }
    }
    const exit = new Promise(resolve => child.once('exit', (code, signal) => {
      exited = true; exitInfo = { code, signal }; children.delete(child); notify(); resolve(exitInfo);
    }));
    child.on('message', m => { messages.push(m); notify(); });
    child.on('error', () => { messages.push({ type: 'error', code: 'sms_drill_worker_spawn_failed' }); notify(); });
    function wait(type) { return new Promise((resolve, reject) => {
      const item = { type, resolve, reject, timer: setTimeout(() => {
        const index = waiters.indexOf(item); if (index >= 0) waiters.splice(index, 1);
        reject(Error('sms_drill_worker_timeout_'+type));
      }, 30000) }; waiters.push(item); notify();
    }); }
    return { child, wait, exit,
      async start() { await wait('ready'); child.send({ callId: id, mode, changed }); },
      async result() { const message = await wait('result'); const ended = await exit; assert.equal(ended.code, 0); return message.result; },
      async crashAt(phase) { await this.start(); await wait(phase); assert.ok(children.has(child));
        assert.equal(child.kill('SIGKILL'), true); const ended = await exit;
        assert.equal(ended.signal, 'SIGKILL', 'abrupt child termination required'); }
    };
  }
  async function run(id, mode = 'normal', changed = false) { const w = worker(id, mode, changed); await w.start(); return w.result(); }
  async function counts(id) {
    const rows = await db.query('SELECT "leg", count(*)::integer AS n FROM "SmsDispatchDrillTransport" WHERE "caseId"=$1 GROUP BY "leg"', [id]);
    return Object.fromEntries(rows.rows.map(row => [row.leg, row.n]));
  }
  async function state(id, leg) { return (await db.query('SELECT data FROM "RuntimeStore" WHERE key=$1', [keyFor(id, leg)])).rows[0]?.data; }
  async function check(name, fn) {
    const started = Date.now(); await fn(); report.cases.push({ name, passed: true, milliseconds: Date.now()-started });
    console.log(JSON.stringify({ case: name, passed: true }));
  }
  try {
    await db.connect(); connected = true;
    const identity = (await db.query('SELECT current_database() AS db, current_user AS actor')).rows[0];
    assert.equal(identity.db, 'myaipa_sms_dispatch_drill_ci'); assert.equal(identity.actor, 'sms_drill');
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n), 0,
      'Refuse an existing application/test database; fresh disposable service required');
    // No IF NOT EXISTS, no truncation, no schema migration or production records.
    await db.query('CREATE TABLE "RuntimeStore" ("key" TEXT PRIMARY KEY, "data" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL)');
    await db.query('CREATE TABLE "SmsDispatchDrillTransport" ("id" BIGSERIAL PRIMARY KEY, "caseId" TEXT NOT NULL, "leg" TEXT NOT NULL, "bodyHash" TEXT NOT NULL)');
    await check(CASES[0], async () => {
      const id = caseId(), a = worker(id), b = worker(id); await Promise.all([a.start(), b.start()]);
      await Promise.all([a.result(), b.result()]);
      assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
      assert.equal((await run(id)).complete, true); assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
      assert.equal((await state(id, 'owner')).state, 'completed'); assert.equal((await state(id, 'customer')).state, 'completed');
    });
    await check(CASES[1], async () => {
      const id = caseId(); await worker(id, 'crash_after_claim').crashAt('claimed');
      assert.equal((await state(id, 'owner')).state, 'claimed'); assert.deepEqual(await counts(id), {});
      const replay = await run(id); assert.equal(replay.complete, false); assert.equal(replay.owner.requiresReconciliation, true);
      assert.deepEqual(await counts(id), { customer: 1 }); await run(id); assert.deepEqual(await counts(id), { customer: 1 });
    });
    await check(CASES[2], async () => {
      const id = caseId(); await worker(id, 'crash_after_submission').crashAt('submitted');
      assert.deepEqual(await counts(id), { owner: 1 }); assert.equal((await state(id, 'owner')).state, 'claimed');
      assert.equal((await run(id)).complete, false); await run(id); assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
    });
    await check(CASES[3], async () => {
      const id = caseId(), first = await run(id, 'lose_complete_ack');
      assert.equal(first.complete, false); assert.equal(first.owner.sent, true);
      const replay = await run(id); assert.equal(replay.complete, true); assert.equal(replay.owner.replayed, true);
      assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
    });
    await check(CASES[4], async () => {
      const id = caseId(); assert.equal((await run(id, 'complete_unavailable')).complete, false);
      assert.equal((await state(id, 'owner')).state, 'claimed'); assert.equal((await run(id)).complete, false);
      assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
    });
    await check(CASES[5], async () => {
      const id = caseId(); assert.equal((await run(id, 'unknown_provider')).complete, false);
      const replay = await run(id); assert.equal(replay.complete, false); assert.equal(replay.owner.sent, false);
      assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
    });
    await check(CASES[6], async () => {
      const id = caseId(); assert.equal((await run(id)).complete, true);
      const changed = await run(id, 'normal', true); assert.equal(changed.complete, false);
      assert.equal(changed.owner.errorCode, 'notification_dispatch_context_conflict');
      assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
    });
    await check(CASES[7], async () => {
      for (const id of [caseId(), caseId()]) { assert.equal((await run(id)).complete, true);
        assert.deepEqual(await counts(id), { owner: 1, customer: 1 }); }
    });
    await check(CASES[8], async () => {
      const id = caseId(); assert.equal((await run(id, 'unauthorized')).complete, false);
      assert.deepEqual(await counts(id), {}); assert.equal(await state(id, 'owner'), undefined);
    });
    await check(CASES[9], async () => {
      const id = caseId(); await db.query('BEGIN');
      try {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))::text', [keyFor(id, 'owner')]);
        const w = worker(id); await w.start(); await w.wait('requesting_claim');
        let waiting = false;
        for (let i = 0; i < 20; i++) {
          waiting = Number((await db.query("SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())")).rows[0].n) > 0;
          if (waiting) break; await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(waiting, true, 'real advisory-lock waiter must be observed'); assert.deepEqual(await counts(id), {});
        await db.query('ROLLBACK'); assert.equal((await w.result()).complete, true);
        assert.deepEqual(await counts(id), { owner: 1, customer: 1 });
      } finally { await db.query('ROLLBACK'); }
    });
    assert.deepEqual(report.cases.map(c => c.name), CASES); report.passed = true;
  } catch (error) {
    report.failure = { case: CASES[report.cases.length] || 'preflight', code: String(error.code || 'sms_drill_assertion_failed') };
    process.exitCode = 1;
  } finally {
    for (const child of [...children]) child.kill('SIGKILL');
    if (connected) await db.end();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2)+'\n', { flag: 'wx' });
    console.log(JSON.stringify({ passed: report.passed, casesPassed: report.cases.length, requiredCases: CASES.length,
      realSms: 0, realCalls: 0, report: path.relative(ROOT, path.join(reportDir, 'report.json')) }));
  }
}

if (require.main === module) main().catch(() => { console.error('SMS PostgreSQL drill refused or failed preflight; no production target is permitted.'); process.exitCode = 1; });
module.exports = { main, CASES };
