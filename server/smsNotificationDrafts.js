'use strict';
// Manual review remains optional. Automatic admission needs independently
// checked caller confirmation; a tool-supplied boolean cannot authorize it.
const { dispatchContext, withDispatchLock, claimNotificationDispatch, completeNotificationDispatch } = require('./smsNotificationDispatch');
const { submitTwilioMessage } = require('./compositeCallNotifications');
const PREFIX = 'call-notification-draft:v1:';
const TTL = 24 * 60 * 60 * 1000;
const fail = (code, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });
function keyFor(id) {
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw fail('notification_draft_invalid', 400);
  return PREFIX + id;
}
const view = data => {
  const expired = Date.parse(data.expiresAt) <= Date.now();
  const input = data.input || { callId: 'Expired', from: '(expired)', to: '(expired)', leg: data.leg, body: 'Draft details expired.' };
  return { id: data.id, revision: data.revision, contextHash: data.contextHash,
    ...input, expired, state: expired && ['pending', 'approved'].includes(data.state) ? 'expired' : data.state,
    createdAt: data.createdAt, expiresAt: data.expiresAt, approvedAt: data.approvedAt || null, result: data.result || null };
};
async function prepareNotificationDraft({ prisma, input, now = Date.now() }) {
  if (['callId', 'from', 'to', 'leg', 'body'].some(k => typeof input?.[k] !== 'string')) throw fail('notification_draft_input_invalid', 400);
  const { key, contextHash } = dispatchContext(input);
  const id = key.split(':').at(-1), draftKey = keyFor(id);
  return withDispatchLock(prisma, draftKey, async tx => {
    const previous = (await tx.runtimeStore.findUnique({ where: { key: draftKey } }))?.data;
    if (previous?.state === 'cancelled') throw fail('notification_draft_cancelled');
    if (previous && Date.parse(previous.expiresAt) <= now) throw fail('notification_draft_expired');
    if (previous?.contextHash === contextHash) return { schemaVersion: 1, draftStored: true, draftId: id,
      revision: previous.revision, contextHash, state: previous.state, requiresApproval: true };
    if (previous && ['claimed', 'completed', 'held'].includes(previous.state)) throw fail('notification_draft_submission_held');
    const data = { version: 1, id, contextHash, revision: (previous?.revision || 0) + 1, state: 'pending', redacted: false,
      input: { callId: String(input.callId).trim(), from: input.from, to: input.to, leg: input.leg, body: input.body },
      createdAt: previous?.createdAt || new Date(now).toISOString(),
      expiresAt: previous?.expiresAt || new Date(now + TTL).toISOString() };
    // Replacing any field discards approval. A replay does not extend the deadline.
    if (previous) await tx.runtimeStore.update({ where: { key: draftKey }, data: { data } });
    else await tx.runtimeStore.create({ data: { key: draftKey, data } });
    return { schemaVersion: 1, draftStored: true, draftId: id, revision: data.revision, contextHash,
      state: data.state, requiresApproval: true };
  });
}
async function redactExpiredNotificationDrafts({ prisma, now = Date.now() }) {
  const rows = await prisma.runtimeStore.findMany({ where: { key: { startsWith: PREFIX },
    createdAt: { lte: new Date(now - TTL) }, data: { path: ['redacted'], equals: false } }, take: 100 });
  let count = 0;
  for (const row of rows) await withDispatchLock(prisma, row.key, async tx => {
    const data = (await tx.runtimeStore.findUnique({ where: { key: row.key } }))?.data;
    if (!data || data.redacted || Date.parse(data.expiresAt) > now) return;
    const { input, ...retained } = data;
    await tx.runtimeStore.update({ where: { key: row.key }, data: { data: { ...retained, leg: input?.leg,
      redacted: true, redactedAt: new Date(now).toISOString() } } });
    count++;
  });
  return count; // Never delete/reset admission claims or cancellation tombstones.
}
async function withReviewedDraft({ prisma, id, expectedRevision, expectedHash, now = Date.now() }, fn) {
  const key = keyFor(id);
  return withDispatchLock(prisma, key, async tx => {
    const data = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
    if (!data || data.version !== 1) throw fail('notification_draft_not_found', 404);
    if (Date.parse(data.expiresAt) <= now) throw fail('notification_draft_expired');
    if (data.revision !== expectedRevision || data.contextHash !== expectedHash) throw fail('notification_draft_changed');
    return fn(tx, key, data);
  });
}
async function reviewNotificationDraft(options) {
  const { action, actor } = options;
  if (!['approve', 'cancel'].includes(action) || !/^[a-f0-9]{32}$/.test(String(actor || ''))) throw fail('notification_review_invalid', 400);
  return withReviewedDraft(options, async (tx, key, data) => {
    if (['claimed', 'completed', 'held'].includes(data.state)) throw fail('notification_submission_already_admitted');
    if (data.state === 'cancelled') throw fail('notification_draft_cancelled');
    const next = { ...data, state: action === 'approve' ? 'approved' : 'cancelled',
      approvedAt: action === 'approve' ? new Date(options.now ?? Date.now()).toISOString() : null,
      reviewedBy: actor };
    await tx.runtimeStore.update({ where: { key }, data: { data: next } });
    return view(next);
  });
}
async function dispatchDraftNotification(options, automatic = false) {
  const { prisma, env = process.env, fetchImpl = global.fetch, suppressionChecker } = options;
  if (automatic ? env.SMS_AUTOMATIC_DISPATCH_ENABLED !== 'true' : env.SMS_MANUAL_DISPATCH_ENABLED !== 'true') {
    throw fail(automatic ? 'automatic_notification_dispatch_disabled' : 'manual_notification_dispatch_disabled', 503);
  }
  if (typeof suppressionChecker !== 'function') throw fail('notification_suppression_unavailable', 503);
  // Same draft lock serializes cancellation, edits, and send admission. The
  // nested adapter uses this transaction, never a second DB transaction.
  const admission = await withReviewedDraft(options, async (tx, key, data) => {
    if (data.state === 'completed') return { replay: view(data) };
    if (automatic) {
      if (!['pending', 'approved'].includes(data.state)) throw fail('notification_submission_already_admitted');
      // The trusted server adapter binds approval to this exact draft revision.
      // It must not perform network I/O while this transaction holds locks.
      if (typeof options.authorize !== 'function' || options.authorize(data) !== true) {
        throw fail('caller_confirmation_required');
      }
    } else if (data.state !== 'approved') throw fail('manual_notification_approval_required');
    const claim = await claimNotificationDispatch({ prisma: { runtimeStore: tx.runtimeStore, $transaction: fn => fn(tx) }, input: data.input });
    if (claim.granted !== true) {
      const held = { ...data, state: 'held' };
      await tx.runtimeStore.update({ where: { key }, data: { data: held } });
      return { replay: view(held) };
    }
    const claimed = { ...data, state: 'claimed', admittedAt: new Date().toISOString(),
      authorizationBasis: automatic ? 'caller_confirmation_snapshot' : 'admin_review' };
    await tx.runtimeStore.update({ where: { key }, data: { data: claimed } });
    return { key, data: claimed, token: claim.claimToken };
  });
  if (admission.replay) return admission.replay;
  const { data, key, token } = admission;
  // No input recipients/content/settings from the send request are trusted.
  // Reuse the no-retry sender, with a direct DB suppression lookup and fixed
  // provider origin. Configuration never comes from the phone tool's payload.
  const checkUrl = 'https://notification-suppression.internal/check';
  const guardedFetch = async (url, request) => {
    if (url === checkUrl) {
      const suppressed = await suppressionChecker(data.input.to);
      if (typeof suppressed !== 'boolean') throw fail('notification_suppression_unavailable', 503);
      return { ok: true, json: async () => ({ allowed: !suppressed, suppressed }) };
    }
    if (url !== `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(String(env.TWILIO_ACCOUNT_SID || '').trim())}/Messages.json`) throw fail('notification_provider_origin_invalid');
    return fetchImpl(url, { ...request, redirect: 'error', signal: AbortSignal.timeout(10000) });
  };
  const result = await submitTwilioMessage({ ...data.input, env: { ...env, SMS_SUPPRESSION_CHECK_URL: checkUrl,
    SMS_SUPPRESSION_API_KEY: 'backend-local' }, fetchImpl: guardedFetch, btoaImpl: value => Buffer.from(value).toString('base64'),
    URLSearchParamsImpl: URLSearchParams });
  try {
    // Receipt and draft completion commit together; failures keep the claim held.
    return await withDispatchLock(prisma, key, async tx => {
      await completeNotificationDispatch({ prisma: { runtimeStore: tx.runtimeStore, $transaction: fn => fn(tx) },
        input: { ...data.input, claimToken: token, result } });
      const completed = { ...data, state: 'completed', result };
      await tx.runtimeStore.update({ where: { key }, data: { data: completed } });
      return view(completed);
    });
  } catch { throw fail('notification_completion_unconfirmed_do_not_retry', 503); }
}
async function dispatchReviewedNotification(options) { return dispatchDraftNotification(options); }
async function dispatchConfirmedNotification(options) { return dispatchDraftNotification(options, true); }
function registerNotificationDraftRoutes({ app, prisma, requireAdmin, isAllowedOrigin, actorHash, env = process.env, fetchImpl, suppressionChecker }) {
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json(await fn(req)); }
    catch (e) { return res.status(e.statusCode || 503).json({ error: e.statusCode ? e.code : 'notification_store_unavailable' }); }
  };
  const mutation = (req, res, next) => {
    if (!isAllowedOrigin(req.headers.origin) || !req.headers.origin || req.headers['x-myaipa-notification-review'] !== '1'
      || !req.is('application/json')) return res.status(403).json({ error: 'notification_review_origin_invalid' });
    return next();
  };
  app.get('/api/admin/notification-drafts', requireAdmin, handle(async () => {
    const rows = await prisma.runtimeStore.findMany({ where: { key: { startsWith: PREFIX } }, orderBy: { updatedAt: 'desc' }, take: 100 });
    return { dispatchEnabled: env.SMS_MANUAL_DISPATCH_ENABLED === 'true', drafts: rows.filter(r => r.data?.version === 1
      && (Date.parse(r.data.expiresAt) > Date.now() || ['claimed', 'completed', 'held'].includes(r.data.state))).map(r => view(r.data)) };
  }));
  app.post('/api/admin/notification-drafts/:id/:action', requireAdmin, mutation, handle(async req => {
    // Refuse hidden content or routing overrides, including client-set approval.
    if (Object.keys(req.body || {}).some(k => !['expectedRevision', 'expectedHash'].includes(k))) throw fail('notification_review_fields_invalid', 400);
    const options = { prisma, id: req.params.id, expectedRevision: req.body?.expectedRevision, expectedHash: req.body?.expectedHash };
    return req.params.action === 'send'
      ? dispatchReviewedNotification({ ...options, env, fetchImpl, suppressionChecker })
      : reviewNotificationDraft({ ...options, action: req.params.action, actor: actorHash(req) });
  }));
}
module.exports = { prepareNotificationDraft, reviewNotificationDraft, dispatchReviewedNotification, dispatchConfirmedNotification, registerNotificationDraftRoutes, redactExpiredNotificationDrafts };
