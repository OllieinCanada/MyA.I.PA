'use strict';
const crypto = require('node:crypto');
const { validateDrillTarget, syntheticInput } = require('./sms-dispatch-postgres-safety');

async function main() {
  const url = validateDrillTarget(process.env);
  if (typeof process.send !== 'function') throw Error('sms_drill_ipc_required');
  // Dependencies are loaded only after the exact disposable target is validated.
  const { PrismaClient } = require('@prisma/client');
  const { claimNotificationDispatch, completeNotificationDispatch } = require('../server/smsNotificationDispatch');
  const { executeCompositeNotifications } = require('../server/compositeCallNotifications');
  const db = new PrismaClient({ datasources: { db: { url } },
    __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
  const send = message => new Promise((resolve, reject) => process.send(message, e => e ? reject(e) : resolve()));
  const hold = () => new Promise(() => {});
  try {
    await db.$connect();
    // No inherited provider fetch is ever used, even for an unexpected endpoint.
    global.fetch = async () => { throw Error('sms_drill_external_fetch_forbidden'); };
    const start = new Promise(resolve => process.once('message', resolve));
    await send({ type: 'ready' });
    const task = await start;
    const modes = ['normal', 'crash_after_claim', 'crash_after_submission', 'lose_complete_ack',
      'complete_unavailable', 'unknown_provider', 'unauthorized'];
    if (!modes.includes(task?.mode)) throw Error('sms_drill_mode_invalid');
    const { args, env } = syntheticInput(task.callId, task.changed === true);
    // Synthetic low-level admission drill ONLY. The production phone route now
    // rejects claims; this private adapter is never used by application routes.
    const handler = async (req, res) => {
      if (task.mode === 'unauthorized' || req.headers.authorization !== 'Bearer INERT') return res.status(401).json({});
      try { return res.json(await (req.body.action === 'claim' ? claimNotificationDispatch : completeNotificationDispatch)({ prisma: db, input: req.body })); }
      catch (e) { return res.status(e.statusCode || 503).json({ errorCode: e.code || 'synthetic_store_unavailable' }); }
    };
    const fakeFetch = async (endpoint, options) => {
      if (endpoint === env.SMS_NOTIFICATION_DISPATCH_URL) {
        const body = JSON.parse(options.body);
        if (body.action === 'claim' && body.leg === 'owner') await send({ type: 'requesting_claim' });
        if (body.action === 'complete' && task.mode === 'complete_unavailable') throw Error('synthetic_completion_outage');
        const res = { statusCode: 200, status(n) { this.statusCode = n; return this; },
          json(value) { this.body = value; return this; } };
        await handler({ body, headers: { authorization: options.headers.Authorization } }, res);
        if (body.action === 'claim' && body.leg === 'owner' && res.body.granted === true
          && task.mode === 'crash_after_claim') { await send({ type: 'claimed' }); await hold(); }
        if (body.action === 'complete' && task.mode === 'lose_complete_ack' && res.body.stored === true)
          throw Error('synthetic_completion_ack_lost');
        return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => res.body };
      }
      if (endpoint === env.SMS_SUPPRESSION_CHECK_URL)
        return { ok: true, status: 200, json: async () => ({ allowed: true }) };
      if (endpoint !== 'https://api.twilio.com/2010-04-01/Accounts/AC_INERT/Messages.json')
        throw Error('sms_drill_unknown_endpoint');
      const params = new URLSearchParams(options.body);
      if (params.get('From') !== env.DEFAULT_FROM_NUMBER) throw Error('sms_drill_sender_invalid');
      const leg = params.get('To') === env.DEFAULT_OWNER_TO_NUMBER ? 'owner'
        : params.get('To') === env.CALLER_NUMBER ? 'customer' : '';
      if (!leg || options.headers.Authorization !== 'Basic '+Buffer.from('AC_INERT:INERT').toString('base64'))
        throw Error('sms_drill_transport_invalid');
      const bodyHash = crypto.createHash('sha256').update(params.get('Body') || '').digest('hex');
      // This is the entire fake transport: a row in the disposable test DB.
      await db.$executeRaw`INSERT INTO "SmsDispatchDrillTransport" ("caseId", "leg", "bodyHash") VALUES (${task.callId}, ${leg}, ${bodyHash})`;
      if (leg === 'owner' && task.mode === 'crash_after_submission') {
        await send({ type: 'submitted' }); await hold();
      }
      if (leg === 'owner' && task.mode === 'unknown_provider') throw Error('synthetic_provider_response_lost');
      return { ok: true, status: 201, json: async () => ({ sid: 'SM'+crypto.randomBytes(16).toString('hex'), status: 'queued' }) };
    };
    const result = await executeCompositeNotifications({ args, env, fetchImpl: fakeFetch,
      btoaImpl: v => Buffer.from(v).toString('base64'), URLSearchParamsImpl: URLSearchParams });
    await send({ type: 'result', result });
  } finally { await db.$disconnect(); }
}

if (require.main === module) main().catch(async error => {
  if (process.send) await new Promise(resolve => process.send({ type: 'error', code: String(error.code || 'sms_drill_worker_failed') }, () => resolve()));
  process.exitCode = 1;
});
module.exports = { main };
