const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-tool-admission-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DISABLE_LOCAL_ENV_FILES: '1', DATABASE_URL: '', DATA_DIR: directory,
  SECURITY_STATE_FORCE_DATABASE: 'false', VAPI_WEBHOOK_SECRET: 'synthetic-tool-admission-secret',
  INTEGRATION_API_KEY: '', VAPI_API_KEY: '', VAPI_BUSINESS_MAP: '{}', VAPI_REQUIRE_BUSINESS_MAPPING: 'true',
  TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', STRIPE_SECRET_KEY: '',
  TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', SMTP_HOST: '', MAKE_SIGNUP_WEBHOOK_URL: '',
  TRIAL_REMINDER_DISABLE: 'true', VAPI_AUTO_SYNC_ENABLED: 'false', MISSED_CALL_ALERT_ENABLED: 'false',
  DAILY_DIGEST_ENABLED: 'false', SIGNUP_SETUP_WORKER_PAUSED: 'true',
});
const rows = new Map();
const originalFetch = global.fetch;
let externalAttempts = 0;
global.fetch = (url, options) => {
  if (new URL(String(url)).hostname !== '127.0.0.1') {
    externalAttempts++;
    throw Error('External requests are forbidden in this no-send test.');
  }
  return originalFetch(url, options);
};
let claims, bookings, mappingReads, mappedBusiness, mode, entered, release;
const db = {
  vapiBusinessMapping: { findMany: async ({where}) => { mappingReads++; return mappedBusiness ? where.matchValue.in.map(matchValue=>({ businessId: 7, matchValue })) : []; } },
  business: { findUnique: async () => ({ id: 7, name: 'Synthetic Electric', phone: '+15555550101', settings: {} }) },
  vapiToolExecution: {
    create: async ({ data }) => {
      claims++;
      if (rows.has(data.idempotencyKey)) throw Object.assign(Error('duplicate'), { code: 'P2002' });
      const row = { id: 'execution-' + rows.size, ...data };
      rows.set(data.idempotencyKey, row);
      return row;
    },
    findUnique: async ({ where }) => rows.get(where.idempotencyKey),
    update: async ({ where, data }) => {
      const row = [...rows.values()].find(item => item.id === where.id);
      Object.assign(row, data); return row;
    },
  },
};
global.__myAiPaPrisma = new Proxy(db, { get(target, key) {
  if (key in target) return target[key];
  if (typeof key !== 'string' || key === 'then') return undefined;
  const forbidden = async () => { throw Error('Unexpected synthetic database access: ' + key); };
  return key.startsWith('$') ? forbidden : new Proxy({}, { get: (_, method) => method === 'then' ? undefined : forbidden });
} });
// No provider implementation is invoked, even for accepted requests.
require('../server/agentTools').createBooking = async parameters => {
  bookings++;
  if (!parameters.customerPhone) throw Object.assign(Error('Synthetic required field'), { statusCode: 400 });
  if (mode === 'wait') await new Promise(resolve => { release = resolve; entered(); });
  if (mode === 'timeout') throw Object.assign(Error('Synthetic provider outcome unknown'), { code: 'ETIMEDOUT', statusCode: 504 });
  return { ok: true, status: 'PENDING', appointment: { id: 'appointment-synthetic' }, customerMessage: 'Request saved; not confirmed.' };
};
const { app } = require('../server/index');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { rows.clear(); claims = bookings = mappingReads = 0; mappedBusiness = true; mode = ''; entered = release = null; });
after(async () => {
  release?.(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('myaipa-tool-admission-'));
  fs.rmSync(directory, { recursive: true, force: true });
  global.fetch = originalFetch;
  assert.equal(externalAttempts, 0);
});
const argumentsObject = { customerPhone: '+15555550102', customerName: 'Synthetic Caller', service: 'Repair', requestedStart: '2027-01-12T14:00:00Z' };
const tool = (id, args = argumentsObject, name = 'request_appointment') => ({ id, function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
async function request(calls, authenticated = true) {
  const response = await fetch(base + '/api/webhooks/voice', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-vapi-secret': 'synthetic-tool-admission-secret' } : {}) },
    body: JSON.stringify({ message: { type: 'tool-calls', call: { id: 'synthetic-call', assistantId: 'synthetic-assistant' }, toolCallList: calls } }),
  });
  return { status: response.status, body: await response.json() };
}
const resultOf = response => JSON.parse(response.body.results[0].result);

test('malformed arguments are rejected before routing, durable claims or action execution', async () => {
  for (const name of ['request_appointment', 'send_owner_sms_dynamic', 'begin_myaipa_signup']) {
    const response = await request([tool('invalid-' + name, '{private-broken-json', name)]);
    assert.equal(claims, 0); assert.equal(bookings, 0); assert.equal(mappingReads, 0);
    assert.equal(response.status, 200);
    assert.deepEqual(resultOf(response), { ok: false, errorCode: 'VAPI_TOOL_ARGUMENTS_INVALID', executionState: 'not_started', actionAttempted: false, priorExecution: 'not_checked', requiresCorrection: true });
    assert.doesNotMatch(JSON.stringify(response.body), /private-broken-json|SyntaxError|position/);
  }
});

test('correcting malformed arguments does not lose the execution ID; a completed replay does not re-execute', async () => {
  await request([tool('correctable', '{broken')]);
  const accepted = await request([tool('correctable')]);
  assert.equal(accepted.status, 200); assert.equal(resultOf(accepted).ok, true); assert.equal(bookings, 1);
  const replay = await request([tool('correctable')]);
  assert.equal(resultOf(replay).duplicate, true); assert.equal(resultOf(replay).appointmentId, 'appointment-synthetic');
  assert.equal(bookings, 1);
});

test('missing arguments and conflicting aliases fail before taking an execution claim', async () => {
  const missing = await request([{ id: 'missing', function: { name: 'request_appointment' } }]);
  assert.equal(resultOf(missing).errorCode, 'VAPI_TOOL_ARGUMENTS_REQUIRED');
  const conflict = await request([{ ...tool('conflict'), parameters: { ...argumentsObject, customerPhone: '+15555550199' } }]);
  assert.equal(resultOf(conflict).errorCode, 'VAPI_TOOL_ARGUMENTS_CONFLICT');
  assert.equal(claims, 0); assert.equal(bookings, 0); assert.equal(mappingReads, 0);
});

test('rejecting a malformed replay neither erases an earlier completed action nor claims its absence', async () => {
  const accepted = await request([tool('completed-before-bad-replay')]);
  assert.equal(resultOf(accepted).ok, true);
  const rejected = resultOf(await request([tool('completed-before-bad-replay', '{broken')]));
  assert.equal(rejected.priorExecution, 'not_checked');
  assert.equal([...rows.values()][0].status, 'COMPLETED');
  assert.equal(resultOf(await request([tool('completed-before-bad-replay')])).appointmentId, 'appointment-synthetic');
  assert.equal(bookings, 1);
});

test('authentication and trusted tenant routing remain mandatory', async () => {
  assert.equal((await request([tool('unauthorized')], false)).status, 401);
  assert.equal(claims, 0); assert.equal(bookings, 0);
  mappedBusiness = false;
  assert.equal((await request([tool('unrouted')])).status, 422);
  assert.equal(claims, 0); assert.equal(bookings, 0);
});

test('well-formed arguments cannot replace the server-routed business or bypass the execution-ID prerequisite', async () => {
  const response = await request([tool('tenant-bound', { ...argumentsObject, businessId: 999 })]);
  assert.equal(resultOf(response).ok, true);
  assert.equal([...rows.values()][0].businessId, 7);
  const missingId = await request([tool('')]);
  assert.equal(missingId.status, 400); assert.equal(bookings, 1); assert.equal(claims, 1);
});

test('a malformed entry does not discard other independent valid batch results', async () => {
  const response = await request([tool('bad', '[1,2]'), tool('good')]);
  assert.equal(response.status, 200); assert.equal(response.body.results.length, 2);
  assert.equal(resultOf(response).executionState, 'not_started');
  assert.equal(JSON.parse(response.body.results[1].result).appointmentId, 'appointment-synthetic');
  assert.equal(bookings, 1); assert.equal(claims, 1);
});

test('concurrent duplicate delivery still executes only once and never claims early success', { timeout: 5000 }, async () => {
  mode = 'wait'; const started = new Promise(resolve => { entered = resolve; });
  const first = request([tool('concurrent')]); await started;
  try {
    const duplicate = resultOf(await request([tool('concurrent')]));
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.ok, false); assert.equal(duplicate.status, 'PROCESSING');
    assert.equal(bookings, 1);
  } finally { release(); }
  assert.equal(resultOf(await first).ok, true); assert.equal(bookings, 1);
});

test('a provider timeout is not converted into success or permission to replay a side effect', async () => {
  mode = 'timeout'; const failed = await request([tool('uncertain')]);
  assert.equal(failed.status, 504); assert.equal(bookings, 1);
  const replay = resultOf(await request([tool('uncertain')]));
  assert.equal(replay.ok, false); assert.equal(replay.duplicate, true); assert.equal(replay.status, 'FAILED');
  assert.equal(bookings, 1);
});
