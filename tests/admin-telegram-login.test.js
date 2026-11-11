const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { configured, configFromEnv, destination, destinationFromUrl, ownerLoginKeyboard, verifyIdentity, TTL } = require('../server/adminTelegramLogin');
const at = 1900000000000;
const env = { TELEGRAM_OWNER_LOGIN_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'fixture-bot-only', TELEGRAM_ADMIN_USER_ID: '1234567',
  TELEGRAM_CHAT_ID: '1234567', ADMIN_SESSION_SECRET: 'fixture-admin-session-secret-longer-than-32-characters' };
const config = configFromEnv(env);
function proof(changes = {}, atMs = at, botToken = config.botToken) {
  const p = { id: '1234567', first_name: 'Fixture owner', auth_date: String(Math.floor(atMs / 1000)), ...changes };
  const key = crypto.createHash('sha256').update(botToken).digest();
  return { ...p, hash: crypto.createHmac('sha256', key).update(Object.keys(p).sort().map(k => k + '=' + p[k]).join('\n')).digest('hex') };
}
test('feature defaults off and never infers owner from chat alone or accepts a group', () => {
  assert.equal(configured(config), true); assert.equal(configured(configFromEnv({})), false);
  for (const changes of [{ enabled: false }, { ownerId: '' }, { chatId: '-123' }, { chatId: '999' }, { sessionSecret: 'short' }, { botToken: '' }, { totpEnabled: true }])
    assert.equal(configured({ ...config, ...changes }), false);
});
test('identity is exactly the signed numeric owner ID, never the name or username', () => {
  assert.equal(verifyIdentity(proof(), config, at), true);
  assert.equal(verifyIdentity(proof({ id: '999', username: 'same_owner_name' }), config, at), false);
  const p = proof(); p.first_name = 'forged'; assert.equal(verifyIdentity(p, config, at), false);
  assert.equal(verifyIdentity(proof({}, at, 'another-fixture-bot'), config, at), false);
});
test('stale, future, malformed, extra and newline-injected fields fail closed', () => {
  assert.equal(verifyIdentity(proof({}, at - TTL + 1000), config, at), true);
  for (const age of [-31000, TTL, TTL + 1000]) assert.equal(verifyIdentity(proof({}, at - age), config, at), false);
  for (const changes of [{ first_name: 'x\nid=1234567' }, { id: 1234567 }, { auth_date: 'NaN' }, { unexpected: 'value' }])
    assert.equal(verifyIdentity(proof(changes), config, at), false);
  for (const p of [null, [], {}, { ...proof(), hash: '0'.repeat(64) }]) assert.equal(verifyIdentity(p, config, at), false);
});
test('only exact tracker, dashboard or 24-hex incident destinations are allowed', () => {
  const incident = 'a'.repeat(24);
  assert.deepEqual(destinationFromUrl('https://www.myaipa.ca/#/admin?tab=attention&incident=' + incident), { tab: 'attention', incident });
  assert.deepEqual(destinationFromUrl('https://myaipa.ca/#/admin'), { tab: 'overview' });
  for (const raw of ['https://evil.example/#/admin', 'https://www.myaipa.ca.evil.test/#/admin', 'https://www.myaipa.ca/?secret=x#/admin',
    'https://u:p@www.myaipa.ca/#/admin', 'https://www.myaipa.ca/#/admin?tab=overview&tab=signups',
    'https://www.myaipa.ca/#/admin?tab=attention&incident=INC-ABCD', 'https://www.myaipa.ca/#/admin?returnUrl=https://evil.test']) assert.equal(destinationFromUrl(raw), null);
  assert.equal(destination({ tab: 'signups', incident }), null); assert.equal(destination({ tab: '//evil.test' }), null);
  for (const tab of [null, 0, '', [], {}]) assert.equal(destination({ tab }), null);
});
test('all three owner buttons become identity-verifying LoginUrl buttons at send time, with no expiring credential', () => {
  const incident = 'a'.repeat(24);
  const original = { inline_keyboard: [[{ text: 'Open signup tracker', url: 'https://www.myaipa.ca/#/admin?tab=signups' }],
    [{ text: 'Open exact issue', url: 'https://www.myaipa.ca/#/admin?tab=attention&incident=' + incident }, { text: 'Open dashboard', url: 'https://www.myaipa.ca/#/admin' }],
    [{ text: 'Approve', callback_data: 'guarded-existing-fixture' }, { text: 'Render', url: 'https://dashboard.render.com/' }]] };
  const before = JSON.stringify(original), changed = ownerLoginKeyboard(original, { chatId: env.TELEGRAM_CHAT_ID, botToken: env.TELEGRAM_BOT_TOKEN, env });
  assert.equal(JSON.stringify(original), before);
  for (const button of [changed.inline_keyboard[0][0], ...changed.inline_keyboard[1]]) {
    assert.equal(button.url, undefined); assert.equal(button.login_url.request_write_access, false);
    assert.match(button.login_url.url, /^https:\/\/api\.myaipa\.ca\/admin\/telegram-sign-in\?tab=/);
    assert.doesNotMatch(button.login_url.url, /token|hash|auth_date|secret|password|expires/i);
  }
  assert.ok(changed.inline_keyboard[1][0].login_url.url.endsWith('incident=' + incident));
  assert.deepEqual(changed.inline_keyboard[2], original.inline_keyboard[2]);
  assert.strictEqual(ownerLoginKeyboard(original, { chatId: env.TELEGRAM_CHAT_ID, botToken: 'wrong-bot', env }), original);
  assert.strictEqual(ownerLoginKeyboard(original, { chatId: env.TELEGRAM_CHAT_ID, env }), original);
  assert.strictEqual(ownerLoginKeyboard(original, { chatId: '999', botToken: env.TELEGRAM_BOT_TOKEN, env }), original);
  assert.strictEqual(ownerLoginKeyboard(original, { chatId: env.TELEGRAM_CHAT_ID, botToken: env.TELEGRAM_BOT_TOKEN, env: { ...env, TELEGRAM_OWNER_LOGIN_ENABLED: 'false' } }), original);
});
test('the real notification envelope transforms buttons only with the feature explicitly enabled', () => {
  const { noticeRequest } = require('../server/telegramNotice');
  const old = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  try {
    Object.assign(process.env, env);
    const result = noticeRequest('MY AI PA — SIGNUP NEEDS ATTENTION', { chatId: env.TELEGRAM_CHAT_ID, botToken: env.TELEGRAM_BOT_TOKEN,
      replyMarkup: { inline_keyboard: [[{ text: 'Open signup tracker', url: 'https://www.myaipa.ca/#/admin?tab=signups' }]] } });
    assert.ok(JSON.parse(result.body.get('reply_markup')).inline_keyboard[0][0].login_url);
    assert.doesNotMatch(result.body.get('reply_markup'), /fixture-bot-only|fixture-admin-session/);
  } finally { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
