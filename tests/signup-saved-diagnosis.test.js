'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), vm = require('node:vm');
const { fixture: memory } = require('./helpers/signup-bug-memory-db');
const { recordSignupBug } = require('../server/signupBugHistory');
const { readSavedSignupDiagnosis, describeSavedSignupDiagnosis } = require('../server/signupSavedDiagnosis');
const { buildSignupTelegramAlert, buildSignupIncidentInput, sendSignupTelegramAlert } = require('../server/signupAlerts');
const { buildIncidentTelegramAlert } = require('../server/incidentAlerts');
const { sanitizeMakeFailureEnvelope } = require('../server/makeSignupWebhook');
async function fixture(stage = 'business-mapping', code = 'P2028') {
  const db = memory(), target = db.add(), now = Date.now(), operationId = crypto.randomUUID();
  const key = `intake-recovery:v1:${target.attemptId}:handoff:${operationId}`;
  const handoff = { eventKey: target.attemptId, businessKey: target.businessKey, payloadHash: 'f'.repeat(64),
    operationId, kind: 'handoff', status: 'accepted', startedAt: new Date(now - 10000).toISOString(), updatedAt: new Date(now - 1000).toISOString() };
  db.rows.set(key, { key, data: handoff, createdAt: new Date(now - 10000) });
  const transaction = db.prisma.$transaction;
  const options = [], statements = [];
  db.prisma.$transaction = (fn, opts) => {
    options.push(opts);
    return transaction(tx => fn({ ...tx, $executeRaw: async sql => { statements.push(sql.join('')); return 0; } }));
  };
  await recordSignupBug({ prisma: db.prisma, listSignups: db.listSignups, attemptId: target.attemptId,
    stage, error: { code, message: 'Bearer fixture-private-secret fake@example.invalid' }, now: () => now - 2000 });
  const input = { prisma: db.prisma, listSignups: db.listSignups, record: target.record, operationId, failedStage: 'VAPI_NUMBER_IMPORT', now: () => now };
  return { db, target, now, key, get handoff() { return db.rows.get(key).data; }, input, options, statements,
    read: overrides => readSavedSignupDiagnosis({ ...input, ...overrides }),
    alert: savedDiagnosis => ({ state: 'provisioning_failed', eventKey: target.attemptId, payload: target.payload, record: target.record,
      incidentId: 'a'.repeat(64), makeFailure: { failedStage: 'VAPI_NUMBER_IMPORT', provider: 'VAPI', providerCode: 'PROVIDER_REQUEST_FAILED' }, savedDiagnosis }) };
}
test('saved exact database diagnosis overrides the generic Make code in actual Telegram rendering', async () => {
  const f = await fixture(), before = structuredClone([...f.db.rows]), writes = f.db.writes;
  const saved = await f.read(), text = buildSignupTelegramAlert(f.alert(saved));
  assert.match(text, /Cause: Saved P2028: database transaction expired\/closed during business\/owner mapping/);
  assert.match(text, /Saved diagnosis: BUG-[A-F0-9]{8}/); assert.doesNotMatch(text, /Cause not confirmed|Bearer|fixture-private-secret|fake@example/);
  assert.match(text, /do not replay signup/); assert.ok(text.length <= 950);
  assert.equal(f.db.writes, writes); assert.deepEqual([...f.db.rows], before);
  assert.deepEqual(f.options.at(-1), { maxWait: 500, timeout: 1500, isolationLevel: 'RepeatableRead' });
  assert.deepEqual(f.statements, ['SET TRANSACTION READ ONLY']);
  assert.equal(buildSignupIncidentInput(f.alert(saved)).snapshot['Database code'], 'P2028');
});
test('baseline generic failure remains honest when no matching saved proof is available', async () => {
  const f = await fixture(), text = buildSignupTelegramAlert(f.alert(null));
  assert.match(text, /Cause not confirmed/); assert.doesNotMatch(text, /P2028|Saved diagnosis:/);
});
test('actual Telegram transport builds the final caption with saved diagnosis, using fake fetch only', async () => {
  const f = await fixture(), saved = await f.read(); let requests = 0;
  const result = await sendSignupTelegramAlert(f.alert(saved), { token: 'synthetic-token', chatId: 'synthetic-chat', fetchImpl: async (url, options) => {
    requests++; assert.equal(url, 'https://api.telegram.org/botsynthetic-token/sendPhoto');
    const caption = options.body.get('caption'); assert.match(caption, /Cause: Saved P2028/);
    assert.match(caption, /Saved diagnosis: BUG-/); assert.match(caption, /do not replay signup/);
    assert.doesNotMatch(caption, /fixture-private-secret|fake@example/); assert.ok(caption.length <= 950);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 123 } }) };
  } });
  assert.equal(requests, 1); assert.equal(result.sent, true, 'Synthetic acceptance only, not a live delivery');
});
test('legacy exact import-stage report describes its actual evidence, not an invented mapping checkpoint', async () => {
  const f = await fixture('assistant-import'), saved = await f.read();
  assert.match(buildSignupTelegramAlert(f.alert(saved)), /number-import\/pre-delivery checks/);
  assert.doesNotMatch(buildSignupTelegramAlert(f.alert(saved)), /during business\/owner mapping/);
});
test('all supported saved database failures are readable without guessing an external outcome', async () => {
  for (const code of ['P2024', 'SIGNUP_BUSINESS_MAPPING_BUSY', 'SIGNUP_BUSINESS_LOCK_UNVERIFIED']) {
    const f = await fixture('business-mapping', code), saved = await f.read(); assert.equal(saved.code, code);
    assert.match(buildSignupTelegramAlert(f.alert(saved)), /Cause: Saved/);
    assert.doesNotMatch(buildSignupTelegramAlert(f.alert(saved)), /Cause not confirmed/);
  }
});
test('caller-supplied or serialized diagnosis cannot impersonate server-owned verified evidence', async () => {
  const f = await fixture(), saved = await f.read();
  for (const value of [{ code: 'P2028', stage: 'business-mapping', reference: 'BUG-12345678', reason: 'secret' }, JSON.parse(JSON.stringify(saved))]) {
    assert.equal(describeSavedSignupDiagnosis(value), null);
    assert.doesNotMatch(buildSignupTelegramAlert(f.alert(value)), /Cause: Saved|BUG-12345678/);
    assert.doesNotMatch(buildIncidentTelegramAlert({ ...buildSignupIncidentInput(f.alert(value)), reason: 'secret' }), /secret/);
  }
});
test('missing/invalid operation and mismatched failed stage refuse before any evidence query', async () => {
  for (const override of [{ operationId: '' }, { operationId: 'untrusted' }, { failedStage: 'VAPI_ASSISTANT_CREATE' }, { record: { signupAttemptId: 'untrusted' } }]) {
    const f = await fixture(), reads = f.db.reads; assert.equal(await f.read(override), null); assert.equal(f.db.reads, reads);
  }
});
test('missing, mismatched or unfinished handoff proof never borrows an older diagnosis', async () => {
  for (const delta of [{ eventKey: 'signup_' + 'b'.repeat(32) }, { operationId: crypto.randomUUID() }, { businessKey: 'c'.repeat(64) },
    { payloadHash: '' }, { kind: 'queue-delete' }, { status: 'started' }, { startedAt: 'invalid' }, { updatedAt: 'invalid' }]) {
    const f = await fixture(); Object.assign(f.handoff, delta); assert.equal(await f.read(), null, JSON.stringify(delta));
  }
  const f = await fixture(); f.db.rows.delete(f.key); assert.equal(await f.read(), null);
});
test('stale/future/unordered or excessively long handoffs refuse', async () => {
  for (const delta of [now => ({ updatedAt: new Date(now - 60001).toISOString() }), now => ({ updatedAt: new Date(now + 1).toISOString() }),
    now => ({ startedAt: new Date(now).toISOString() }), now => ({ startedAt: new Date(now - 16 * 60000).toISOString() })]) {
    const f = await fixture(); Object.assign(f.handoff, delta(f.now)); assert.equal(await f.read(), null);
  }
});
test('changed or ambiguous exact identity refuses despite an otherwise matching error', async () => {
  for (const mutate of [f => f.db.setRecords([]), f => f.db.records.push({ ...f.target.record }),
    f => { f.db.attempts.get(f.target.attemptId).payload.business.name = 'different tenant'; }]) {
    const f = await fixture(); mutate(f); assert.equal(await f.read(), null);
  }
});
test('overlapping or unfinished handoffs cannot claim the same saved report', async () => {
  for (const status of ['started', 'accepted', 'uncertain']) {
    const f = await fixture(), operationId = crypto.randomUUID(), key = `intake-recovery:v1:${f.target.attemptId}:handoff:${operationId}`;
    f.db.rows.set(key, { key, createdAt: new Date(f.now - 5000), data: { ...f.handoff, operationId, status,
      startedAt: new Date(f.now - 5000).toISOString(), updatedAt: new Date(f.now - 3000).toISOString() } });
    assert.equal(await f.read(), null);
  }
  const f = await fixture(), operationId = crypto.randomUUID(), key = `intake-recovery:v1:${f.target.attemptId}:handoff:${operationId}`;
  f.db.rows.set(key, { key, createdAt: new Date(f.now - 25000), data: { ...f.handoff, operationId,
    startedAt: new Date(f.now - 25000).toISOString(), updatedAt: new Date(f.now - 15000).toISOString() } });
  assert.equal((await f.read()).code, 'P2028', 'An older non-overlapping operation is not mistaken for this failure');
});
test('old, future, unrelated-stage and conflicting current reports cannot become a diagnosis', async () => {
  for (const stage of ['assistant-create', 'runtime', 'purchase']) {
    const f = await fixture(stage); assert.equal(await f.read(), null);
  }
  for (const offset of [-11000, 1]) {
    const f = await fixture(); const bug = [...f.db.rows.values()].find(row => row.key.startsWith('application-bug-history:'));
    bug.data.capturedAt = new Date(f.now + offset).toISOString(); assert.equal(await f.read(), null);
  }
  const f = await fixture();
  await recordSignupBug({ prisma: f.db.prisma, listSignups: f.db.listSignups, attemptId: f.target.attemptId,
    stage: 'business-mapping', error: { code: 'P2024' }, now: () => f.now - 1500 });
  assert.equal(await f.read(), null);
});
test('truncated history and failed evidence reads fail closed without write or retry', async () => {
  const f = await fixture();
  for (let i = 0; i < 50; i++) await recordSignupBug({ prisma: f.db.prisma, listSignups: f.db.listSignups, attemptId: f.target.attemptId,
    stage: 'business-mapping', error: { code: 'P2028' }, now: () => f.now - 1500 });
  assert.equal(await f.read(), null);
  let attempts = 0; const writes = f.db.writes;
  assert.equal(await f.read({ prisma: { $transaction: async () => { attempts++; throw Object.assign(Error('unknown read'), { code: 'P2028' }); } } }), null);
  assert.equal(attempts, 1); assert.equal(f.db.writes, writes);
});
test('actual notification function carries verified saved proof to mock transport and preserves deduplication', async () => {
  const f = await fixture(), captured = [], source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
  const start = source.indexOf('async function safelyNotifySignupOperations('), end = source.indexOf('\nfunction upsertSignupDashboardFromPayload(', start);
  assert.ok(start > 0 && end > start);
  let current = { ...f.target.record };
  const ctx = { crypto, String, Date, console, prisma: f.db.prisma, listSignupDashboardRecords: f.db.listSignups,
    buildMakeSignupEventKey: () => f.target.attemptId, hashOperationalTarget: () => 'a'.repeat(64), signupOperationalIdentity: () => 'synthetic',
    FRONTEND_APP_URL: 'https://example.invalid', TELEGRAM_GUARDED_ACTIONS_ENABLED: false, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
    sanitizeMakeFailureEnvelope, readSavedSignupDiagnosis, buildSignupTelegramAlert,
    signupDiagnosticKeyboard: async () => null,
    sendSignupTelegramAlert: async input => { captured.push(buildSignupTelegramAlert(input)); return { sent: true, messageId: 1 }; },
    queueTelegramAlertSafely: () => assert.fail('Successful mock acceptance must not fall back to queue'),
    upsertSignupDashboardRecord: record => { current = record; },
  };
  vm.createContext(ctx); vm.runInContext(source.slice(start, end), ctx);
  const args = { state: 'provisioning_failed', record: current, makeAssessment: f.alert().makeFailure, diagnosticOperationId: f.input.operationId };
  await ctx.safelyNotifySignupOperations(f.target.payload, args);
  assert.equal(captured.length, 1); assert.match(captured[0], /Saved P2028/);
  assert.equal((await ctx.safelyNotifySignupOperations(f.target.payload, { ...args, record: current })).reason, 'already_alerted');
  assert.equal(captured.length, 1);
});
test('handoff operation provenance and exact new/legacy intake notification paths are wired in actual source', () => {
  const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
  assert.equal((source.match(/diagnosticOperationId: makeResult\.diagnosticOperationId/g) || []).length, 3);
  assert.equal((source.match(/diagnosticOperationId: error\.signupDiagnosticOperationId/g) || []).length, 3);
  assert.match(source, /diagnosticOperationId: recoveryOperationId/);
  assert.match(source, /error.signupDiagnosticOperationId = recoveryOperationId/);
  assert.match(source, /signupBugCaptureAttempted: req.signupProvisioningFailureCaptureAttempted === true/);
});
test('actual import error path saves mapping checkpoint before the response and does not capture or dispatch twice', async () => {
  for (const mode of ['saved', 'unconfirmed', 'unavailable']) {
    const f = await fixture(), source = fs.readFileSync(require.resolve('../server/index'), 'utf8').replace(/\r\n/g, '\n');
    const section = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a > 0 && b > a); return source.slice(a, b); };
    const route = section('app.post(\n  "/api/integrations/vapi/import-twilio-number",', '\napp.post(');
    const binding = section('async function ensureTrialBusinessAndMappings(', '\nfunction createAgentRouteError(');
    const errors = section('app.use((err, req, res, _next) => {', '\nfunction runBackgroundJob(');
    const { ensureSignupBusinessBindings } = require('../server/signupBusinessRegistry');
    const { safelyRecordSignupBug, runtimeBugStage, shouldCaptureRuntimeBug, listSignupBugs } = require('../server/signupBugHistory');
    let handler, errorHandler, captures = 0, transactions = 0, complete = 0, status;
    const ctx = { Object, String, Number, Error, process: { env: {} }, console: { warn() {}, error() {} },
      app: { post: (_path, ...handlers) => { handler = handlers.at(-1); }, use: fn => { errorHandler = fn; } },
      requireProvisioningKey() {}, requireProvisioningAuthorization() {}, asyncRoute: fn => fn,
      provisioningRequestTrace:require('../server/provisioningRequestTrace').createProvisioningRequestTrace({write(){}}),
      loadTrustedProvisioningContext: async () => f.target.payload, normalizeVapiImportPhone: value => value,
      requireCompletedProvisioningStage: async () => {}, buildProvisioningResourceName: () => 'synthetic',
      runProvisioningStep: async () => ({ id: 'synthetic-phone', number: '+12895550123', assistantId: 'synthetic-assistant', reused: true }),
      isTrustedSignupProvisioningCanary: () => false, isValidEmailAddress: () => true,
      upsertSignupDashboardRecord() {}, safelyProvisionIsolatedSmsForSignup: async () => ({ healthy: true }),
      selectSignupDashboardRecordForProvisioning: () => f.target.record, listSignupDashboardRecords: f.db.listSignups,
      // Real registry/admission code; only SQL is replaced with a synthetic failure.
      ensureSignupBusinessBindings: options => ensureSignupBusinessBindings({ ...options, prisma: {
        $transaction: async () => { transactions++; throw Object.assign(Error('Synthetic expired transaction'), { code: 'P2028' }); },
      } }), prisma: f.db.prisma, assertSignupOpen() {}, normalizePhoneForMatch: value => value,
      getVapiPhoneNumber: phone => phone.number, getVapiAssistantId: phone => phone.assistantId,
      persistSignupBusinessId: () => assert.fail('Failed mapping must not persist success'), readSignupDashboardStore() {}, writeSignupDashboardStore() {},
      testSignupAgentBeforeDelivery: options => ctx.ensureTrialBusinessAndMappings(options.signup, options.vapiPhone),
      safelyRecordSignupBug: async input => {
        captures++;
        if (mode === 'unconfirmed') return { recorded: false, unavailable: true };
        if (mode === 'unavailable') return safelyRecordSignupBug({ ...input, prisma: { $transaction: async () => { throw Error('synthetic unavailable store'); } } });
        return safelyRecordSignupBug({ ...input, prisma: f.db.prisma });
      },
      safelyNotifyRuntimeFailure: (_error, context) => { assert.equal(context.signupBugCaptureAttempted, true); assert.equal(context.signupAttemptId, f.target.attemptId); },
      completeSignupProvisioningContext: () => { complete++; }, runtimeBugStage, shouldCaptureRuntimeBug, sanitizeMakeFailureEnvelope,
    };
    vm.createContext(ctx); vm.runInContext(binding + '\n' + route + '\n' + errors, ctx);
    const req = { method: 'POST', path: '/api/integrations/vapi/import-twilio-number', route: { path: '/api/integrations/vapi/import-twilio-number' },
      body: { twilioPhoneNumber: '+12895550123', assistantId: 'synthetic-assistant' }, provisioningAuthorization: { idempotencyKey: 'f'.repeat(64) }, signupProvisioningAttemptId: f.target.attemptId };
    const res = { status: value => { status = value; return res; }, json: value => { assert.equal(value.code, 'P2028'); } };
    try { await handler(req, res); assert.fail('Expected mapping refusal'); } catch (error) {
      assert.equal(error.signupDiagnosticStage, 'business-mapping'); assert.equal(req.signupProvisioningFailureCaptureAttempted, true);
      error.telegramIncidentHandled = true; errorHandler(error, req, res, () => {});
    }
    assert.equal(status, 500); assert.equal(transactions, 1); assert.equal(captures, 1); assert.equal(complete, 0);
    const history = await listSignupBugs({ prisma: f.db.prisma, listSignups: f.db.listSignups, attemptId: f.target.attemptId });
    assert.equal(history.events.length, mode === 'saved' ? 2 : 1);
    if (mode === 'saved') assert.ok(history.events.every(event => event.stage === 'business-mapping' && event.association === 'verified'));
  }
});
