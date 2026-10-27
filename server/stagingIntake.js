const crypto = require('node:crypto');
const { applyIntakeDecision } = require('./intakeLedger');
const TOOL_NAME = 'capture_confirmed_intake';
function authorizeStagingIntake({ authenticated, businessId, call, env }) {
  if (env.INTAKE_LEDGER_MODE !== 'staging' || env.APP_ENV !== 'staging' || env.RENDER_SERVICE_ID === 'srv-d92503a8qa3s73crdpog') {
    throw Object.assign(new Error('Staging intake is disabled.'), { statusCode: 404, code: 'INTAKE_DISABLED' });
  }
  if (!authenticated || !Number.isSafeInteger(businessId) || businessId <= 0 || businessId !== Number(env.STAGING_INTAKE_BUSINESS_ID)
    || !env.STAGING_INTAKE_ASSISTANT_ID || (call?.assistantId || call?.assistant?.id) !== env.STAGING_INTAKE_ASSISTANT_ID
    || typeof call?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(call.id)) {
    throw Object.assign(new Error('Trusted staging call mapping required.'), { statusCode: 403, code: 'INTAKE_SCOPE_MISMATCH' });
  }
}
async function handleStagingIntakeTool({ prisma, authenticated, businessId, call, toolCall, env = process.env }) {
  authorizeStagingIntake({ authenticated, businessId, call, env });
  if (toolCall.name !== TOOL_NAME) throw Object.assign(new Error('Unknown staging intake tool.'), { statusCode: 400 });
  const parameters = toolCall.parameters || {};
  if (parameters.businessId != null && Number(parameters.businessId) !== businessId) throw Object.assign(new Error('Cross-business intake rejected.'), { statusCode: 403 });
  const identity = { externalProvider: 'vapi-staging-ledger', externalId: call.id };
  const phone = call.customer?.number;
  if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone)) throw Object.assign(new Error('Provider caller identity required.'), { statusCode: 400 });
  const callLock = 'staging:intake-call:' + crypto.createHash('sha256').update(call.id).digest('hex');
  const savedCall = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${callLock}))::text AS lock_result`;
    const existing = await tx.call.findUnique({ where: { externalProvider_externalId: identity } });
    if (existing && existing.businessId !== businessId) throw Object.assign(new Error('Cross-business call rejected.'), { statusCode: 403 });
    if (existing) return existing;
    const caller = await tx.caller.upsert({ where: { phone }, create: { phone }, update: {} });
    return tx.call.create({ data: { ...identity, businessId, callerId: caller.id, status: 'STARTED', startedAt: new Date() } });
  }, { maxWait: 5000, timeout: 10000 });
  const callId = 'staging-' + crypto.createHash('sha256').update(call.id).digest('hex').slice(0, 40);
  return applyIntakeDecision({ prisma, input: { ...parameters, businessId: String(businessId), callId, eventId: toolCall.id },
    trusted: { businessId, callId, callDbId: savedCall.id, providerCallId: call.id, assistantId: env.STAGING_INTAKE_ASSISTANT_ID } });
}
module.exports = { TOOL_NAME, authorizeStagingIntake, handleStagingIntakeTool };
