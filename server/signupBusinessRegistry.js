const { signupBusinessKey, assertSignupOpen } = require("./signupBusinessIdentity");

function conflict(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

// One transaction owns tenant creation AND provider bindings. Global binding
// lock covers two different business keys racing to claim the same resource.
async function ensureSignupBusinessBindings({ prisma, signup, mappings, fallbackPhone, ownerPhone }) {
  assertSignupOpen(signup);
  const businessKey = signupBusinessKey(signup);
  if (!businessKey) throw conflict("SIGNUP_BUSINESS_IDENTITY_REQUIRED", "Complete business and owner identity is required.");
  const key = `signup-business:${businessKey}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"signup-business-bindings:v1"}))::text AS lock_result`;
    if (signup.signupAttemptId && tx.signupAttempt) {
      assertSignupOpen(await tx.signupAttempt.findUnique({ where: { eventKey: signup.signupAttemptId } }) || {});
    }
    const registry = await tx.runtimeStore.findUnique({ where: { key } });
    const savedId = Number(registry?.data?.businessId || signup.businessId || 0);
    if (registry?.data?.closed) throw conflict("SIGNUP_CLOSED", "This business setup was archived.");
    if (registry?.data?.businessId && signup.businessId && Number(signup.businessId) !== savedId) {
      throw conflict("SIGNUP_BUSINESS_ID_CONFLICT", "The saved business identity does not match.");
    }
    let business = savedId ? await tx.business.findUnique({ where: { id: savedId } }) : null;
    if (savedId && !business) throw conflict("SIGNUP_BUSINESS_ID_STALE", "The saved business no longer exists.");
    const existing = await tx.vapiBusinessMapping.findMany({ where: { matchValue: { in: mappings.map((item) => item.matchValue) } } });
    // Never infer tenant ownership from a phone/assistant supplied by a callback.
    if (existing.some((item) => !business || item.businessId !== business.id)) {
      throw conflict("AGENT_MAPPING_OWNERSHIP_CONFLICT", "A phone or assistant already belongs to a different business.");
    }
    if (!business) business = await tx.business.create({ data: { name: signup.businessName, phone: fallbackPhone, timezone: "America/Toronto" } });
    await tx.settings.upsert({ where: { businessId: business.id }, create: { businessId: business.id, ownerPhone, answerAfterRings: 3, afterHoursMode: "AI_ALWAYS_ON" }, update: { ownerPhone } });
    for (const mapping of mappings) {
      await tx.vapiBusinessMapping.upsert({ where: { matchValue: mapping.matchValue }, create: { businessId: business.id, ...mapping, label: signup.businessName }, update: { matchType: mapping.matchType, label: signup.businessName } });
    }
    const data = { businessId: business.id, businessKey };
    await tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
    return tx.business.findUnique({ where: { id: business.id }, include: { settings: true, vapiMappings: true } });
  });
}

async function closeSignupBusinessIdentity({ prisma, signup }) {
  const businessKey = signupBusinessKey(signup);
  if (!businessKey) return;
  const key = `signup-business:${businessKey}`;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"signup-business-bindings:v1"}))::text AS lock_result`;
    const current = await tx.runtimeStore.findUnique({ where: { key } });
    const data = { ...current?.data, businessKey, closed: true, closedAt: new Date().toISOString() };
    await tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
  });
}

async function upsertOwnedProviderMapping({ prisma, businessId, matchType, matchValue, label = null, include }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"signup-business-bindings:v1"}))::text AS lock_result`;
    const existing = await tx.vapiBusinessMapping.findUnique({ where: { matchValue } });
    if (existing && existing.businessId !== businessId) throw conflict("AGENT_MAPPING_OWNERSHIP_CONFLICT", "This phone or assistant already belongs to another business. Unbind it explicitly before reassignment.");
    return tx.vapiBusinessMapping.upsert({ where: { matchValue }, create: { businessId, matchType, matchValue, label }, update: { matchType, label }, ...(include ? { include } : {}) });
  });
}

module.exports = { ensureSignupBusinessBindings, closeSignupBusinessIdentity, upsertOwnedProviderMapping };
