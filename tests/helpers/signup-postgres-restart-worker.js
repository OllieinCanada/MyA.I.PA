// Started only by the isolated recovery drill, with an empty cwd/environment.
const { runProvisioningStep } = require('../../server/provisioningState');
const { dispatchSignupSms } = require('../../server/signupSmsDispatch');
const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(target.pathname)) throw Error('Isolated loopback drill database required');
const allowedKeys = ['PATH', 'SystemRoot', 'NODE_ENV', 'DATABASE_URL', 'DATA_DIR', 'JWT_SECRET', 'ADMIN_PASSWORD', 'DISABLE_LOCAL_ENV_FILES'];
const cleanEnvironment = Object.fromEntries(allowedKeys.filter(key => process.env[key] != null).map(key => [key, process.env[key]]));
const { PrismaClient } = require('@prisma/client');
// Generated Prisma clients otherwise auto-load the repository .env even when
// the child process has an empty cwd and a sanitized inherited environment.
global.__myAiPaPrisma = new PrismaClient({ datasources: { db: { url: target.toString() } },
  __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
for (const key of Object.keys(process.env)) if (!Object.hasOwn(cleanEnvironment, key)) delete process.env[key];
Object.assign(process.env, cleanEnvironment);
// Forbid all external HTTP, including accidental background provider traffic.
global.fetch = async () => { throw Error('External provider traffic forbidden in restart drill'); };
const { app, startServer } = require('../../server/index');
if (['STRIPE_SECRET_KEY', 'VAPI_API_KEY', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY_SECRET', 'TELEGRAM_BOT_TOKEN', 'SMTP_PASSWORD', 'SMTP_PASS'].some(key => process.env[key])) {
  throw Error('Provider credentials must be absent from the isolated drill process');
}
const prisma = global.__myAiPaPrisma;
app.post('/__local-signup-recovery-drill', async (req, res) => {
  const { identity, kind, fault } = req.body;
  if (!/^drill-[a-z0-9-]+$/.test(identity || '') || !['twilio-number', 'vapi-assistant', 'vapi-import', 'signup-sms', 'stripe-trial', 'crm'].includes(kind)) return res.sendStatus(400);
  const providerKey = `drill-provider:${identity}:${kind}`;
  try {
    const result = await runProvisioningStep({ prisma, kind, idempotencyKey: identity, contextHash: 'isolated-drill',
      reconcile: async () => {
        if (fault === 'before-dispatch') process.exit(86);
        return (await prisma.runtimeStore.findUnique({ where: { key: providerKey } }))?.data || null;
      },
      verifyCompleted: async saved => (await prisma.runtimeStore.findUnique({ where: { key: providerKey } }))?.data?.id === saved.id,
      execute: async () => {
        const prior = await prisma.runtimeStore.findUnique({ where: { key: providerKey } });
        const receipt = { id: `${identity}-${kind}`, sid: 'SMisolated', creates: Number(prior?.data?.creates || 0) + 1 };
        await prisma.runtimeStore.upsert({ where: { key: providerKey }, update: { data: receipt }, create: { key: providerKey, data: receipt } });
        if (fault === 'after-provider') process.exit(86);
        return receipt;
      },
    });
    if (fault === 'after-commit') process.exit(86);
    res.json(result);
  } catch (error) { res.status(409).json({ code: error.code || 'DRILL_FAILED' }); }
});
app.post('/__local-signup-sms-drill', async (req, res) => {
  const { identity, purpose, fault } = req.body;
  if (!/^drill-[a-z0-9-]+$/.test(identity || '') || !['owner-test', 'customer-test', 'setup-complete'].includes(purpose)) return res.sendStatus(400);
  const providerKey = `drill-sms-provider:${identity}:${purpose}`;
  try {
    const result = await dispatchSignupSms({ prisma, identity, purpose,
      request: { to: '+19055550123', from: '+12895550123', message: 'ISOLATED DATABASE DRILL ONLY' },
      sendSms: async () => {
        const prior = await prisma.runtimeStore.findUnique({ where: { key: providerKey } });
        const receipt = { sid: 'SMisolated', status: 'queued', creates: Number(prior?.data?.creates || 0) + 1 };
        await prisma.runtimeStore.upsert({ where: { key: providerKey }, update: { data: receipt }, create: { key: providerKey, data: receipt } });
        if (fault === 'after-provider') process.exit(86);
        return receipt;
      },
    });
    if (fault === 'after-commit') process.exit(86);
    res.json(result);
  } catch (error) { res.status(409).json({ code: error.code || 'DRILL_FAILED' }); }
});
const server = startServer(0, '127.0.0.1');
server.once('listening', () => process.send({ port: server.address().port }));
