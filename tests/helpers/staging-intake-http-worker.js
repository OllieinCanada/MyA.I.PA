// Full app with a disposable database and an explicit deny-all provider boundary.
const path = require('node:path');
const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'DATABASE_URL', 'DATA_DIR', 'STAGING_INTAKE_BUSINESS_ID', 'STAGING_INTAKE_ASSISTANT_ID'].map(k => [k, process.env[k]]));
const target = new URL(inherited.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || !/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(target.pathname)) throw Error('Disposable loopback database required');
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, inherited, { NODE_ENV: 'test', APP_ENV: 'staging', INTAKE_LEDGER_MODE: 'staging', DISABLE_LOCAL_ENV_FILES: '1',
  JWT_SECRET: 'synthetic-intake-jwt-secret-at-least-32', ADMIN_SESSION_SECRET: 'synthetic-intake-admin-secret-at-least-32',
  VAPI_WEBHOOK_SECRET: 'synthetic-intake-webhook-secret', VAPI_REQUIRE_BUSINESS_MAPPING: 'true',
  VAPI_AUTO_SYNC_ENABLED: 'false', TRIAL_REMINDER_DISABLE: 'true', TRIAL_USAGE_LIMIT_ENABLED: 'false',
  MISSED_CALL_ALERT_ENABLED: 'false', DAILY_DIGEST_ENABLED: 'false', SIGNUP_SETUP_WORKER_PAUSED: 'true' });
const nativeFetch = global.fetch;
global.fetch = async (url, options) => {
  if (new URL(url).hostname !== '127.0.0.1') throw Error('External requests are forbidden in the staging-intake drill');
  return nativeFetch(url, options);
};
const { PrismaClient } = require('@prisma/client');
global.__myAiPaPrisma = new PrismaClient({ datasources: { db: { url: target.href } }, __internal: { configOverride: c => ({ ...c, relativeEnvPaths: {} }) } });
const { app } = require('../../server');
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
