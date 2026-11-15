const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual worker body without starting the server, loading secrets,
// running timers, or importing a mail/provider client.
const index = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
const start = index.indexOf('async function processTrialReminders() {');
const end = index.indexOf('\nfunction escapeHtml(', start);
assert.ok(start >= 0 && end > start, 'actual worker source must be available');
const worker = index.slice(start, end);
const now = Date.parse('2026-11-14T18:00:00Z');

async function run({ result, error, sentAt, future = false, expired = false, status = 'scheduled', paymentReady = false, disabled = false } = {}) {
  let calls = 0;
  let writes = 0;
  const store = { sub_fixture: {
    subscriptionId: 'sub_fixture', ownerEmail: 'fixture@example.invalid',
    trialEndAt: now + 86400000, status, paymentMethodReady: paymentReady,
    reminders: { '1-days': { dueAt: future ? now + 1000 : now - 1000,
      status: sentAt ? 'sent' : 'scheduled', ...(sentAt ? { sentAt } : {}),...(expired ? {expiresAt:now-1} : {}) } },
  } };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = {
    Date: FixtureDate, process: { env: { TRIAL_REMINDER_DISABLE: disabled ? 'true' : '' } }, isEnabled: value => value === 'true',
    readTrialReminderStore: () => store,
    writeTrialReminderStore: () => { writes += 1; },
    buildTrialReminderSchedule: (_end, reminders) => reminders,
    sendTrialPaymentReminder: async () => { calls += 1; if (error) throw error; return result; },
    console: { error() {} },
  };
  await vm.runInNewContext(`(${worker})()`, context);
  return { reminder: store.sub_fixture.reminders['1-days'], calls, writes };
}

for (const [name, result] of [
  ['explicit not-sent', { sent: false }],
  ['development log only', { sent: false, devOnly: true }],
  ['missing response', undefined],
  ['malformed response', {}],
  ['non-boolean sent flag', { sent: 'true' }],
]) {
  test(`actual reminder worker refuses false sent evidence: ${name}`, async () => {
    const { reminder, calls, writes } = await run({ result });
    assert.equal(calls, 1);
    assert.equal(writes, 1);
    assert.equal(reminder.status, 'error');
    assert.equal(reminder.sentAt, undefined);
    assert.equal(reminder.lastAttemptAt, new Date(now).toISOString());
    assert.match(reminder.lastError, /not confirm.*sent/i);
  });
}

test('actual reminder worker records explicit mail-function acceptance, not physical delivery', async () => {
  const { reminder, calls, writes } = await run({ result: { sent: true } });
  assert.equal(calls, 1); assert.equal(writes, 1);
  assert.equal(reminder.status, 'sent');
  assert.equal(reminder.sentAt, new Date(now).toISOString());
});

test('actual reminder worker preserves an existing sent notice without another mail attempt', async () => {
  const sentAt = '2026-11-13T18:00:00Z';
  const { reminder, calls, writes } = await run({ sentAt });
  assert.equal(reminder.sentAt, sentAt);
  assert.equal(calls, 0); assert.equal(writes, 0);
});

test('actual reminder worker leaves future notices unattempted', async () => {
  const { reminder, calls, writes } = await run({ future: true });
  assert.equal(reminder.status, 'scheduled');
  assert.equal(calls, 0); assert.equal(writes, 0);
});

test('actual reminder worker does not fabricate sent evidence on transport rejection', async () => {
  const { reminder, calls } = await run({ error: new Error('fixture transport refusal') });
  assert.equal(calls, 1); assert.equal(reminder.status, 'error');
  assert.equal(reminder.sentAt, undefined);
  assert.equal(reminder.lastError, 'fixture transport refusal');
});

test('actual reminder worker preserves cancelled, paid and disabled exclusions without sending', async () => {
  for (const options of [{ status: 'cancelled' }, { status: 'payment_ready' }, { status:'proof_blocked' }, { paymentReady: true }, { disabled: true }]) {
    const { calls, writes } = await run(options);
    assert.equal(calls, 0); assert.equal(writes, 0);
  }
});

test('actual worker records a missed day-14 window without sending a stale reminder',async()=>{
  const {reminder,calls,writes}=await run({expired:true});
  assert.equal(reminder.status,'missed');assert.equal(reminder.sentAt,undefined);
  assert.equal(calls,0);assert.equal(writes,1);
});
