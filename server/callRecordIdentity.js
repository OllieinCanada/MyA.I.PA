// Resolve all supplied identities before writing; never merge distinct calls.
function identityConflict() {
  return Object.assign(new Error('Call identity could not be reconciled safely.'), {
    code: 'CALL_RECORD_IDENTITY_CONFLICT', statusCode: 409,
  });
}

function assertBinding(row, input) {
  if (row.businessId !== input.businessId) throw identityConflict();
  if (Boolean(row.externalProvider) !== Boolean(row.externalId)) throw identityConflict();
  for (const field of ['externalProvider', 'externalId', 'twilioCallSid']) {
    if (row[field] && input[field] && row[field] !== input[field]) throw identityConflict();
  }
}

async function resolveCallRecord(input) {
  const { prisma, businessId, localCallId, externalProvider, externalId, twilioCallSid } = input;
  if (!Number.isSafeInteger(businessId) || businessId <= 0) throw identityConflict();
  if (Boolean(externalProvider) !== Boolean(externalId)) throw identityConflict();
  const queries = [];
  if (localCallId != null && localCallId !== '') {
    const id = Number(localCallId);
    if (!Number.isSafeInteger(id) || id <= 0) throw identityConflict();
    queries.push({ id });
  }
  if (externalProvider && externalId) queries.push({ externalProvider_externalId: { externalProvider, externalId } });
  if (twilioCallSid) queries.push({ twilioCallSid });
  const rows = await Promise.all(queries.map(where => prisma.call.findUnique({
    where, include: { caller: true, business: true },
  })));
  const candidates = rows.filter(Boolean);
  for (const row of candidates) assertBinding(row, input);
  if (new Set(candidates.map(row => row.id)).size > 1) throw identityConflict();
  return candidates[0] || null;
}

function identityDuplicate(error) {
  if (error?.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === 'twilioCallSid'
      || target.length === 2 && target.includes('externalProvider') && target.includes('externalId');
  }
  return ['Call_twilioCallSid_key', 'Call_externalProvider_externalId_key'].includes(target);
}

async function persistCallRecord(input) {
  const { prisma, businessId, externalProvider, externalId, twilioCallSid } = input;
  async function update(row, canRetry = true) {
    assertBinding(row, input);
    const data = await input.updateData(row);
    try {
      return await prisma.call.update({
        // Compare identity as well as ownership: a concurrent binding change must fail closed.
        where: { id: row.id, businessId, callerId: row.callerId, externalProvider: row.externalProvider ?? null,
          externalId: row.externalId ?? null, twilioCallSid: row.twilioCallSid ?? null },
        data: { ...data, businessId: row.businessId, callerId: row.callerId,
          externalProvider: row.externalProvider || externalProvider || null,
          externalId: row.externalId || externalId || null,
          twilioCallSid: row.twilioCallSid || twilioCallSid || null },
        include: { caller: true, business: true },
      });
    } catch (error) {
      if (error?.code === 'P2025' || identityDuplicate(error)) {
        if (canRetry) {
          const winner = await resolveCallRecord(input);
          if (winner && winner.id === row.id && winner.callerId === row.callerId) return update(winner, false);
        }
        throw identityConflict();
      }
      throw error;
    }
  }
  const existing = await resolveCallRecord(input);
  if (existing) return update(existing);
  // Caller creation is deferred until all existing call identities have been checked.
  const data = typeof input.createData === 'function' ? await input.createData() : input.createData;
  try {
    return await prisma.call.create({ data: { ...data, businessId,
      externalProvider: externalProvider || null, externalId: externalId || null,
      twilioCallSid: twilioCallSid || null }, include: { caller: true, business: true } });
  } catch (error) {
    if (!identityDuplicate(error)) throw error;
    const winner = await resolveCallRecord(input);
    if (!winner) throw error;
    return update(winner);
  }
}

module.exports = { persistCallRecord, resolveCallRecord };
