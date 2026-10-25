const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { ledgerKey, dispatchStagingIntakeNotification } = require('../server/intakeLedger');
async function main() {
  const url = new URL(process.env.SIGNUP_RECOVERY_DRILL_DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || !/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname)) throw Error('Disposable loopback database required');
  const nativeFetch = global.fetch;
  global.fetch = (input, options) => {
    if (new URL(input).hostname !== '127.0.0.1') throw Error('External provider traffic forbidden in isolated intake drill');
    return nativeFetch(input, options);
  };
  const prisma = new PrismaClient({ datasources: { db: { url: url.href } }, __internal: { configOverride: c => ({ ...c, relativeEnvPaths: {} }) } });
  global.__myAiPaPrisma = prisma;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-intake-http-'));
  let worker;
  async function start(businessId, assistantId) {
    const child = fork(path.resolve('tests/helpers/staging-intake-http-worker.js'), [], { cwd: directory, execArgv: ['--max-old-space-size=128'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: url.href, DATA_DIR: path.join(directory, 'data'), STAGING_INTAKE_BUSINESS_ID: String(businessId), STAGING_INTAKE_ASSISTANT_ID: assistantId } });
    let diagnostic = '';
    child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-1500); });
    const exited = new Promise(resolve => child.once('exit', resolve));
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(Error('Intake app startup timed out')); }, 30000);
      child.once('message', value => { clearTimeout(timer); resolve(value.port); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Intake app startup failed: ' + diagnostic)); });
    });
    return { child, exited, base: 'http://127.0.0.1:' + port };
  }
  async function stop() { if (worker && worker.child.exitCode === null) { worker.child.kill(); await worker.exited; } }
  try {
    const suffix = crypto.randomBytes(6).toString('hex');
    const assistantId = 'fixture-intake-' + suffix;
    const business = await prisma.business.create({ data: { name: 'Synthetic intake ' + suffix, phone: '+12895550123', timezone: 'America/Toronto', settings: { create: { ownerPhone: '+19055550123' } } } });
    await prisma.vapiBusinessMapping.create({ data: { businessId: business.id, matchType: 'assistantId', matchValue: assistantId } });
    const call = { id: 'fixture-call-' + suffix, assistantId, customer: { number: '+19055550123' } };
    worker = await start(business.id, assistantId);
    async function post(id, parameters, { secret = 'synthetic-intake-webhook-secret', targetCall = call } = {}) {
      const response = await fetch(worker.base + '/api/webhooks/voice', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret },
        body: JSON.stringify({ message: { type: 'tool-calls', call: targetCall, toolCallList: [{ id, type: 'function', function: { name: 'capture_confirmed_intake', arguments: JSON.stringify(parameters) } }] } }), signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      return { status: response.status, result: body.results?.[0]?.result ? JSON.parse(body.results[0].result) : body };
    }
    const initial = { expectedVersion: 0, callerConfirmed: true, operations: [
      { field: 'callerName', action: 'write', value: 'Fixture Caller', confirmed: true },
      { field: 'callbackNumber', action: 'write', value: '+19055550123', confirmed: true },
      { field: 'serviceAddress', action: 'write', value: '10 Fixture Road', confirmed: true },
      { field: 'requestedDate', action: 'write', value: 'Tuesday', confirmed: true } ] };
    const correction = { expectedVersion: 1, callerConfirmed: true, operations: [
      { field: 'serviceAddress', action: 'update', value: '20 Fixture Road', confirmed: true },
      { field: 'requestedDate', action: 'update', value: 'Wednesday', confirmed: true },
      { field: 'jobDetails', action: 'ignore', value: 'unconfirmed guess' } ] };
    const finish = { expectedVersion: 2, callerConfirmed: true, operations: [], finalize: true };
    assert.equal((await post('unauthorized', initial, { secret: 'wrong' })).status, 401);
    const captures = await Promise.all(Array.from({ length: 5 }, () => post('capture', initial)));
    assert.ok(captures.every(x => x.status === 200), JSON.stringify(captures));
    assert.equal(captures.filter(x => !x.result.duplicate).length, 1);
    await stop(); worker = await start(business.id, assistantId);
    assert.equal((await post('stale', { ...correction, expectedVersion: 0 })).status, 409);
    assert.equal((await post('cross-tenant', { ...correction, businessId: business.id + 1 })).status, 403);
    assert.equal((await post('unconfirmed', { ...correction, callerConfirmed: false })).status, 400);
    assert.equal((await post('correction', correction)).result.version, 2);
    assert.equal(await prisma.lead.count({ where: { businessId: business.id } }), 0, 'Partial intake cannot send an invented final lead');
    const final = await post('finish', finish);
    assert.equal(final.status, 200, JSON.stringify(final)); assert.equal(final.result.version, 3);
    for (const [id, parameters] of [['capture', initial], ['correction', correction], ['finish', finish]]) assert.equal((await post(id, parameters)).result.duplicate, true);
    assert.equal((await post('late-correction', { ...correction, expectedVersion: 3 })).status, 409);
    const key = ledgerKey(String(business.id), 'staging-' + crypto.createHash('sha256').update(call.id).digest('hex').slice(0, 40));
    const state = (await prisma.runtimeStore.findUnique({ where: { key } })).data;
    assert.doesNotMatch(JSON.stringify(state), /Tuesday|10 Fixture Road|unconfirmed guess/);
    assert.equal(await prisma.lead.count({ where: { businessId: business.id } }), 1);
    const lead = await prisma.lead.findUnique({ where: { id: state.leadId } });
    assert.match(lead.summary, /20 Fixture Road/); assert.match(lead.summary, /Wednesday/);
    const { createAndDispatchLeadHandoff, processDueLeadHandoffs } = require('../server/leadHandoffs');
    let sends = 0;
    const sendHandoff = async item => createAndDispatchLeadHandoff({ lead, businessId: business.id, callId: lead.callId, sourceEventId: item.sourceEventId,
      env: { NODE_ENV: 'test', LEAD_ACK_SECRET: 'synthetic-intake-handoff-secret-at-least-32' }, sendSms: async request => {
        sends++; assert.equal(request.to, '+19055550123');
        return { id: 'synthetic-owner-message', status: 'queued', mocked: false };
      } });
    const dispatches = await Promise.allSettled(Array.from({ length: 3 }, () => dispatchStagingIntakeNotification({ prisma, key: state.outboxKey, sendHandoff })));
    assert.ok(dispatches.some(x => x.status === 'fulfilled'));
    await dispatchStagingIntakeNotification({ prisma, key: state.outboxKey, sendHandoff });
    assert.equal(sends, 1);
    assert.equal(await prisma.leadHandoff.count({ where: { businessId: business.id } }), 1);
    const handoff = await prisma.leadHandoff.findUnique({ where: { leadId: lead.id } });
    await prisma.leadHandoff.update({ where: { id: handoff.id }, data: { status: 'RETRY_DUE', nextActionAt: new Date(0) } });
    const legacyRun = await processDueLeadHandoffs();
    assert.equal(legacyRun.checked, 0, 'Legacy worker must not select staging-owned notifications');
    assert.deepEqual(legacyRun.results, []);
    await prisma.leadHandoff.update({ where: { id: handoff.id }, data: { status: 'SENT', nextActionAt: null } });
    // Inject a failure after lead/outbox writes but before the ledger commit.
    const rollbackCall = { ...call, id: 'rollback-' + suffix };
    assert.equal((await post('capture', initial, { targetCall: rollbackCall })).status, 200);
    const rollbackKey = ledgerKey(String(business.id), 'staging-' + crypto.createHash('sha256').update(rollbackCall.id).digest('hex').slice(0, 40));
    await prisma.$executeRawUnsafe("CREATE FUNCTION intake_drill_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = TG_ARGV[0] THEN RAISE EXCEPTION 'isolated ledger failure'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe("CREATE TRIGGER intake_drill_reject BEFORE UPDATE ON \"RuntimeStore\" FOR EACH ROW EXECUTE FUNCTION intake_drill_reject('" + rollbackKey + "')");
    try {
      const failed = await post('finish', { ...finish, expectedVersion: 1 }, { targetCall: rollbackCall });
      assert.ok(failed.status >= 500);
      assert.equal(await prisma.lead.count({ where: { businessId: business.id } }), 1, 'Failed transaction must roll back its new lead');
      assert.equal((await prisma.runtimeStore.findUnique({ where: { key: rollbackKey } })).data.version, 1);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER intake_drill_reject ON "RuntimeStore"');
      await prisma.$executeRawUnsafe('DROP FUNCTION intake_drill_reject()');
    }
    const report = { checkedAt: new Date().toISOString(), passed: true, mode: 'full-app-http-real-postgres-fake-delivery',
      concurrency: true, processRestart: true, latestConfirmedValuesOnly: true, crossTenantRejected: true, authenticationRequired: true,
      staleAndLateUpdatesRejected: true, transactionRollbackVerified: true, legacyRetryOwnerSeparated: true, canonicalRecordsForCompletedCall: 1,
      leadsForCompletedCall: 1, notificationHandoffs: 1, fakeProviderAcceptances: sends, realProviderRequests: 0, productionTouched: false,
      limitations: ['Caller confirmation is a tool assertion; real voice behavior has not been tested.', 'No real SMS delivery or carrier forwarding was performed.'] };
    const output = path.resolve('diagnostics/provider-hardening/intake.json'); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stop(); await prisma.$disconnect();
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== fs.realpathSync(os.tmpdir()) || !path.basename(target).startsWith('myaipa-intake-http-') || fs.lstatSync(directory).isSymbolicLink()) throw Error('Unsafe test cleanup target');
    fs.rmSync(target, { recursive: true, force: true });
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
