'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createDispatchStub } = require('../scripts/stub-notification-dispatch');
const { prepareNotificationDraft: prepare, reviewNotificationDraft: review, dispatchReviewedNotification: send, registerNotificationDraftRoutes } = require('../server/smsNotificationDrafts');
const { dispatchHandler, claimNotificationDispatch } = require('../server/smsNotificationDispatch');
const { getVapiCompositeToolCode } = require('../server/compositeCallNotifications');
const { redactExpiredNotificationDrafts } = require('../server/smsNotificationDrafts');
const input = { callId: 'draft-test-call', from: '+19055550100', to: '+19055550101', leg: 'owner', body: 'Exact synthetic message\nWith a second line.' };
const actor = 'a'.repeat(32);
const env = { SMS_MANUAL_DISPATCH_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'AC_INERT', TWILIO_AUTH_TOKEN: 'INERT' };
function response() { return { statusCode: 200, headers: {}, set(k,v) { this.headers[k]=v; return this; }, status(n) { this.statusCode=n; return this; }, json(body) { this.body=body; return this; } }; }
async function fixture(extra = {}) {
  const { db, rows } = createDispatchStub(); const d = await prepare({ prisma: db, input });
  const options = { prisma: db, id: d.draftId, expectedRevision: d.revision, expectedHash: d.contextHash };
  const posts = [];
  const dispatch = change => send({ ...options, env, suppressionChecker: async () => false,
    fetchImpl: async (url, request) => { posts.push({ url, ...Object.fromEntries(new URLSearchParams(request.body)), redirect: request.redirect });
      if (extra.lostResponse) throw Error('accepted response lost');
      return { ok: true, status: 201, json: async () => ({ sid: extra.invalidSid ? 'invalid' : 'SM' + '1'.repeat(32), status: 'queued' }) }; }, ...change });
  return { db, rows, d, options, posts, dispatch,
    approve: () => review({ ...options, action: 'approve', actor }), cancel: () => review({ ...options, action: 'cancel', actor }) };
}
test('spoken approval alone stores a draft and cannot admit sending', async () => {
  const f = await fixture(); assert.equal(f.d.state, 'pending');
  await assert.rejects(f.dispatch(), /approval_required/); assert.equal(f.posts.length, 0);
});
test('approval persists the exact content hash and actor without sending', async () => {
  const f = await fixture(); const approved = await f.approve();
  assert.equal(approved.contextHash, f.d.contextHash); assert.equal(approved.body, input.body);
  assert.equal(f.posts.length, 0); assert.equal([...f.rows.values()][0].data.reviewedBy, actor);
});
test('send uses saved recipients/content and replays receipt without another POST', async () => {
  const f = await fixture(); await f.approve(); const sent = await f.dispatch();
  assert.equal(sent.result.sent, true); assert.equal(sent.state, 'completed');
  await f.dispatch(); assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].To, input.to); assert.equal(f.posts[0].From, input.from); assert.equal(f.posts[0].Body, input.body);
  assert.equal(f.posts[0].redirect, 'error'); assert.equal(sent.result.status, 'queued');
});
test('manual flag defaults off even with old dispatch enabled and valid approval', async () => {
  const f = await fixture(); await f.approve();
  await assert.rejects(f.dispatch({ env: { ...env, SMS_MANUAL_DISPATCH_ENABLED: undefined, SMS_NOTIFICATION_DISPATCH_ENABLED: 'true' } }), /dispatch_disabled/);
  assert.equal(f.posts.length, 0);
});
for (const field of ['body', 'to', 'from']) test('unreviewed changed ' + field + ' cannot use the previous approval', async () => {
  const f = await fixture(); await f.approve();
  const changed = await prepare({ prisma: f.db, input: { ...input, [field]: field === 'body' ? 'Changed text' : '+19055550999' } });
  await assert.rejects(send({ ...f.options, id: changed.draftId, env, suppressionChecker: async () => false, fetchImpl: () => assert.fail('must not send') }), /draft_changed|approval_required/);
  assert.equal(f.posts.length, 0);
});
test('same-content replay preserves revision and approval but never sends', async () => {
  const f = await fixture(); await f.approve(); const again = await prepare({ prisma: f.db, input });
  assert.equal(again.state, 'approved'); assert.equal(again.revision, f.d.revision); assert.equal(f.posts.length, 0);
});
test('cancellation before admission latches and cannot be undone by a replayed yes', async () => {
  const f = await fixture(); await f.approve(); await f.cancel();
  await assert.rejects(f.dispatch(), /approval_required/);
  await assert.rejects(prepare({ prisma: f.db, input }), /draft_cancelled/); assert.equal(f.posts.length, 0);
});
test('cancellation wins when queued before concurrent send admission', async () => {
  const f = await fixture(); await f.approve();
  const results = await Promise.allSettled([f.cancel(), f.dispatch()]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(f.posts.length, 0);
});
test('concurrent sends admit exactly one POST', async () => {
  const f = await fixture(); await f.approve(); await Promise.allSettled([f.dispatch(), f.dispatch(), f.dispatch()]);
  assert.equal(f.posts.length, 1);
});
for (const mode of ['lostResponse', 'invalidSid']) test(mode + ' is held and never resubmits', async () => {
  const f = await fixture({ [mode]: true }); await f.approve(); const first = await f.dispatch(), again = await f.dispatch();
  assert.equal(first.result.sent, false); assert.equal(again.result.sent, false); assert.equal(f.posts.length, 1);
});
test('preexisting unresolved admission remains held after manual approval', async () => {
  const f = await fixture(); await claimNotificationDispatch({ prisma: f.db, input }); await f.approve();
  assert.equal((await f.dispatch()).state, 'held'); await assert.rejects(f.dispatch(), /approval_required/); assert.equal(f.posts.length, 0);
});
test('suppression update before submission blocks POST and cannot auto-retry', async () => {
  const f = await fixture(); await f.approve(); const r = await f.dispatch({ suppressionChecker: async () => true });
  assert.equal(r.result.sent, false); assert.equal(r.result.status, 'suppressed');
  await f.dispatch(); assert.equal(f.posts.length, 0);
});
test('unavailable suppression fails closed', async () => {
  const f = await fixture(); await f.approve();
  const r = await f.dispatch({ suppressionChecker: async () => { throw Error('db offline'); } });
  assert.equal(r.result.sent, false); assert.equal(f.posts.length, 0);
});
test('expired approval and draft replay fail closed', async () => {
  const f = await fixture(); await f.approve();
  await assert.rejects(f.dispatch({ now: Date.now() + 86400001 }), /draft_expired/);
  await assert.rejects(prepare({ prisma: f.db, input, now: Date.now() + 86400001 }), /draft_expired/);
  assert.equal(f.posts.length, 0);
});
test('expiry removes draft content while retaining cancellation and duplicate holds', async () => {
  const f = await fixture(); await f.cancel();
  const future = Date.now() + 86400001;
  assert.equal(await redactExpiredNotificationDrafts({ prisma: f.db, now: future }), 1);
  const stored = JSON.stringify([...f.rows.values()]);
  assert.equal(stored.includes(input.body), false); assert.equal(stored.includes(input.to), false);
  assert.equal([...f.rows.values()][0].data.state, 'cancelled');
  await assert.rejects(prepare({ prisma: f.db, input, now: future }), /draft_cancelled/);
  assert.equal(f.posts.length, 0);
});
test('completion outage leaves claimed state and never reopens admission', async () => {
  const f = await fixture(); await f.approve(); const original = f.db.runtimeStore.update;
  f.db.runtimeStore.update = async args => { if (args.data.data.state === 'completed') throw Error('completion outage'); return original(args); };
  await assert.rejects(f.dispatch(), /completion_unconfirmed/); await assert.rejects(f.dispatch(), /approval_required/);
  assert.equal(f.posts.length, 1);
});
test('old phone claim route cannot send even when flags and tool-supplied approval are true', async () => {
  const f = await fixture(); const res = response();
  await dispatchHandler({ prisma: f.db, env: { ...env, SMS_NOTIFICATION_DISPATCH_ENABLED: 'true' }, authenticate: () => true })({ body: { action: 'claim', ...input, approved: true, consent: true, actor } }, res);
  assert.equal(res.statusCode, 403); assert.equal(res.body.granted, false); assert.equal(f.posts.length, 0);
});
test('generated phone code contains no provider create/claim/approval capability', () => {
  const code = getVapiCompositeToolCode();
  assert.match(code, /action: 'draft'/); assert.doesNotMatch(code, /api\.twilio\.com|TWILIO_AUTH|TWILIO_API_KEY|action: 'claim'|action: 'approve'/);
});
test('review API authenticates, requires trusted origin and rejects hidden routing overrides', async () => {
  const f = await fixture(), routes = {};
  const app = { get(path, ...handlers) { routes['GET ' + path] = handlers; }, post(path, ...handlers) { routes['POST ' + path] = handlers; } };
  registerNotificationDraftRoutes({ app, prisma: f.db, env, requireAdmin: (req,res,next) => req.admin ? next() : res.status(401).json({}),
    isAllowedOrigin: origin => origin === 'https://admin.test', actorHash: () => actor,
    suppressionChecker: async () => false, fetchImpl: () => assert.fail('review never sends') });
  const invoke = async (admin, headers = {}, body = {}) => {
    const req = { admin, headers, body, params: { id: f.d.draftId, action: 'approve' }, is: () => headers['content-type'] === 'application/json' }, res = response();
    const handlers = routes['POST /api/admin/notification-drafts/:id/:action']; let i = 0;
    const next = () => handlers[i++]?.(req,res,next); await next(); return res;
  };
  const headers = { origin: 'https://admin.test', 'x-myaipa-notification-review': '1', 'content-type': 'application/json' };
  const body = { expectedRevision: f.d.revision, expectedHash: f.d.contextHash };
  assert.equal((await invoke(false, headers, body)).statusCode, 401);
  assert.equal((await invoke(true, {}, body)).statusCode, 403);
  assert.equal((await invoke(true, { ...headers, origin: 'https://evil.test' }, body)).statusCode, 403);
  assert.equal((await invoke(true, headers, { ...body, to: '+19055550999' })).statusCode, 400);
  assert.equal((await invoke(true, headers, body)).body.state, 'approved');
  assert.equal(f.posts.length, 0);
});
