const { mergeToolSummaries } = require('./callNotificationEvidence');

function identityError() {
  return Object.assign(new Error('Saved call identifiers do not agree on one business and caller.'), {
    code: 'CALL_RECORD_IDENTITY_CONFLICT', statusCode: 409,
  });
}

function assertCallIdentity(row, identity) {
  const sameExternal = row.externalProvider === identity.externalProvider && row.externalId === identity.externalId;
  const replacingPlaceholder = sameExternal && row.caller?.phone === `unknown-vapi-${identity.externalId}`;
  if (Number(row.businessId) !== Number(identity.businessId)
    || (row.callerId && Number(row.callerId) !== Number(identity.callerId) && !replacingPlaceholder)) throw identityError();
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
  const target = String(error.meta?.target || '');
  return error.meta?.modelName === model || (model === 'Caller' ? /\bphone\b/.test(target) : /twilioCallSid|externalProvider|externalId/.test(target));
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

async function persistCall({ db, identity, createData, updateData }) {
  const alternatives = [];
  if (identity.callId) alternatives.push({ id: Number(identity.callId) });
  if (identity.externalProvider && identity.externalId) alternatives.push({ externalProvider: identity.externalProvider, externalId: identity.externalId });
  if (identity.twilioCallSid) alternatives.push({ twilioCallSid: identity.twilioCallSid });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', '800ms', true), set_config('statement_timeout', '1500ms', true)`;
        const rows = alternatives.length ? await tx.call.findMany({ where: { OR: alternatives }, include: { caller: true } }) : [];
        if (rows.length > 1) throw identityError();
        if (!rows.length) return tx.call.create({ data: createData, include: { caller: true, business: true } });
        assertCallIdentity(rows[0], identity);
        // Serialize merges on the canonical row, not across all calls or the
        // trial gate. Re-read after the lock so sparse events cannot erase a
        // richer terminal report written by another worker.
        await tx.$queryRaw`SELECT id FROM "Call" WHERE id = ${rows[0].id} FOR UPDATE`;
        const current = await tx.call.findUnique({ where: { id: rows[0].id }, include: { caller: true } });
        if (!current) throw identityError();
        assertCallIdentity(current, identity);
        return tx.call.update({ where: { id: current.id }, data: updateData(current), include: { caller: true, business: true } });
      }, { maxWait: 500, timeout: 3000 });
    } catch (error) {
      // A unique-key exception aborts a PostgreSQL transaction. Reconcile in a
      // NEW transaction, once, rather than querying inside the aborted one.
      if (attempt || !alternatives.length || !isUniqueFailure(error, 'Call')) throw error;
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

module.exports = { assertCallIdentity, isUniqueFailure, mergeCallData, persistCall, persistCaller };
