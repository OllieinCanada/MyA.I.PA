const assert = require('node:assert/strict');
const test = require('node:test');
const { compactNotice, noticeRequest, noticeStyle } = require('../server/telegramNotice');
const { buildIncidentRemediationUpdate, sendIncidentTelegramAlert } = require('../server/incidentAlerts');
const { sendTelegramOwnerStatus } = require('../server/telegramBotApi');

test('lifecycle notices remain brief and never confuse disappearance with repair', () => {
  for (const status of ['cleared', 'recovered', 'resolved', 'repair_dispatched', 'repair_ready', 'needs_user', 'failed']) {
    const text = buildIncidentRemediationUpdate({ status, incidentId: 'abcdef1234567890abcdef12',
      actionTaken: 'Checked saved logs.', verification: 'API returned 200.', nextAction: 'Review this signup before retrying.' });
    assert.ok(text.length < 600);
    assert.match(text, /Next: Review this signup before retrying/);
    assert.match(text, /INC-ABCDEF12/);
    if (status === 'cleared') assert.match(text, /Repair is not confirmed/);
    if (status === 'recovered') assert.match(text, /original customer request is not confirmed complete/);
    if (status !== 'resolved') assert.doesNotMatch(text, /VERIFIED FIXED/);
  }
});

test('older queued recovery walls become cards without repeating technical paragraphs', () => {
  const text = compactNotice('✅ MY AI PA — NO LONGER DETECTED\nReference: INC-ABCDEF12\nSummary: long private lifecycle signal\nWhat Codex/My AI PA did: long private lifecycle signal\nHow it was checked: long authenticated feed description\nYour next step: Review the original signup.');
  assert.ok(text.length < 300);
  assert.match(text, /Repair is not confirmed/);
  assert.match(text, /Next: Review the original signup/);
  assert.doesNotMatch(text, /private lifecycle|authenticated feed/);
  assert.doesNotMatch(text, /Customer work was not retried/); // Not recorded in this fixture.
});

test('a long action is never clipped into an incomplete instruction', () => {
  const text = compactNotice(`🔴 MY AI PA — CRITICAL\nNext: ${'Long instruction '.repeat(100)}do not create another number.`);
  assert.match(text, /Next: Open details before retrying or changing live resources\./);
  assert.doesNotMatch(text, /Long instruction/);
});

test('caption budget preserves action/reference, PNG and approval buttons', async () => {
  const text = `🔴 MY AI PA — CRITICAL\nIssue: ${'x'.repeat(4000)}\nImpact: ${'y'.repeat(4000)}\nNext: Do not create a duplicate number.\nReference: INC-ABCDEF12`;
  const keyboard = { inline_keyboard: [[{ text: 'Approve', callback_data: 'guarded-fixture' }]] };
  const request = noticeRequest(text, { chatId: '1', replyMarkup: keyboard });
  assert.ok(request.body.get('caption').length <= 950);
  assert.match(request.body.get('caption'), /Next: Do not create a duplicate number/);
  assert.match(request.body.get('caption'), /INC-ABCDEF12/);
  assert.deepEqual(JSON.parse(request.body.get('reply_markup')), keyboard);
  const png = Buffer.from(await request.body.get('photo').arrayBuffer());
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(noticeStyle('🔴 MY AI PA — CRITICAL').severity, 'critical');
});

test('owner action statuses use cards and redact private contact details', async () => {
  await sendTelegramOwnerStatus({ chatId: '1', text: 'Action stopped for owner@example.com token=private-secret.', openUrl: 'https://www.myaipa.ca/#/admin' }, {
    token: 'fixture', fetchImpl: async (url, options) => {
      assert.match(url, /sendPhoto$/);
      assert.doesNotMatch(options.body.get('caption'), /owner@example.com|private-secret/);
      assert.ok(options.body.get('photo'));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }));
    },
  });
});

test('blocked action explains its reason instead of exposing only an internal error code', async () => {
  await sendTelegramOwnerStatus({ chatId: '1', text: '🟡 Action stopped safely. Nothing is being claimed as complete. Reason: SIGNUP_RECOVERY_VAPI_BINDING_MISMATCH.' }, {
    token: 'fixture', fetchImpl: async (_url, options) => {
      const caption = options.body.get('caption');
      assert.match(caption, /could not be matched to this business’s assistant/);
      assert.match(caption, /Next: Open details/);
      assert.doesNotMatch(caption, /SIGNUP_RECOVERY_VAPI_BINDING_MISMATCH/);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }));
    },
  });
});

test('HTTP success without a Telegram message ID never confirms delivery', async () => {
  await assert.rejects(sendIncidentTelegramAlert({ title: 'Test' }, { token: 'fixture', chatId: '1',
    fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
  }), /failed/);
});
