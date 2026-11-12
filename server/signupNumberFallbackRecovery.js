// Explicit admin-only preparation. No provider mutations, claims, sends or retries.
const crypto = require('node:crypto');
const { buildProvisioningAccountKey, buildProvisioningResourceName, buildProvisioningContextHash,
  buildProvisioningAuthorizationToken, verifySignupProvisioningAuthorization } = require('./signupProvisioning');
const { contextStoreKey } = require('./signupProvisioningContext');
const { provisioningStateKey } = require('./provisioningState');
const { regionalAreaCodes, allowedAreaCodes } = require('./numberAreaPolicy');
const { buildMakeSignupEventKey } = require('./makeSignupWebhook');
const { isContactVerified } = require('./signupVerificationChannel');
const { journalKey, amendedRecoveryCopy } = require('./intakeRecoveryJournal');
const STOCKOUT = 'LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE';
const SETTLE_MS = 30 * 60 * 1000;
function refuse(code) { throw Object.assign(Error('Number fallback recovery stopped: ' + code), { code, statusCode: 409 }); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function identity(record) {
  if (!record || record.status !== 'setup_error' || !isContactVerified(record)
    || record.twilioPhoneNumber || record.vapiAssistantId || record.vapiPhoneNumberId
    || record.subscriptionId || record.checkoutSessionId || record.archivedAt || record.rejectedAt
    || (record.smsVerificationRequired && !(record.smsVerified || record.smsVerifiedAt))
    || (record.emailVerificationRequired && !(record.emailVerified || record.emailVerifiedAt))
    || !/^signup_[a-f0-9]{32}$/.test(record.signupAttemptId || '')) refuse('SIGNUP_NOT_ELIGIBLE');
  return buildProvisioningAccountKey(record.ownerEmail, record.ownerPhone, record.businessName);
}
async function snapshot(prisma, key, attemptId) {
  const keys = [contextStoreKey(key), ...['twilio-number','vapi-assistant','vapi-import'].map(k => provisioningStateKey(k,key)), journalKey(attemptId)];
  const values = [];
  for (const k of keys) values.push((await prisma.runtimeStore.findUnique({where:{key:k}}))?.data || null);
  return { keys, values };
}
function eligible(state, record, key, expectedHash, secret, now) {
  const [context, number, assistant, imported] = state.values;
  if (!context?.lockedAt || context.completedAt || context.fallbackRecovery
    || context.contextHash !== expectedHash || context.payload?.provisioning?.idempotencyKey !== key
    || !verifySignupProvisioningAuthorization(context.payload, secret)
    || buildMakeSignupEventKey(context.payload) !== record.signupAttemptId) refuse('CONTEXT_NOT_ELIGIBLE');
  const p = context.payload.provisioning;
  const oldOrder = allowedAreaCodes(p.preferredAreaCode, p.preferredRegion, p.allowedAreaCodes);
  const order = regionalAreaCodes(p.preferredAreaCode, p.preferredRegion);
  if (oldOrder.length !== 1 || order.length < 2) refuse('POLICY_NOT_STRICT_REGIONAL');
  // Only a definitive pre-purchase stockout may be reclassified as not dispatched.
  // Timeouts, generic Make errors and merely absent inventory are NOT sufficient.
  if (!number || number.contextHash !== expectedHash || number.status !== 'failed' || number.result
    || number.originalErrorCode !== STOCKOUT || number.lastErrorCode !== STOCKOUT
    || number.fallbackRecovery || number.guardedRecovery
    || number.attempts !== 1
    || !Number.isFinite(Date.parse(number.failedAt)) || now - Date.parse(number.failedAt) < SETTLE_MS
    || (number.leaseExpiresAt && Date.parse(number.leaseExpiresAt) > now)) refuse('PURCHASE_OUTCOME_NOT_PROVEN_STOCKOUT');
  // Even a failed downstream claim may have caused a side effect: require absence.
  if (assistant || imported) refuse('DOWNSTREAM_STAGE_EXISTS');
  return order;
}
function verifyInventory(inventory, key) {
  if (!inventory || inventory.complete !== true || !Array.isArray(inventory.twilioNumbers)
    || !Array.isArray(inventory.vapiAssistants) || !Array.isArray(inventory.vapiPhones)) refuse('INVENTORY_INCOMPLETE');
  const marker = buildProvisioningResourceName('twilio-number', key);
  const assistantName = buildProvisioningResourceName('vapi-assistant', key);
  const phoneName = buildProvisioningResourceName('vapi-phone', key);
  if (inventory.twilioNumbers.some(n => String(n.friendly_name || '').trim() === marker)
    || inventory.vapiAssistants.some(a => String(a.name || '').trim() === assistantName)
    || inventory.vapiPhones.some(p => String(p.name || '').trim() === phoneName)) refuse('EXISTING_PROVIDER_RESOURCE');
}
async function prepareNumberFallbackRecovery({ prisma, getRecord, readInventory, signupAttemptId,
  expectedContextHash, actorHash, signingSecret, enabled, apply, now = Date.now() }) {
  if (enabled !== true || typeof apply !== 'boolean' || !/^[a-f0-9]{64}$/.test(expectedContextHash || '')
    || !/^[a-f0-9]{32}$/.test(actorHash || '')) refuse('RECOVERY_INPUT_INVALID');
  const record = structuredClone(getRecord(signupAttemptId)), key = identity(record);
  const before = await snapshot(prisma, key, signupAttemptId);
  const order = eligible(before, record, key, expectedContextHash, signingSecret, now);
  // Validate encrypted intake before either a dry-run success or any writes.
  amendedRecoveryCopy(before.values[4],before.values[0].payload,before.values[0].payload,signingSecret,now);
  verifyInventory(await readInventory(), key);
  const result = {ok:true, eligible:true, applied:false, signupAttemptId, areaOrder:order,
    expectedContextHash, numbersPurchased:0, reservesAssigned:0, textsSent:0, callsPlaced:0, requiresSeparateResume:true};
  if (!apply) return result;
  return prisma.$transaction(async tx => {
    // Same advisory locks as the context and paid stages; hold all until commit.
    for (const k of [...before.keys].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))::text AS lock_result`;
    const currentRecord = getRecord(signupAttemptId);
    if (!same(record, currentRecord) || identity(currentRecord) !== key) refuse('SIGNUP_CHANGED');
    const fresh = await snapshot(tx, key, signupAttemptId);
    if (!same(before.values, fresh.values)) refuse('SAVED_STATE_CHANGED');
    eligible(fresh, currentRecord, key, expectedContextHash, signingSecret, now);
    const [context, number] = fresh.values;
    const payload = structuredClone(context.payload);
    payload.provisioning.allowedAreaCodes = order;
    const hash = buildProvisioningContextHash(payload);
    payload.provisioning.contextHash = hash;
    payload.provisioning.authorizationToken = buildProvisioningAuthorizationToken(hash,key,signingSecret);
    if (!verifySignupProvisioningAuthorization(payload,signingSecret)
      || buildMakeSignupEventKey(payload) !== signupAttemptId) refuse('AMENDED_CONTEXT_INVALID');
    const journalKey = 'signup-number-fallback-recovery:' + crypto.createHash('sha256').update(key).digest('hex');
    if (await tx.runtimeStore.findUnique({where:{key:journalKey}})) refuse('RECOVERY_ALREADY_PREPARED');
    const at = new Date(now).toISOString();
    const recovery = {actorHash,at,signupAttemptId,priorContextHash:expectedContextHash,contextHash:hash,
      reason:'verified_pre_purchase_stockout',inventoryVerified:true,journalKey};
    // Full old context/receipt retained atomically. Do not delete/re-key old evidence.
    await tx.runtimeStore.create({data:{key:journalKey,data:{version:1,...recovery,priorContext:context,priorNumberStage:number,priorIntake:fresh.values[4]}}});
    await tx.runtimeStore.update({where:{key:fresh.keys[0]},data:{data:{...context,payload,contextHash:hash,
      updatedAt:at,fallbackRecovery:recovery}}});
    await tx.runtimeStore.update({where:{key:fresh.keys[1]},data:{data:{...number,contextHash:hash,
      // The executor marked its whole search function as dispatched, but STOCKOUT
      // is thrown before purchase POST. Original dispatch evidence lives in journal.
      dispatchStartedAt:null,updatedAt:at,fallbackRecovery:recovery}}});
    await tx.runtimeStore.update({where:{key:fresh.keys[4]},data:{data:amendedRecoveryCopy(fresh.values[4],context.payload,payload,signingSecret,now)}});
    return {...result,applied:true,contextHash:hash};
  });
}
module.exports = { prepareNumberFallbackRecovery, SETTLE_MS };
