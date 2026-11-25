'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ensureTelegramActionWebhook: ensure, telegramWebhookFailureDiagnostics: diagnostics } = require('../server/telegramBotApi');
const { config, info, fixture } = require('./helpers/telegram-webhook-fixture');
const { createTelegramWebhookState } = require('../server/telegramWebhookState');

test('intent commits before dispatch; exact acknowledged restart reads only and preserves receipts', async () => {
  const f = fixture({ handle: async method => {
    if (method === 'setWebhook') assert.equal([...f.db.rows.values()][0].status, 'uncertain');
    return method === 'setWebhook' ? true : info;
  } });
  const result = await ensure(config, f.options);
  assert.deepEqual(f.methods(), ['getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
  assert.equal(result.reused, false); assert.equal(result.liveCallbackVerified, false);
  assert.equal([...f.db.rows.values()][0].status, 'verified');
  assert.doesNotMatch(JSON.stringify([...f.db.rows]), /synthetic_token|example.invalid|wwww/);
  const before = structuredClone([...f.db.rows]), next = fixture({ db: f.db });
  assert.equal((await ensure(config, next.options)).reused, true);
  assert.deepEqual(next.methods(), ['getWebhookInfo']); assert.deepEqual([...f.db.rows], before);
});

for (const changed of ['secret', 'token']) test(`verified ${changed} rotation needs fresh acknowledgement`, async () => {
  const f = fixture(); await ensure(config, f.options);
  const next = fixture({ db: f.db, ...(changed === 'secret' ? { settings: { ...config, webhookSecret: 'x'.repeat(32) } }
    : { credential: '123456:rotated_token' }) });
  assert.equal((await ensure(next.settings, next.options)).reused, false);
  assert.deepEqual(next.methods(), ['getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
});

test('unsafe configuration or absent/mismatched durable store makes zero requests', async () => {
  const f = fixture();
  for (const settings of [{ ...config, webhookUrl: 'https://user:pass@example.invalid' },
    { ...config, webhookUrl: config.webhookUrl + '#fragment' },
    { ...config, webhookSecret: ' '.repeat(32) }, { ...config, webhookSecret: 'x'.repeat(257) }])
    await assert.rejects(ensure(settings, f.options), /credential-free HTTPS/);
  for (const options of [{ ...f.options, stateStore: undefined }, { ...f.options, token: '' },
    { ...f.options, stateStore: { ...f.options.stateStore, fingerprint: '0'.repeat(64) } }])
    await assert.rejects(ensure(config, options), { code: 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE' });
  assert.equal(f.calls.length, 0);
});

test('matching URL after timeout is NOT secret acceptance; restarted/rotated instance cannot retry', async () => {
  const f = fixture({ handle: async method => {
    if (method === 'setWebhook') throw new DOMException('PRIVATE', 'TimeoutError'); return info;
  } });
  await assert.rejects(ensure(config, f.options), error => {
    assert.equal(diagnostics(error).readback, 'matches_public_configuration'); return true;
  });
  assert.equal([...f.db.rows.values()][0].status, 'uncertain');
  for (const settings of [config, { ...config, webhookSecret: 'x'.repeat(32) }]) {
    const next = fixture({ db: f.db, settings, credential: '123456:rotated_token' });
    await assert.rejects(ensure(settings, next.options), { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST' });
    assert.deepEqual(next.methods(), ['getWebhookInfo']);
  }
});

for (const readback of ['mismatch', 'failed']) test(`failed setup + ${readback} readback retains original sanitized error`, async () => {
  const f = fixture({ handle: async (method, body, count) => {
    if (method === 'setWebhook') throw Object.assign(Error('PRIVATE'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    if (count === 3 && readback === 'failed') throw Error('PRIVATE');
    return count === 3 ? { ...info, url: '' } : info;
  } });
  await assert.rejects(ensure(config, f.options), error => {
    const d = diagnostics(error); assert.equal(d.code, 'TELEGRAM_WEBHOOK_REQUEST_FAILED');
    assert.equal(d.networkCode, 'UND_ERR_CONNECT_TIMEOUT');
    assert.equal(d.readback, readback === 'failed' ? 'unavailable' : 'configuration_mismatch');
    assert.doesNotMatch(JSON.stringify([error, d]), /PRIVATE|https:/); return true;
  });
  assert.equal(f.methods().filter(m => m === 'setWebhook').length, 1);
});

test('acknowledged setup with failed readback completes verification read-only after restart', async () => {
  const f = fixture({ handle: async (method, body, count) => {
    if (count === 3) throw new DOMException('PRIVATE', 'AbortError'); return method === 'setWebhook' ? true : info;
  } });
  await assert.rejects(ensure(config, f.options), { code: 'TELEGRAM_WEBHOOK_REQUEST_TIMEOUT' });
  assert.equal([...f.db.rows.values()][0].status, 'acknowledged');
  const next = fixture({ db: f.db }); assert.equal((await ensure(config, next.options)).reused, true);
  assert.equal([...f.db.rows.values()][0].status, 'verified'); assert.deepEqual(next.methods(), ['getWebhookInfo']);
});

for (const malformed of [{ ...info, allowed_updates: undefined }, { ...info, allowed_updates: [] },
  { ...info, allowed_updates: ['callback_query', 'message'] }, { ...info, url: 'https://other.invalid' }])
test(`incomplete or changed public configuration refuses readiness (${JSON.stringify(malformed)})`, async () => {
  const f = fixture({ handle: async method => method === 'setWebhook' ? true : malformed });
  await assert.rejects(ensure(config, f.options), { code: 'TELEGRAM_WEBHOOK_VERIFICATION_FAILED' });
  const next = fixture({ db: f.db, handle: async () => malformed });
  await assert.rejects(ensure(config, next.options), { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST' });
  assert.deepEqual(next.methods(), ['getWebhookInfo']);
});

test('provider drift after verification refuses automatic overwrite', async () => {
  const f = fixture(); await ensure(config, f.options);
  const next = fixture({ db: f.db, handle: async () => ({ ...info, url: '' }) });
  await assert.rejects(ensure(config, next.options), { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST' });
  assert.deepEqual(next.methods(), ['getWebhookInfo']);
});

test('two startup instances dispatch at most once', async () => {
  const a = fixture(), b = fixture({ db: a.db });
  const results = await Promise.allSettled([ensure(config, a.options), ensure(config, b.options)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal([...a.methods(), ...b.methods()].filter(m => m === 'setWebhook').length, 1);
});

for (const fault of ['read', 'write', 'busy', 'rollback', 'lostCommit'])
test(`database ${fault} before dispatch permits no network write`, async () => {
  const f = fixture(); f.db.fault[fault] = true;
  await assert.rejects(ensure(config, f.options), /state/);
  assert.equal(f.methods().includes('setWebhook'), false);
  if (fault === 'lostCommit') {
    const next = fixture({ db: f.db });
    await assert.rejects(ensure(config, next.options), { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST' });
    assert.deepEqual(next.methods(), ['getWebhookInfo']);
  }
});

for (const lostAfter of ['acknowledge', 'verify']) test(`lost ${lostAfter} database reply cannot repeat network setup`, async () => {
  const f = fixture(), original = f.options.stateStore[lostAfter];
  f.options.stateStore[lostAfter] = async id => { f.db.fault.lostCommit = true; return original(id); };
  await assert.rejects(ensure(config, f.options), { code: 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE' });
  const next = fixture({ db: f.db }); await ensure(config, next.options);
  assert.deepEqual(next.methods(), ['getWebhookInfo']);
});

test('failed acknowledgement persistence leaves durable uncertainty', async () => {
  const f = fixture({ handle: async method => {
    if (method === 'setWebhook') { f.db.fault.write = true; return true; } return info;
  } });
  await assert.rejects(ensure(config, f.options), { code: 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE' });
  f.db.fault.write = false;
  const next = fixture({ db: f.db });
  await assert.rejects(ensure(config, next.options), { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST' });
  assert.deepEqual(next.methods(), ['getWebhookInfo']);
});

test('false provider acknowledgement never creates verified evidence', async () => {
  const f = fixture({ handle: async method => method === 'setWebhook' ? false : info });
  await assert.rejects(ensure(config, f.options), { code: 'TELEGRAM_WEBHOOK_CONFIGURATION_FAILED' });
  assert.equal([...f.db.rows.values()][0].status, 'uncertain');
});

test('invalid persisted state and stale operation transitions fail closed without mutation', async () => {
  const f = fixture(), state = f.options.stateStore;
  const attempt = await state.claim(null);
  await assert.rejects(state.acknowledge('00000000-0000-0000-0000-000000000000'), { code: 'TELEGRAM_WEBHOOK_STATE_CONFLICT' });
  assert.deepEqual([...f.db.rows.values()], [attempt]);
  const key = [...f.db.rows.keys()][0]; f.db.rows.set(key, { ...attempt, status: 'PRIVATE_unknown' });
  await assert.rejects(ensure(config, f.options), { code: 'TELEGRAM_WEBHOOK_STATE_INVALID' });
  assert.deepEqual(f.methods(), ['getWebhookInfo']);
});

test('50 repeated two-instance starts preserve at-most-one setup attempt', async () => {
  for (let i = 0; i < 50; i++) {
    const a = fixture(), b = fixture({ db: a.db });
    await Promise.allSettled([ensure(config, a.options), ensure(config, b.options)]);
    assert.equal([...a.methods(), ...b.methods()].filter(method => method === 'setWebhook').length, 1);
    const restart = fixture({ db: a.db }); await ensure(config, restart.options);
    assert.deepEqual(restart.methods(), ['getWebhookInfo']);
  }
});

for (const scenario of ['repeated_startup', 'lost_reply'])
test(`retained released-source reproduction: ${scenario} has the old behavior`, async () => {
  const fs = require('node:fs'), crypto = require('node:crypto'), vm = require('node:vm'), path = require('node:path');
  const { createRequire } = require('node:module');
  const root = path.resolve(__dirname, '..');
  // Exact released source is sealed locally so shallow/offline CI retains the
  // failing baseline without fetching history or contacting a provider.
  const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/telegram-bot-api-e032da4.cjs'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'), '057dd526a4f5078d89bca7343ac517d733e503f6846c6aae2d77b1e17b8ee50b');
  const exports = { exports: {} };
  vm.runInNewContext(baseline, { module: exports, require: createRequire(path.join(root, 'server/telegramBotApi.js')), AbortSignal, URL, fetch() { throw Error('No real network'); } });
  const calls = [], fetchImpl = async url => {
    const method = url.split('/').pop(); calls.push(method);
    if (scenario === 'lost_reply' && method === 'setWebhook') throw new DOMException('Synthetic timeout', 'TimeoutError');
    return { ok: true, status: 200, json: async () => ({ ok: true, result: method === 'setWebhook' ? true : info }) };
  };
  const invoke = () => exports.exports.ensureTelegramActionWebhook(config, { token: '123456:synthetic_token', fetchImpl });
  if (scenario === 'repeated_startup') {
    await invoke(); await invoke();
    assert.deepEqual(calls, ['setWebhook', 'getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
  } else {
    await assert.rejects(invoke(), { code: 'TELEGRAM_WEBHOOK_REQUEST_TIMEOUT' });
    assert.deepEqual(calls, ['setWebhook'], 'Released code never read back the timed-out attempt');
  }
});

for (const mode of ['disabled', 'enabled', 'invalid_configuration'])
test(`actual startServer source: ${mode} uses guarded adapter without crashing the listener`, async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const start = source.indexOf('function startServer('), end = source.indexOf('\nif (require.main === module)', start);
  assert.ok(start > 0 && end > start);
  const f = fixture(), errors = [], listener = { synthetic: true };
  const sandbox = {
    app: { listen(port, host, callback) { assert.equal(host, '127.0.0.1'); callback(); return listener; } },
    startBackgroundJobs() {}, reportPreviousFatalIncident: async () => {},
    console: { log() {}, error(...args) { errors.push(args); } }, URL,
    TELEGRAM_GUARDED_ACTIONS_ENABLED: mode !== 'disabled',
    TELEGRAM_WEBHOOK_URL: config.webhookUrl, TELEGRAM_WEBHOOK_SECRET: config.webhookSecret,
    TELEGRAM_BOT_TOKEN: mode === 'invalid_configuration' ? 'PRIVATE_invalid_token' : f.options.token,
    prisma: f.db.prisma, createTelegramWebhookState, telegramWebhookFailureDiagnostics: diagnostics,
    ensureTelegramActionWebhook: (settings, options) => ensure(settings, { ...options, fetchImpl: f.options.fetchImpl }),
  };
  assert.equal(vm.runInNewContext(source.slice(start, end) + '\nstartServer(0, "127.0.0.1");', sandbox), listener);
  await new Promise(resolve => setImmediate(resolve));
  if (mode === 'enabled') { assert.deepEqual(f.methods(), ['getWebhookInfo', 'setWebhook', 'getWebhookInfo']); assert.equal(errors.length, 0); }
  else assert.equal(f.calls.length, 0);
  if (mode === 'invalid_configuration') {
    assert.equal(errors.length, 1); assert.equal(errors[0][1].code, 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(errors), /PRIVATE|wwww|example.invalid/);
  }
});

// Inject failures at the Prisma boundary, not at the state-store API. These
// reproduce the formerly indistinguishable errors without provider traffic.
for (const operation of ['claim', 'acknowledge', 'verify'])
for (const phase of ['transaction_start', 'lock', 'read', 'write', 'commit'])
test(`database diagnostics preserve ${operation}/${phase}, redact raw errors and never retry`, async () => {
  const f = fixture(), state = f.options.stateStore;
  let attempt;
  if (operation !== 'claim') attempt = await state.claim(null);
  if (operation === 'verify') await state.acknowledge(attempt.operationId);
  const original = f.db.prisma.$transaction.bind(f.db.prisma);
  let transactions = 0;
  const raw = Object.assign(Error('PRIVATE postgresql://user:password@private.invalid/db SQL SELECT secret'), {
    code: 'P2028', meta: { token: 'PRIVATE' }, cause: Error('PRIVATE'), privateToken: 'PRIVATE',
  });
  f.db.prisma.$transaction = async (work, options) => {
    transactions++;
    assert.deepEqual(options, { maxWait: 2000, timeout: 5000 });
    if (phase === 'transaction_start') throw raw;
    const result = await original(tx => work({
      $queryRaw: (...args) => { if (phase === 'lock') throw raw; return tx.$queryRaw(...args); },
      runtimeStore: {
        findUnique: (...args) => { if (phase === 'read') throw raw; return tx.runtimeStore.findUnique(...args); },
        upsert: (...args) => { if (phase === 'write') throw raw; return tx.runtimeStore.upsert(...args); },
      },
    }), options);
    if (phase === 'commit') throw raw; // The write committed; acknowledgement is unknown to the caller.
    return result;
  };
  await assert.rejects(operation === 'claim' ? state.claim(null) : state[operation](attempt.operationId), error => {
    const d = diagnostics(error);
    assert.equal(d.code, 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE');
    assert.equal(d.databaseCode, 'P2028'); assert.equal(d.databaseOperation, operation); assert.equal(d.databasePhase, phase);
    assert.equal(d.maxWaitMs, 2000); assert.equal(d.timeoutMs, 5000);
    assert.ok(Number.isSafeInteger(d.elapsedMs) && d.elapsedMs >= 0);
    assert.equal(d.outcome, 'state_inspection_required'); assert.equal(d.automaticRetry, false);
    assert.equal(error.cause, undefined); assert.equal(error.meta, undefined);
    assert.doesNotMatch(JSON.stringify([error, d]), /PRIVATE|postgresql|password|SELECT|private.invalid/);
    return true;
  });
  assert.equal(transactions, 1); assert.equal(f.calls.length, 0);
  const expected = phase === 'commit' ? { claim: 'uncertain', acknowledge: 'acknowledged', verify: 'verified' }[operation]
    : { claim: undefined, acknowledge: 'uncertain', verify: 'acknowledged' }[operation];
  assert.equal([...f.db.rows.values()][0]?.status, expected);
});

for (const code of ['P1001', 'P2024', 'P2034', 'P2010', 'PRIVATE', 'P9999', 'TELEGRAM_WEBHOOK_STATE_PRIVATE'])
test(`database read diagnostics allowlist ${code} without secrets or invented retry permission`, async () => {
  const f = fixture();
  f.db.prisma.runtimeStore.findUnique = async () => { throw Object.assign(Error('PRIVATE'), { code, meta: { secret: 'PRIVATE' } }); };
  await assert.rejects(ensure(config, f.options), error => {
    const d = diagnostics(error);
    assert.equal(d.databaseOperation, 'read'); assert.equal(d.databasePhase, 'read');
    assert.equal(d.databaseCode, ['P1001', 'P2024', 'P2034', 'P2010'].includes(code) ? code : undefined);
    assert.equal(d.code, 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE');
    assert.equal(d.automaticRetry, false); assert.equal(d.timeoutMs, undefined);
    assert.doesNotMatch(JSON.stringify([error, d]), /PRIVATE|P9999/); return true;
  });
  assert.deepEqual(f.methods(), ['getWebhookInfo']);
});

test('database diagnostics use monotonic elapsed time and ignore caller-supplied raw metadata', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { createRequire } = require('node:module');
  const file = path.resolve(__dirname, '../server/telegramWebhookState.js'), native = createRequire(file);
  const module = { exports: {} }; let tick = 100;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, require: name => name === 'node:perf_hooks'
    ? { performance: { now: () => { const value = tick; tick += 25.6; return value; } } } : native(name) });
  const f = fixture();
  const state = module.exports.createTelegramWebhookState({ prisma: {
    ...f.db.prisma, $transaction: async () => { throw Object.assign(Error('PRIVATE'), { code: 'P2024' }); },
  }, token: f.options.token, ...config });
  await assert.rejects(state.claim(null), error => {
    assert.equal(diagnostics(error).elapsedMs, 26); assert.equal(diagnostics(error).databaseCode, 'P2024'); return true;
  });
  const unsafe = { code: 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE', stage: 'configuration_state',
    databaseOperation: 'PRIVATE', databasePhase: 'PRIVATE', databaseCode: 'PRIVATE',
    maxWaitMs: Infinity, timeoutMs: -1, elapsedMs: 'PRIVATE', cause: 'PRIVATE', meta: 'PRIVATE' };
  assert.deepEqual(diagnostics(unsafe), { code: unsafe.code, stage: unsafe.stage,
    outcome: 'state_inspection_required', automaticRetry: false });
  assert.doesNotMatch(JSON.stringify(diagnostics({ ...unsafe, stage: 'setWebhook', databaseCode: 'P2028',
    databaseOperation: 'verify', databasePhase: 'write', maxWaitMs: 2000, timeoutMs: 5000 })), /database|timeoutMs|maxWaitMs/);
});

test('local startup logging includes sanitized database operation, code and phase', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').resolve(__dirname, '../server/index.js'), 'utf8');
  const start = source.indexOf('function startServer('), end = source.indexOf('\nif (require.main === module)', start);
  assert.ok(start > 0 && end > start);
  const f = fixture(), errors = [];
  f.db.prisma.runtimeStore.findUnique = async () => { throw Object.assign(Error('PRIVATE password'), { code: 'P1001' }); };
  vm.runInNewContext(source.slice(start, end) + '\nstartServer(0, "127.0.0.1");', {
    app: { listen(port, host, cb) { cb(); return {}; } }, startBackgroundJobs() {}, reportPreviousFatalIncident: async () => {},
    console: { log() {}, error(...args) { errors.push(args); } }, URL,
    TELEGRAM_GUARDED_ACTIONS_ENABLED: true, TELEGRAM_WEBHOOK_URL: config.webhookUrl,
    TELEGRAM_WEBHOOK_SECRET: config.webhookSecret, TELEGRAM_BOT_TOKEN: f.options.token,
    prisma: f.db.prisma, createTelegramWebhookState, telegramWebhookFailureDiagnostics: diagnostics,
    ensureTelegramActionWebhook: (settings, options) => ensure(settings, { ...options, fetchImpl: f.options.fetchImpl }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].databaseCode, 'P1001'); assert.equal(errors[0][1].databaseOperation, 'read');
  assert.equal(errors[0][1].databasePhase, 'read'); assert.equal(errors[0][1].automaticRetry, false);
  assert.doesNotMatch(JSON.stringify(errors), /PRIVATE|password|synthetic_token|https:/);
  assert.deepEqual(f.methods(), ['getWebhookInfo']);
});

test('synthetic deadline model admits 3000ms but refuses work beyond the fixed 5000ms budget', async () => {
  // Deterministic protocol/deadline model, NOT PostgreSQL timing proof. The real
  // SQL counterpart below the CI opt-in exercises Prisma's actual deadline.
  for (const elapsed of [3000, 5001]) {
    const f = fixture(), original = f.db.prisma.$transaction.bind(f.db.prisma);
    let transactions = 0;
    f.db.prisma.$transaction = (work, settings) => {
      transactions++;
      assert.deepEqual(settings, { maxWait: 2000, timeout: 5000 });
      return original(async tx => {
        if (elapsed > settings.timeout) throw Object.assign(Error('PRIVATE synthetic deadline'), { code: 'P2028' });
        return work(tx);
      }, settings);
    };
    if (elapsed < 5000) {
      assert.equal((await ensure(config, f.options)).configured, true);
      assert.equal(transactions, 3); assert.equal(f.methods().filter(m => m === 'setWebhook').length, 1);
    } else {
      await assert.rejects(ensure(config, f.options), error => {
        assert.equal(diagnostics(error).databaseCode, 'P2028'); return true;
      });
      assert.equal(transactions, 1); assert.deepEqual(f.methods(), ['getWebhookInfo']); assert.equal(f.db.rows.size, 0);
    }
  }
});
