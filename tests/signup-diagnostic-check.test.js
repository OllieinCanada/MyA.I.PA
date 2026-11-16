const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectSignup } = require('../server/signupDiagnosticCheck');
const { projectSetup } = require('../server/adminSignupSetup');
const { sanitizeContext, buildApprovalKeyboard, claimTelegramApproval, buildCallbackData } = require('../server/telegramApprovalActions');
const attempt = 'signup_' + 'a'.repeat(32), target = 'b'.repeat(24), secret = 's'.repeat(40);
const fixture = () => {
  const record = { signupAttemptId: attempt, businessName: 'Synthetic HVAC', status: 'setup_error', phoneProvisioningCode: 'NO_AVAILABLE_NUMBERS' };
  const approval = { purpose: 'SIGNUP_CHECK', decidedAction: 'check', targetType: 'signup', targetId: target, context: { signupAttemptId: attempt } };
  return { record, approval, list: () => [record], targetFor: () => target,
    readSetup: async r => projectSetup(r), now: () => Date.parse('2026-11-15T12:00:00Z') };
};
test('saved-only diagnosis reports unknown cause, absent resources and blocked recovery without writes', async () => {
  const f = fixture(), before = JSON.stringify(f.record), result = await inspectSignup(f);
  assert.equal(JSON.stringify(f.record), before); assert.equal(result.report.resumeAllowed, false);
  assert.equal(result.report.liveProviderVerified, false); assert.equal(result.report.numberRecorded, false);
  assert.equal(result.report.reasonCode, 'NO_AVAILABLE_NUMBERS'); assert.match(result.text, /Cause not confirmed/);
  assert.match(result.text, /No recovery, purchase, customer text/);
});
for (const [label, change, code] of [
  ['wrong action', f => f.approval.decidedAction = 'approve', 'SCOPE_INVALID'],
  ['wrong purpose', f => f.approval.purpose = 'SIGNUP_REVIEW', 'SCOPE_INVALID'],
  ['wrong target type', f => f.approval.targetType = 'incident', 'SCOPE_INVALID'],
  ['missing attempt', f => f.approval.context = {}, 'SCOPE_INVALID'],
  ['duplicate attempt', f => f.list = () => [f.record, { ...f.record }], 'IDENTITY_CONFLICT'],
  ['missing attempt', f => f.list = () => [], 'IDENTITY_CONFLICT'],
  ['wrong target', f => f.targetFor = () => 'other', 'IDENTITY_CONFLICT'],
  ['archived target', f => f.record.status = 'archived', 'CLOSED'],
  ['reader unavailable', f => f.readSetup = async () => null, 'EVIDENCE_UNAVAILABLE'],
  ['changed evidence', f => f.readSetup = async r => { const s = projectSetup(r); r.businessId = 99; return s; }, 'EVIDENCE_CHANGED'],
]) test('refuses ' + label, async () => {
  const f = fixture(); change(f); await assert.rejects(inspectSignup(f), e => e.code === 'SIGNUP_CHECK_' + code);
});
test('uncertain purchase keeps resource and area evidence separate from recovery permission', async () => {
  const f = fixture(); f.record.twilioPhoneNumber = '+15555550123';
  f.readSetup = async () => ({ readOnly: true, coverage: 'receipt_context_mismatch', groups: [],
    number: { areaOrder: ['289','365','bad'], stage: { status: 'processing', uncertain: true } } });
  const { report, text } = await inspectSignup(f);
  assert.equal(report.uncertainPurchase, true); assert.equal(report.numberRecorded, true);
  assert.deepEqual(report.areaOrder, ['289','365']); assert.equal(report.resumeAllowed, false);
  assert.match(text, /inspect before retry/); assert.doesNotMatch(text, /5555550123/);
});
test('transport/read errors fail closed; nothing invokes a recovery or sender capability', async () => {
  const f = fixture(); f.readSetup = async () => { throw Error('synthetic read failure'); };
  await assert.rejects(inspectSignup(f), /synthetic read failure/);
});

test('new live read is exact-target bound and separate from saved claims and recovery', async () => {
  const f=fixture();let reads=0;
  f.readLive=async r=>{reads++;assert.equal(r.signupAttemptId,attempt);return {readOnly:true,attemptId:attempt,
    checkedAt:new Date().toISOString(),groups:[{title:'Live Twilio',checks:[{state:'unknown',detail:'Resource reference missing.'}]}]};};
  const result=await inspectSignup(f);assert.equal(reads,1);assert.equal(result.report.scope,'saved_and_exact_provider_reads');
  assert.equal(result.report.resumeAllowed,false);assert.equal(result.report.liveProviderVerified,false);assert.match(result.text,/UNKNOWN: Resource reference missing/);
  f.readLive=async()=>({readOnly:true,attemptId:'signup_'+'f'.repeat(32),groups:[]});
  await assert.rejects(inspectSignup(f),e=>e.code==='SIGNUP_CHECK_EVIDENCE_UNAVAILABLE');
  f.readLive=async()=>{f.record.businessId=99;return {readOnly:true,attemptId:attempt,groups:[]};};
  await assert.rejects(inspectSignup(f),e=>e.code==='SIGNUP_CHECK_EVIDENCE_CHANGED');
});
test('new keyboard exposes check only, retains protected link and requires exact attempt', () => {
  assert.throws(() => sanitizeContext('SIGNUP_CHECK', {}), /exact signup/);
  const context = sanitizeContext('SIGNUP_CHECK', { signupAttemptId: attempt, openUrl: 'https://www.myaipa.ca/#/admin?tab=signups', sendSms: true });
  assert.equal(context.sendSms, undefined);
  const k = buildApprovalKeyboard({ purpose: 'SIGNUP_CHECK', publicId: 'a'.repeat(16), context }, secret);
  assert.equal(k.inline_keyboard[0].length, 1); assert.equal(k.inline_keyboard[0][0].text, 'Check this signup');
  assert.equal(k.inline_keyboard[1][0].text, 'Open signup tracker');
});
test('diagnostic decision is claimed once and never admits recovery action', async () => {
  const f = fixture(); let state = 'PENDING', writes = 0;
  const row = { ...f.approval, id: 'fixture', publicId: 'a'.repeat(16), expiresAt: new Date(Date.now()+60000) };
  const db = { telegramApprovalAction: { findUnique: async () => ({ ...row, status: state }),
    updateMany: async () => { if (state !== 'PENDING') return { count: 0 }; state = 'PROCESSING'; writes++; return { count: 1 }; } } };
  const args = { prismaClient: db, callbackData: buildCallbackData(row.publicId, 'c', secret), signingSecret: secret, actorTelegramUserId: '123', telegramChatId: '123' };
  assert.equal((await claimTelegramApproval(args)).claimed, true);
  assert.equal((await claimTelegramApproval(args)).claimed, false); assert.equal(writes, 1);
  assert.equal((await claimTelegramApproval({ ...args, callbackData: buildCallbackData(row.publicId, 'a', secret) })).reason, 'action_not_allowed');
});
test('stall alert retains the new signed check button through existing outbox validation', async () => {
  const { createStallProcessor, trackProgress, STALL_MS } = require('../server/adminSignupTracker');
  const { normalizeInlineKeyboard } = require('../server/telegramOutbox');
  const f = fixture(), at = Date.parse('2026-11-15T12:00:00Z');
  f.record.onboardingTracker = trackProgress({}, f.record, at);
  const keyboard = buildApprovalKeyboard({ purpose: 'SIGNUP_CHECK', publicId: 'a'.repeat(16),
    context: { signupAttemptId: attempt, openUrl: 'https://www.myaipa.ca/#/admin?tab=signups' } }, secret);
  let enqueued, reads = 0;
  await createStallProcessor({ list: f.list, saveMany: () => {}, now: () => at + STALL_MS,
    diagnosticKeyboard: async record => { assert.equal(record.signupAttemptId, attempt); reads++; return keyboard; },
    frontendUrl: 'https://www.myaipa.ca', enqueue: async input => { enqueued = input; return { queued: true }; } })();
  assert.equal(reads, 1); assert.deepEqual(normalizeInlineKeyboard(enqueued.inlineKeyboard), keyboard);
});
test('diagnostic-control failure preserves the ordinary protected tracker link and alert', async () => {
  const { createStallProcessor, trackProgress, STALL_MS } = require('../server/adminSignupTracker');
  const f = fixture(), at = Date.parse('2026-11-15T12:00:00Z');
  f.record.onboardingTracker = trackProgress({}, f.record, at);
  let enqueued;
  await createStallProcessor({ list: f.list, saveMany: () => {}, now: () => at + STALL_MS,
    diagnosticKeyboard: async () => { throw Error('synthetic unavailable'); },
    frontendUrl: 'https://www.myaipa.ca', enqueue: async input => { enqueued = input; return { queued: true }; } })();
  assert.equal(enqueued.inlineKeyboard, undefined); assert.equal(enqueued.buttonText, 'Open signup tracker');
  assert.equal(enqueued.adminUrl, 'https://www.myaipa.ca/#/admin?tab=signups');
});
test('diagnostic result never exposes saved private contact or credential fields', async () => {
  const f = fixture(); Object.assign(f.record, { ownerEmail: 'private@example.invalid', ownerPhone: '+15555550123', apiKey: 'PRIVATE_FIXTURE_CREDENTIAL' });
  const out = JSON.stringify(await inspectSignup(f));
  assert.doesNotMatch(out, /private@example|5555550123|PRIVATE_FIXTURE_CREDENTIAL/);
});
