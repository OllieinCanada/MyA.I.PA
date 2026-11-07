const { mergeToolSummaries } = require('./callNotificationEvidence');
const { Prisma } = require('@prisma/client');

function identityError() {
  return Object.assign(new Error('Saved call identifiers do not agree on one business and caller.'), {
    code: 'CALL_RECORD_IDENTITY_CONFLICT', statusCode: 409,
  });
}

function assertCallIdentity(row, identity) {
  const sameExternal = row.externalProvider === identity.externalProvider && row.externalId === identity.externalId;
  const replacingPlaceholder = sameExternal && row.caller?.phone === `unknown-vapi-${identity.externalId}`;
  if (Number(row.businessId) !== Number(identity.businessId)
    || (identity.callerId != null && row.callerId && Number(row.callerId) !== Number(identity.callerId) && !replacingPlaceholder)) throw identityError();
  if (Boolean(row.externalProvider) !== Boolean(row.externalId)) throw identityError();
  if (row.twilioCallSid && identity.twilioCallSid && row.twilioCallSid !== identity.twilioCallSid) throw identityError();
  if (row.externalProvider && row.externalId && identity.externalProvider && identity.externalId
    && (row.externalProvider !== identity.externalProvider || row.externalId !== identity.externalId)) {
    // The carrier receipt and Vapi record may refer to the same physical call.
    // Only promote a Twilio identity that exactly equals the proven carrier SID.
    if (!(row.externalProvider === 'twilio' && row.externalId === identity.twilioCallSid
      && identity.externalProvider === 'vapi')) throw identityError();
  }
}

function isUniqueFailure(error, model) {
  if (error?.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    if (model === 'Caller') return target.length === 1 && target[0] === 'phone';
    return target.length === 1 && target[0] === 'twilioCallSid'
      || target.length === 2 && target.includes('externalProvider') && target.includes('externalId');
  }
  return (model === 'Caller' ? ['Caller_phone_key']
    : ['Call_twilioCallSid_key', 'Call_externalProvider_externalId_key']).includes(target);
}

function callAlternatives(identity) {
  if (!Number.isSafeInteger(Number(identity.businessId)) || Number(identity.businessId) <= 0
    || Boolean(identity.externalProvider) !== Boolean(identity.externalId)) throw identityError();
  const alternatives = [];
  if (identity.callId != null && identity.callId !== '') {
    const id = Number(identity.callId);
    if (!Number.isSafeInteger(id) || id <= 0) throw identityError();
    alternatives.push({ id });
  }
  if (identity.externalProvider && identity.externalId) alternatives.push({ externalProvider: identity.externalProvider, externalId: identity.externalId });
  if (identity.twilioCallSid) alternatives.push({ twilioCallSid: identity.twilioCallSid });
  return alternatives;
}

async function resolveCallRecord(db, identity) {
  const alternatives = callAlternatives(identity);
  const rows = alternatives.length ? await db.call.findMany({ where: { OR: alternatives }, include: { caller: true, business: true } }) : [];
  if (rows.length > 1) throw identityError();
  if (rows[0]) assertCallIdentity(rows[0], identity);
  return rows[0] || null;
}

async function persistCaller(db, { phone, name }) {
  const input = { where: { phone }, update: name ? { name } : {}, create: { phone, name } };
  try { return await db.caller.upsert(input); }
  catch (error) {
    if (!isUniqueFailure(error, 'Caller')) throw error;
    const existing = await db.caller.findUnique({ where: { phone } });
    if (!existing) throw error;
    return name ? db.caller.update({ where: { id: existing.id }, data: { name } }) : existing;
  }
}

async function persistCall({ db, identity, createData, updateData, postCall = false, onDiagnostic = () => {} }) {
  const alternatives = callAlternatives(identity);
  if (!Number.isSafeInteger(Number(identity.callerId)) || Number(identity.callerId) <= 0) throw identityError();
  const filters = alternatives.map(clause => {
    if (clause.id != null) return Prisma.sql`c.id = ${clause.id}`;
    if (clause.twilioCallSid) return Prisma.sql`c."twilioCallSid" = ${clause.twilioCallSid}`;
    return Prisma.sql`(c."externalProvider" = ${clause.externalProvider} AND c."externalId" = ${clause.externalId})`;
  });
  // Only terminal Vapi ingestion may spend the longer budget. This is NOT
  // assistant selection and cannot authorize a call, send an SMS or buy a resource.
  const recoverablePostCall = postCall === true && identity.externalProvider === 'vapi'
    && Boolean(identity.externalId) && Boolean(createData.endedAt);
  const timeout = recoverablePostCall ? 8000 : 3000;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let configuring = false;
    let stage = 'transaction_start';
    const started = Date.now(), stages = {};
    const measure = async (name, task) => {
      stage = name; const begin = Date.now();
      try { return await task(); } finally { stages[name] = Date.now() - begin; }
    };
    try {
      const saved = await db.$transaction(async (tx) => {
        configuring = true;
        await measure('configuration', () => tx.$queryRaw`SELECT set_config('lock_timeout', '800ms', true), set_config('statement_timeout', '1500ms', true)`);
        configuring = false;
        // Read and lock the canonical row in ONE round trip. The old path
        // fetched relations, acquired a lock, re-read, and fetched relations
        // again while the three-second transaction clock kept running.
        // Stable lock order also keeps ambiguous multi-row identities safe.
        const rows = filters.length ? await measure('identity_read', () => tx.$queryRaw(Prisma.sql`
          SELECT c.*, json_build_object('phone', p.phone) AS caller
          FROM "Call" c JOIN "Caller" p ON p.id = c."callerId"
          WHERE ${Prisma.join(filters, ' OR ')}
          ORDER BY c.id FOR UPDATE OF c
        `)) : [];
        if (rows.length > 1) throw identityError();
        const current = rows[0];
        let row;
        if (!current) row = await measure('create', () => tx.call.create({ data: createData }));
        else {
          assertCallIdentity(current, identity);
          row = await measure('update', () => tx.call.update({ where: { id: current.id }, data: updateData(current) }));
        }
        stage = 'commit';
        return row;
      }, { maxWait: 500, timeout });
      try { onDiagnostic({ attempt: attempt + 1, timeoutMs: timeout, elapsedMs: Date.now() - started, stages, outcome: 'saved' }); } catch { /* diagnostics cannot undo a saved record */ }
      return saved;
    } catch (error) {
      // A transaction can expire before its first configuration query executes.
      // The default path retries only that pre-Call-work expiry. The explicit
      // terminal Vapi path below may also reconcile its uniquely identified
      // database-only write. Both share ONE retry in a NEW transaction.
      const startupExpired = configuring && error?.code === 'P2028'
        && /expired transaction/i.test(String(error.meta?.error || error.message || ''));
      const uniqueRace = alternatives.length && isUniqueFailure(error, 'Call');
      // A terminal call is a database-only idempotent merge with a proven unique
      // provider identity. A NEW transaction re-reads/locks that identity before
      // writing, so an uncertain previous commit is updated, not duplicated.
      // Never extend this recovery to anonymous creates or external actions.
      const postCallExpired = recoverablePostCall && error?.code === 'P2028'
        && /expired transaction|transaction.*(?:closed|timed out)/i.test(String(error.meta?.error || error.message || ''));
      const retry = !attempt && Boolean(startupExpired || uniqueRace || postCallExpired);
      try { onDiagnostic({ attempt: attempt + 1, timeoutMs: timeout, elapsedMs: Date.now() - started,
        stages, stage, outcome: retry ? 'database_retry' : 'failed', code: /^P\d{4}$/.test(error?.code || '') ? error.code : 'CALL_SAVE_FAILED' }); } catch { /* retain original error */ }
      if (recoverablePostCall && error?.code !== 'CALL_RECORD_IDENTITY_CONFLICT') {
        error.callPersistenceFailure = true;
        error.callPersistenceStage = stage;
      }
      if (!retry) throw error;
    }
  }
}

function mergeCallData(existing, next) {
  const merged = { ...next };
  for (const [key, value] of Object.entries(merged)) {
    if (value == null || value === '') merged[key] = existing[key] ?? value;
  }
  if (existing.status !== 'STARTED' && next.status === 'STARTED') merged.status = existing.status;
  if (existing.status === 'FAILED' && next.status === 'COMPLETED' && !Number(next.durationSec)) {
    merged.status = 'FAILED';
    merged.endedReason = existing.endedReason;
    merged.endedMessage = existing.endedMessage;
  }
  if (next.outcome === 'UNREVIEWED' && existing.outcome) merged.outcome = existing.outcome;
  if (existing.durationSec != null) merged.durationSec = Math.max(Number(existing.durationSec), Number(next.durationSec || 0));
  for (const key of ['artifactMessages', 'structuredData', 'structuredOutputs', 'artifactMetrics', 'toolCallSummary']) {
    const value = next[key];
    if (value == null || (Array.isArray(value) && !value.length)
      || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) merged[key] = existing[key];
  }
  // Empty provider event summaries must not wipe a more informative tool log.
  if (next.toolCallSummary && !next.toolCallSummary.count && existing.toolCallSummary?.count) merged.toolCallSummary = existing.toolCallSummary;
  else if (next.toolCallSummary) merged.toolCallSummary = mergeToolSummaries(existing.toolCallSummary, next.toolCallSummary);
  return merged;
}

module.exports = { resolveCallRecord, assertCallIdentity, isUniqueFailure, mergeCallData, persistCall, persistCaller };
